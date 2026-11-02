package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.integration.TenantCommandStore;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

class TenantDbTechnicalRotationTest {
    @Test void rotatesDatabaseFirstOnlyAfterReleasingAdmissionLock() {
        Fixture f = new Fixture();
        f.db.setCreateTime(Date.from(Instant.now().minus(Duration.ofHours(23))));
        f.node.setCreateTime(f.db.getCreateTime());
        f.service.renewReadyLeases();
        assertEquals(1, f.tasks.size());
        verify(f.redis).execute(any(RedisScript.class), eq(List.of("tenant:provision:db:42")), any());
        verify(f.sandboxes, never()).releaseForReplacement(anyLong(), anyString(), anyLong());
        f.tasks.getFirst().run();
        var ordered = inOrder(f.sandboxes);
        ordered.verify(f.sandboxes).releaseForReplacement(42, "tenant-data-node", 2L);
        ordered.verify(f.sandboxes).releaseForReplacement(42, "tenant-opengauss", 1L);
    }

    @Test void youngRunningRecordsAreNotRotated() {
        Fixture f = new Fixture();
        f.db.setCreateTime(Date.from(Instant.now().minus(Duration.ofHours(23)).plusSeconds(60)));
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
    }

    @Test void unknownProviderNeverAllowsDestructiveRotationEvenWhenOld() {
        Fixture f = new Fixture();
        f.db.setCreateTime(Date.from(Instant.now().minus(Duration.ofDays(2))));
        when(f.sandboxes.providerStatus(f.db)).thenReturn("UNKNOWN");
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
    }

