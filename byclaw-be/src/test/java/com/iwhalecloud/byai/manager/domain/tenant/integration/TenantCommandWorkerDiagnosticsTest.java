package com.iwhalecloud.byai.manager.domain.tenant.integration;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TenantCommandWorkerDiagnosticsTest {
    private String previousEnvironment;

    @BeforeEach void isolateEnvironment() {
        previousEnvironment = System.getProperty("BE_ENV");
        System.setProperty("BE_ENV", "production");
    }

    @AfterEach void restoreEnvironment() {
        if (previousEnvironment == null) {
            System.clearProperty("BE_ENV");
        } else {
            System.setProperty("BE_ENV", previousEnvironment);
        }
    }

    @Test void developmentDoesNotScanClaimOrExecuteSharedCommands() {
        System.setProperty("BE_ENV", "development");
        var store = mock(TenantCommandStore.class);
        var provisioner = mock(TenantDbProvisioningService.class);
        var transactions = mock(PlatformTransactionManager.class);
        var policies = mock(TenantExecutionPolicyService.class);
        var worker = new TenantCommandWorker(store, null, transactions, new ObjectMapper(), provisioner, policies);

        worker.scan();

        // Development must not touch the shared queue, including expired leases and restored commands.
        verifyNoInteractions(store, provisioner, transactions, policies);
    }

    @Test void nestedFileFailureRetainsCauseTypeAndLocationWithoutPathsOrMessages() throws Exception {
        var cause = new java.nio.file.AccessDeniedException("/private-provider-credential/data");
        cause.setStackTrace(new StackTraceElement[] {
            new StackTraceElement("com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService",
                "prepareEntrypoint", "TenantSandboxService.java", 470)
        });
        assertFailureLogged(new IllegalStateException("private-startup-script-path", cause), "PROVIDER_RESULT_UNKNOWN");
    }

    @Test void persistedManualRequiredLogsSafeIdentifiersAndOriginalFailureClass() throws Exception {
        assertFailureLogged(new IllegalStateException("redis://private-user:private-password@private-host"),
            "PROVIDER_RESULT_UNKNOWN");
    }

    @Test void malformedProviderCodeIsSanitizedBeforePersistenceHookAndLog() throws Exception {
        assertFailureLogged(new TenantCommandException(503, "redis://private-user:private-password@private-host"),
            "PROVIDER_RESULT_UNKNOWN");
    }

    @Test void failedAcknowledgementRetainsBothSafeFailureClasses() throws Exception {
        assertFailureLogged(new IllegalArgumentException("private-provider-credential"), "PROVIDER_RESULT_UNKNOWN", true);
    }

    @Test void provider503RemainsUnknownAndIsNotBlindlyRetried() throws Exception {
        assertFailureLogged(new org.springframework.web.server.ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE),
            "PROVIDER_RESULT_UNKNOWN");
    }

    @Test void missingPublicationWaitsWithoutCallingProviderThenSameTaskResumes() throws Exception {
        var fixture = new TenantCommandStoreTest(); fixture.setup();
        var db = fixture.jdbc;
        db.execute("CREATE TABLE byai.tenant_config(enterprise_id bigint,params_code varchar(64),params_value text)");
        db.execute("CREATE TABLE byai.tenant_task_step(command_id bigint,step_key varchar(64),status varchar(32),provider_request_key varchar(128),result text,revision bigint DEFAULT 0,PRIMARY KEY(command_id,step_key))");
        db.update("INSERT INTO byai.tenant_operation_state(enterprise_id,active_command_id,policy_revision) VALUES(2,1,1)");
        var shared = new com.iwhalecloud.byai.common.quota.TestSharedPolicies();
        var policies = new TenantExecutionPolicyService(db,new ObjectMapper(),shared.reader,false,"");
        var provisioner = mock(TenantDbProvisioningService.class);
        var calls = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(call -> {
            TenantProvisioningGuard guard = call.getArgument(1);
            guard.external("DB_CREATE", Boolean.class, () -> { calls.incrementAndGet(); return true; });
            return null;
        }).when(provisioner).provisionDurably(eq(2L),any());
        var worker = new TenantCommandWorker(fixture.store,db,fixture.tx.getTransactionManager(),new ObjectMapper(),provisioner,policies);
        worker.scan();
        assertEquals("RETRY_WAIT",fixture.store.find(1).status());
        assertEquals("SHARED_QUOTA_NOT_READY",fixture.store.find(1).errorCode());
        assertEquals(0,calls.get());
        assertEquals(0,db.queryForObject("SELECT count(*) FROM byai.tenant_task_step",Integer.class));
        shared.publish(2,new ObjectMapper().readTree("{\"revision\":\"1\",\"accessMode\":\"PREPARED\"}"));
        db.update("UPDATE byai.tenant_task SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=1");
        worker.scan();
        assertEquals("SUCCEEDED",fixture.store.find(1).status());
        assertEquals(1,calls.get());
        assertEquals(1,db.queryForObject("SELECT count(*) FROM byai.tenant_task",Integer.class));
        assertNull(db.queryForObject("SELECT active_command_id FROM byai.tenant_operation_state",Long.class));
    }

    private void assertFailureLogged(RuntimeException failure, String expectedCode) throws Exception {
        assertFailureLogged(failure, expectedCode, false);
    }

    private void assertFailureLogged(RuntimeException failure, String expectedCode, boolean acknowledgementFails) throws Exception {
        var store = mock(TenantCommandStore.class);
        var provisioner = mock(TenantDbProvisioningService.class);
        var transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var lease = new TenantCommandStore.Lease(10, 42, "worker", 1);
        when(store.candidates("PROVISION")).thenReturn(List.of(10L));
        when(store.claim(eq(10L), anyString(), any())).thenReturn(lease);
        when(store.find(10)).thenReturn(new TenantCommandStore.Command("10", "HACU", "request", "hash",
            "PROVISION", "42", "RUNNING", "DB_CREATE", null, 1));
        doThrow(failure).when(provisioner).provisionDurably(eq(42L), any());
        if (acknowledgementFails) {
            doThrow(new IllegalStateException("private-acknowledgement-credential"))
                .when(store).finish(lease, "MANUAL_REQUIRED", "DB_CREATE", expectedCode);
        }
        var worker = new TenantCommandWorker(store, null, transactions, new ObjectMapper(), provisioner,
            mock(TenantExecutionPolicyService.class));
        Logger logger = (Logger) LoggerFactory.getLogger(TenantCommandWorker.class);
        Level previousLevel = logger.getLevel();
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.WARN);
        try {
            worker.scan();
            verify(store).finish(lease, "MANUAL_REQUIRED", "DB_CREATE", expectedCode);
            assertEquals(1, appender.list.size());
            var event = appender.list.get(0);
            assertEquals(acknowledgementFails ? Level.WARN : Level.ERROR, event.getLevel());
            String message = event.getFormattedMessage();
            assertTrue(message.contains("commandId=10"));
            assertTrue(message.contains("enterpriseId=42"));
            assertTrue(message.contains(acknowledgementFails ? "stage=UNKNOWN" : "stage=DB_CREATE"));
            if (acknowledgementFails) {
                assertFalse(message.contains("status=MANUAL_REQUIRED"));
                assertTrue(message.contains("acknowledgementExceptionType=java.lang.IllegalStateException"));
            } else {
                assertTrue(message.contains("status=MANUAL_REQUIRED"));
            }
            assertTrue(message.contains("errorCode=" + expectedCode));
            assertTrue(message.contains("exceptionType=" + failure.getClass().getName()));
            if (failure.getCause() != null) {
                assertTrue(message.contains("java.nio.file.AccessDeniedException"));
                assertTrue(message.contains("TenantSandboxService.prepareEntrypoint:470"));
            }
            assertFalse(message.contains("private-"));
            assertNull(event.getThrowableProxy());
        } finally {
            logger.detachAppender(appender);
            logger.setLevel(previousLevel);
            appender.stop();
        }
    }
}
