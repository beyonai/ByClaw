package com.iwhalecloud.byai.manager.domain.tenant.integration;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assumptions.assumeFalse;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.util.RuntimeEnvironment;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantHarnessProvisioningWorkerTest {

    private final TenantCommandStoreTest fixture = new TenantCommandStoreTest();
    private final EnterpriseInfoService enterprises = mock(EnterpriseInfoService.class);
    private final SequenceService ids = mock(SequenceService.class);
    private final TenantSandboxService sandboxes = mock(TenantSandboxService.class);
    private final WorkerRegistry registry = mock(WorkerRegistry.class);
    private TenantHarnessProvisioningWorker worker;

    @BeforeEach
    void setup() {
        fixture.setup();
        fixture.jdbc.execute("""
            CREATE TABLE byai.tenant_task_step(command_id bigint,step_key varchar(64),
            status varchar(32),provider_request_key varchar(128),result text,revision bigint default 0,
            PRIMARY KEY(command_id,step_key))
            """);
        when(enterprises.findById(1L)).thenReturn(new EnterpriseInfo());
        when(ids.nextVal()).thenReturn(2L);
        worker = new TenantHarnessProvisioningWorker(fixture.store, enterprises, ids, sandboxes,
            registry, new ObjectMapper(), Runnable::run, 0);
    }

    @Test
    void acceptsOneImmutableTaskForThePlatformEnterprise() {
        assumeFalse(RuntimeEnvironment.isDevelopment());
        assertEquals("NOT_REQUESTED", worker.status().status());

        var first = worker.submit(71, "s");
        assertEquals("PENDING", first.status());
        assertEquals(first.taskId(), worker.submit(72, "s").taskId());
        assertEquals(1, fixture.jdbc.queryForObject(
            "SELECT count(*) FROM byai.tenant_task WHERE type='HARNESS_START' AND enterprise_id=1", Integer.class));
        assertThrows(ResponseStatusException.class, () -> worker.submit(72, "m"));
    }

    @Test
    void waitsForTheCurrentWorkerAndRechecksTheSameIntent() {
        queueHarnessTask();
        var record = new SsSandboxRecord();
        record.setId(123L);
        record.setSandboxId("sandbox-123");
        record.setStatus("RUNNING");
        when(sandboxes.latestHarnessRecord(1)).thenReturn(record);
        when(sandboxes.ensureHarness(1, "s", "command-2:HARNESS_CREATE"))
            .thenReturn(new TenantSandboxView(123, "sandbox-123", null));
        when(registry.hasOnlineAgentType("BYCLAW_DSH_TENANT_1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(true, List.of("tenant-harness-1-99")));

        worker.process(2);

        assertEquals("FAILED", worker.status().status());
        assertEquals("HARNESS_WORKER_TIMEOUT", worker.status().errorCode());
        assertFalse(worker.status().workerReady());
        fixture.store.requeueHarness(fixture.store.find(2));
        when(registry.hasOnlineAgentType("BYCLAW_DSH_TENANT_1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(true, List.of("tenant-harness-1-123")));

        worker.process(2);

        assertEquals("SUCCEEDED", worker.status().status());
        assertTrue(worker.status().workerReady());
        assertEquals("command-2:HARNESS_CREATE", fixture.jdbc.queryForObject(
            "SELECT provider_request_key FROM byai.tenant_task_step WHERE command_id=2", String.class));
        assertEquals("123", fixture.jdbc.queryForObject(
            "SELECT result FROM byai.tenant_task_step WHERE command_id=2", String.class));
    }

    @Test
    void keepsTheProviderIntentWhenCreationCannotBeConfirmed() {
        queueHarnessTask();
        when(sandboxes.ensureHarness(1, "s", "command-2:HARNESS_CREATE")).thenAnswer(invocation -> {
            assertEquals("STARTED", fixture.jdbc.queryForObject(
                "SELECT status FROM byai.tenant_task_step WHERE command_id=2", String.class));
            throw new IllegalStateException("provider response lost");
        });

        worker.process(2);

        assertEquals("MANUAL_REQUIRED", worker.status().status());
        assertEquals("STARTED", fixture.jdbc.queryForObject(
            "SELECT status FROM byai.tenant_task_step WHERE command_id=2", String.class));
    }

    private void queueHarnessTask() {
        fixture.store.insert(2, "byclaw", "tenant-harness-start-1", "hash",
            "HARNESS_START", 1, 71, "{\"profileKey\":\"s\"}");
    }
}