    @Test void missingDatabaseAndStoppedNodeAreRecoveredWithoutWaitingForAge() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
        when(f.sandboxes.providerStatus(f.node)).thenReturn("STOPPED");
        f.service.renewReadyLeases();
        f.tasks.getFirst().run();
        verify(f.sandboxes).releaseForReplacement(42, "tenant-opengauss", 1L);
    }

    @Test void nodeOnlyRotationPreservesHealthyDatabase() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.node)).thenReturn("STOPPED");
        doThrow(new IllegalStateException("fixture stop after Node replacement"))
            .when(f.sandboxes).releaseForReplacement(42, "tenant-data-node", 2L);
        f.service.renewReadyLeases();
        f.tasks.getFirst().run();
        verify(f.sandboxes).releaseForReplacement(42, "tenant-data-node", 2L);
        verify(f.sandboxes, never()).releaseForReplacement(42, "tenant-opengauss", 1L);
    }

    @Test void nonMicrovmRecordIsNotAutomaticallyRotated() {
        Fixture f = new Fixture();
        f.db.setSandboxId("docker-id");
        f.db.setCreateTime(Date.from(Instant.now().minus(Duration.ofDays(2))));
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
        verify(f.sandboxes, never()).providerStatus(f.db);
    }

    @Test void deletionAndCommercialBusyPreventScheduling() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
        when(f.tenants.selectConfig(42L, "TENANT_DELETE_REQUESTED")).thenReturn("true");
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
        when(f.tenants.selectConfig(42L, "TENANT_DELETE_REQUESTED")).thenReturn(null);
        when(f.tenants.selectConfig(42L, "COMMERCIAL_MANAGED")).thenReturn("true");
        when(f.commands.canRenewTechnicalLease(42L)).thenReturn(false);
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
    }

    @Test void commercialIdleAndNonLegacyAuthorityAreNeverAutomaticallyReplaced() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
        when(f.tenants.selectConfig(42L, "COMMERCIAL_MANAGED")).thenReturn("true");
        when(f.commands.canRenewTechnicalLease(42L)).thenReturn(true);
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
        when(f.tenants.selectConfig(42L, "COMMERCIAL_MANAGED")).thenReturn(null);
        f.state.setParamsValue(f.state.getParamsValue().replace("\"generation\":1", "\"generation\":7"));
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
    }

    @Test void changedReadyAuthorityBeforeQueuedRestartNeverReleasesResources() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
        f.service.renewReadyLeases();
        f.state.setParamsValue(f.state.getParamsValue().replace("\"generation\":1", "\"generation\":2"));
        f.tasks.getFirst().run();
        verify(f.sandboxes, never()).releaseForReplacement(anyLong(), anyString(), anyLong());
        verify(f.tenants, never()).updateConfig(anyLong(), anyString(), anyString());
    }

    @Test void recoveredOrUnknownCandidateBeforeQueuedTaskNeverReleasesResources() {
        for (String observed : List.of("RUNNING", "UNKNOWN")) {
            Fixture f = new Fixture();
            when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
            f.service.renewReadyLeases();
            assertEquals(1, f.tasks.size());
            when(f.sandboxes.providerStatus(f.db)).thenReturn(observed);
            f.tasks.getFirst().run();
            verify(f.sandboxes, never()).releaseForReplacement(anyLong(), anyString(), anyLong());
        }
    }

    @Test void databaseReplacementNeverIndirectlyReleasesAnUnknownNode() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
        when(f.sandboxes.providerStatus(f.node)).thenReturn("UNKNOWN");
        f.service.renewReadyLeases();
        assertTrue(f.tasks.isEmpty());
    }

    @Test void databaseRotationRejectsMixedRuntimeOrUnstableCompanionNode() {
        for (String condition : List.of("docker", "STARTING", "RELEASING")) {
            Fixture f = new Fixture();
            when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
            if (condition.equals("docker")) f.node.setSandboxId("docker-node");
            else f.node.setStatus(condition);
            f.service.renewReadyLeases();
            assertTrue(f.tasks.isEmpty(), condition);
        }
    }

    @Test void companionNodeChangedWhileQueuedPreventsDatabaseReplacement() {
        Fixture f = new Fixture();
        when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
        f.service.renewReadyLeases();
        assertEquals(1, f.tasks.size());
        when(f.sandboxes.latestRecord(42, "tenant-data-node")).thenReturn(record(9L));
        f.tasks.getFirst().run();
        verify(f.sandboxes, never()).releaseForReplacement(anyLong(), anyString(), anyLong());
    }

    @Test void changedRecordOrDeleteOrCommercialCommandBeforeTaskPreventsReplacement() {
        for (String changed : List.of("record", "delete", "commercial", "lock")) {
            Fixture f = new Fixture();
            when(f.sandboxes.providerStatus(f.db)).thenReturn("MISSING");
            f.service.renewReadyLeases();
            if (changed.equals("record")) when(f.sandboxes.latestRecord(42, "tenant-opengauss")).thenReturn(record(3L));
            if (changed.equals("delete")) when(f.tenants.selectConfig(42L, "TENANT_DELETE_REQUESTED")).thenReturn("true");
            if (changed.equals("commercial")) {
                when(f.tenants.selectConfig(42L, "COMMERCIAL_MANAGED")).thenReturn("true");
                when(f.commands.canRenewTechnicalLease(42L)).thenReturn(false);
            }
            if (changed.equals("lock")) when(f.values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(false);
            f.tasks.getFirst().run();
            verify(f.sandboxes, never()).releaseForReplacement(anyLong(), anyString(), anyLong());
        }
    }

    private static SsSandboxRecord record(long id) {
        var record = new SsSandboxRecord();
        record.setId(id);
        record.setSandboxId("microvm--cn-beijing--sbx-" + id);
        record.setStatus("RUNNING");
        record.setCreateTime(Date.from(Instant.now()));
        return record;
    }

    private static final class Fixture {
        final TenantAdminTenantMapper tenants = mock(TenantAdminTenantMapper.class);
        final TenantSandboxService sandboxes = mock(TenantSandboxService.class);
        final TenantConfigPublisher publisher = mock(TenantConfigPublisher.class);
        final StringRedisTemplate redis = mock(StringRedisTemplate.class);
        final ValueOperations<String, String> values = mock(ValueOperations.class);
        final TenantCommandStore commands = mock(TenantCommandStore.class);
        final List<Runnable> tasks = new ArrayList<>();
        final TenantConfigRow state = new TenantConfigRow();
        final SsSandboxRecord db = record(1L), node = record(2L);
        final TenantDbProvisioningService service;
        Fixture() {
            when(redis.opsForValue()).thenReturn(values);
            when(values.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenReturn(true);
            var tenant = new TenantAdminTenantRow(); tenant.setEnterpriseId(42L);
            when(tenants.selectTenants(null, null, null, "createdAt", "asc")).thenReturn(List.of(tenant));
            state.setParamsCode("PROVISION_STATE");
            state.setParamsValue("{\"status\":\"READY\",\"generation\":1,\"fencingToken\":1,\"leaseUntil\":\"2099-01-01T00:00:00Z\"}");
            var request = new TenantConfigRow(); request.setParamsCode("PROVISION_REQUEST_ID"); request.setParamsValue("existing-request");
            when(tenants.selectConfigs(42L)).thenAnswer(i -> List.of(state, request));
            when(tenants.updateConfig(anyLong(), anyString(), anyString())).thenReturn(1);
            when(publisher.publish(eq(42L), anyMap())).thenReturn(true);
            when(sandboxes.latestRecord(42, "tenant-opengauss")).thenReturn(db);
            when(sandboxes.latestRecord(42, "tenant-data-node")).thenReturn(node);
            when(sandboxes.providerStatus(any())).thenReturn("RUNNING");
            // Stop after the existing replacement boundary, without mocking a second provisioner.
            doThrow(new IllegalStateException("fixture stop after replacement"))
                .when(sandboxes).releaseForReplacement(42, "tenant-opengauss", 1L);

            service = new TenantDbProvisioningService(tenants, sandboxes, null, publisher, null, null,
                redis, new ObjectMapper(), tasks::add, "");
            service.setCommercialCommands(commands);
        }
    }
}
