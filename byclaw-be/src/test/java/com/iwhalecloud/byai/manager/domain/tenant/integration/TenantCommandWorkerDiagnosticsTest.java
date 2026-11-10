package com.iwhalecloud.byai.manager.domain.tenant.integration;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.quota.TestSharedPolicies;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLifecycleFacade;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.util.ReflectionTestUtils;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

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

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void preparingTemplatesRetryBothLaunchesOnTheOriginalCommand(boolean terminalNodeFailure, @TempDir Path root)
            throws Exception {
        var fixture = new TenantCommandStoreTest();
        fixture.setup();
        var db = fixture.jdbc;
        db.execute("CREATE TABLE byai.tenant_config(enterprise_id bigint,params_code varchar(64),params_value text)");
        db.execute("""
            CREATE TABLE byai.tenant_task_step(command_id bigint,step_key varchar(64),status varchar(32),
            provider_request_key varchar(128),result text,revision bigint DEFAULT 0,PRIMARY KEY(command_id,step_key))
            """);
        db.update("INSERT INTO byai.tenant_operation_state(enterprise_id,active_command_id,policy_revision) VALUES(2,1,1)");
        var json = new ObjectMapper();
        var shared = new TestSharedPolicies();
        shared.publish(2, json.readTree("{\"revision\":\"1\",\"accessMode\":\"PREPARED\"}"));
        var policies = new TenantExecutionPolicyService(db, json, shared.reader, false, "");

        var lifecycle = mock(SandboxLifecycleFacade.class);
        var specs = mock(SandboxServiceSpecRepository.class);
        var spec = new SandboxServiceSpec();
        spec.setOwnerScope("TENANT");
        spec.setResourceLimits(Map.of("cpu", "1", "memory", "1Gi"));
        when(specs.findByServiceKeyAndProfile(anyString(), eq("m"))).thenReturn(Optional.of(spec));
        var configuration = new Configuration(new Environment("tenant-sandbox",
            new SpringManagedTransactionFactory(), db.getDataSource()));
        configuration.addMapper(SsSandboxRecordMapper.class);
        String columns = configuration.getResultMap(SsSandboxRecordMapper.class.getName() + ".BaseResultMap")
            .getResultMappings().stream()
            .map(mapping -> mapping.getColumn() + (mapping.getColumn().equals("id")
                ? " bigint generated by default as identity primary key" : " " + mapping.getJdbcType().name()))
            .collect(Collectors.joining(","));
        db.execute("CREATE TABLE ss_sandbox_record (" + columns + ")");
        var records = new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(configuration))
            .getMapper(SsSandboxRecordMapper.class);
        var sandboxes = new TenantSandboxService(lifecycle, mock(OpenSandboxClient.class), specs, records, json,
            root.toString(), "localhost", "6379", "0", "default", "db-test-password", "http://be", "test-token", "");
        ReflectionTestUtils.setField(sandboxes, "tenantPolicyConfigs", mock(TenantAdminTenantMapper.class));

        var requests = new ArrayList<String>();
        var sandboxRecordIds = new ArrayList<String>();
        when(lifecycle.launchSandbox(any())).thenAnswer(call -> {
            SandboxLaunchRequest request = call.getArgument(0);
            String key = request.getMetadata().get("providerRequestKey");
            boolean firstAttempt = !requests.contains(key);
            requests.add(key);
            sandboxRecordIds.add(request.getMetadata().get("recordId"));
            if (firstAttempt) {
                return SandboxResponse.error("SANDBOX_TEMPLATE_PREPARING");
            }
            if (terminalNodeFailure && key.endsWith(":NODE_CREATE")) {
                return SandboxResponse.error("MANAGED_TEMPLATE_BUILD_FAILED");
            }
            var sandbox = new SandboxLaunchData();
            sandbox.setSandboxId("sandbox-" + requests.size());
            sandbox.setEndpoint("tcp://localhost:5432");
            return SandboxResponse.success(sandbox);
        });

        var provisioner = mock(TenantDbProvisioningService.class);
        doAnswer(call -> {
            TenantProvisioningGuard guard = call.getArgument(1);
            var database = guard.external("DB_CREATE", TenantSandboxService.TenantSandboxView.class,
                () -> sandboxes.launchOpenGauss(2, "m", "byclaw_t_2", "bc_t_2_admin", "db-test-password",
                    guard.providerRequestKey("DB_CREATE")));
            guard.external("NODE_CREATE", TenantSandboxService.TenantSandboxView.class,
                () -> sandboxes.launchDataNode(2, "m", database.recordId(), 1, guard.providerRequestKey("NODE_CREATE")));
            return null;
        }).when(provisioner).provisionDurably(eq(2L), any());
        var worker = new TenantCommandWorker(fixture.store, db, fixture.tx.getTransactionManager(), json, provisioner, policies);

        for (String stage : List.of("DB_CREATE", "NODE_CREATE")) {
            worker.scan();
            var command = fixture.store.find(1);
            assertEquals("RETRY_WAIT", command.status());
            assertEquals(stage, command.stage());
            assertEquals("SANDBOX_TEMPLATE_PREPARING", command.errorCode());
            String type = "DB_CREATE".equals(stage) ? "tenant-opengauss" : "tenant-data-node";
            assertEquals(List.of("STARTING"), db.queryForList(
                "SELECT status FROM ss_sandbox_record WHERE enterprise_id=2 AND sandbox_type=?", String.class, type));
            if ("DB_CREATE".equals(stage)) {
                var conflict = assertThrows(ResponseStatusException.class,
                    () -> sandboxes.launchOpenGauss(2, "m", "byclaw_t_2", "bc_t_2_admin", "db-test-password",
                        "command-99:DB_CREATE"));
                assertEquals(409, conflict.getStatusCode().value());
                assertEquals(List.of("command-1:DB_CREATE"), requests);
            }
            assertEquals("RETRY_READY", db.queryForObject(
                "SELECT status FROM byai.tenant_task_step WHERE command_id=1 AND step_key=?", String.class, stage));
            assertEquals(1L, db.queryForObject("SELECT active_command_id FROM byai.tenant_operation_state", Long.class));
            assertTrue(fixture.store.candidates("PROVISION").isEmpty());
            db.update("UPDATE byai.tenant_task SET next_attempt_at=CURRENT_TIMESTAMP WHERE id=1");
        }
        worker.scan();

        assertEquals(terminalNodeFailure ? "MANUAL_REQUIRED" : "SUCCEEDED", fixture.store.find(1).status());
        assertEquals(List.of("command-1:DB_CREATE", "command-1:DB_CREATE",
            "command-1:NODE_CREATE", "command-1:NODE_CREATE"), requests);
        assertEquals(sandboxRecordIds.get(0), sandboxRecordIds.get(1));
        assertEquals(sandboxRecordIds.get(2), sandboxRecordIds.get(3));
        assertNotEquals(sandboxRecordIds.get(0), sandboxRecordIds.get(2));
        assertEquals(List.of(terminalNodeFailure ? "FAILED" : "RUNNING", "RUNNING"), db.queryForList(
            "SELECT status FROM ss_sandbox_record WHERE enterprise_id=2 ORDER BY sandbox_type", String.class));
        assertEquals(0, db.queryForObject(
            "SELECT count(*) FROM ss_sandbox_record WHERE status='RUNNING' AND release_reason IS NOT NULL", Integer.class));
        assertEquals(1, db.queryForObject("SELECT count(*) FROM byai.tenant_task", Integer.class));
        assertEquals(terminalNodeFailure ? 1L : null,
            db.queryForObject("SELECT active_command_id FROM byai.tenant_operation_state", Long.class));
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
