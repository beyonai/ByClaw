package com.iwhalecloud.byai.manager.domain.tenant.integration;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.hook.HookPublisher;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TenantCommandWorkerDiagnosticsTest {
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

    private void assertFailureLogged(RuntimeException failure, String expectedCode) throws Exception {
        assertFailureLogged(failure, expectedCode, false);
    }

    private void assertFailureLogged(RuntimeException failure, String expectedCode, boolean acknowledgementFails) throws Exception {
        var store = mock(TenantCommandStore.class);
        var provisioner = mock(TenantDbProvisioningService.class);
        var hooks = mock(HookPublisher.class);
        var transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        var lease = new TenantCommandStore.Lease(10, 42, "worker", 1);
        when(store.candidates()).thenReturn(List.of(10L));
        when(store.claim(eq(10L), anyString(), any())).thenReturn(lease);
        when(store.find(10)).thenReturn(new TenantCommandStore.Command("10", "HACU", "request", "hash",
            "PROVISION", "42", "RUNNING", "DB_CREATE", null, 1));
        doThrow(failure).when(provisioner).provisionDurably(eq(42L), any());
        if (acknowledgementFails) {
            doThrow(new IllegalStateException("private-acknowledgement-credential"))
                .when(store).finish(lease, "MANUAL_REQUIRED", "DB_CREATE", expectedCode);
        }
        var worker = new TenantCommandWorker(store, null, transactions, new ObjectMapper(), provisioner,
            mock(TenantExecutionPolicyService.class), hooks);
        Logger logger = (Logger) LoggerFactory.getLogger(TenantCommandWorker.class);
        Level previousLevel = logger.getLevel();
        var appender = new ListAppender<ILoggingEvent>();
        appender.start();
        logger.addAppender(appender);
        logger.setLevel(Level.WARN);
        try {
            worker.scan();
            verify(store).finish(lease, "MANUAL_REQUIRED", "DB_CREATE", expectedCode);
            if (acknowledgementFails) {
                verifyNoInteractions(hooks);
            } else {
                verify(hooks).publishDurable(eq("tenant.provisioning.failed"), eq(1), eq("42"), anyString(),
                    eq("1"), eq("10"), argThat(payload -> expectedCode.equals(payload.get("errorCode"))));
            }
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
