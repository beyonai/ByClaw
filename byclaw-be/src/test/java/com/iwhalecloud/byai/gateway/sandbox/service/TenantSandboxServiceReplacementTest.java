package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import java.util.Date;
import java.util.List;
import java.nio.file.Files;
import java.nio.file.Path;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.InOrder;
import org.springframework.web.server.ResponseStatusException;

class TenantSandboxServiceReplacementTest {
    @org.junit.jupiter.api.Test
    void commercialMarkerIsInjectedAsImmutableNodeEnvironment() throws Exception {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var specs = mock(SandboxServiceSpecRepository.class);
        var records = mock(SsSandboxRecordMapper.class);
        org.mockito.Mockito.doAnswer(invocation -> {
            invocation.<SsSandboxRecord>getArgument(0).setId(31L);
            return 1;
        }).when(records).insert(any(SsSandboxRecord.class));
        var service = new TenantSandboxService(lifecycle, mock(OpenSandboxClient.class),
            specs, records, new ObjectMapper(), "db", "/tmp", "node", "localhost", "6379", "0", "default",
            "password", "http://be", "token", "localhost");
        var spec = new com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec();
        spec.setOwnerScope("TENANT");
        spec.setResourceLimits(java.util.Map.of("cpu", "1", "memory", "1Gi"));
        when(specs.findByServiceKeyAndProfile("tenant-data-node", "s")).thenReturn(java.util.Optional.of(spec));
        var mapper = mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper.class);
        var row = new com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow();
        row.setParamsCode("COMMERCIAL_MANAGED");
        row.setParamsValue("true");
        when(mapper.selectConfigs(12L)).thenReturn(java.util.List.of(row));
        org.springframework.test.util.ReflectionTestUtils.setField(service, "tenantPolicyConfigs", mapper);
        assertThatThrownBy(() -> service.launchDataNode(12L, "s", 20L, 1L))
            .isInstanceOf(ResponseStatusException.class);
        var request = org.mockito.ArgumentCaptor.forClass(com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest.class);
        verify(lifecycle).launchSandbox(request.capture());
        assertThat(request.getValue().getEnvs()).containsEntry("COMMERCIAL_MANAGED", "true");

    }


    @Test
    void preparesPrivateDatabaseDirectoryBeforeKubernetesCreatesRootOwnedSubPath(@TempDir Path root)
        throws Exception {
        var service = new TenantSandboxService(mock(SandboxLifecycleFacade.class), mock(OpenSandboxClient.class),
            mock(SandboxServiceSpecRepository.class), mock(SsSandboxRecordMapper.class), new ObjectMapper(),
            "db-image", root.toString(), "node-image", "redis", "6379", "0", "default", "password",
            "http://be", "token", "host");
        var prepare = TenantSandboxService.class.getDeclaredMethod("prepareEntrypoint", long.class);
        prepare.setAccessible(true);
        prepare.invoke(service, 10291508L);
        Path data = root.resolve("tenants/10291508/opengauss/data");
        assertThat(data).isDirectory();
        assertThat(Files.getPosixFilePermissions(data)).containsExactlyInAnyOrder(
            java.nio.file.attribute.PosixFilePermission.OWNER_READ,
            java.nio.file.attribute.PosixFilePermission.OWNER_WRITE,
            java.nio.file.attribute.PosixFilePermission.OWNER_EXECUTE);
        Files.writeString(data.resolve("keep"), "existing database data");
        prepare.invoke(service, 10291508L);
        assertThat(Files.readString(data.resolve("keep"))).isEqualTo("existing database data");
    }

    @Test
    void deletionReleasesNodeAndDatabaseAndRemovesOnlyTheSelectedTenantVolume(@TempDir Path root)
        throws IOException {
        long tenantId = 11222154L;
        Path selected = root.resolve("tenants").resolve(Long.toString(tenantId));
        Path other = root.resolve("tenants").resolve("11221076");
        Files.createDirectories(selected.resolve("opengauss"));
        Files.createDirectories(selected.resolve("node"));
        Files.createDirectories(other);
        Files.writeString(selected.resolve("opengauss/data"), "private database");
        Files.writeString(other.resolve("keep"), "another tenant");
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        SsSandboxRecord node = tenantRecord(10L, "node-id");
        SsSandboxRecord db = tenantRecord(11L, "db-id");
        when(records.selectTenantRecords(tenantId)).thenReturn(List.of(node, db));
        when(records.markReleased(eq(10L), eq("tenant deleted"), any(Date.class), eq(1))).thenReturn(1);
        when(records.markReleased(eq(11L), eq("tenant deleted"), any(Date.class), eq(1))).thenReturn(1);
        TenantSandboxService service = new TenantSandboxService(mock(SandboxLifecycleFacade.class), client,
            mock(SandboxServiceSpecRepository.class), records, new ObjectMapper(), "db-image", root.toString(),
            "node-image", "redis", "6379", "0", "default", "password", "http://be", "token", "host");

        service.deleteTenantResources(tenantId);

        InOrder order = inOrder(client, records);
        order.verify(client).deleteSandbox("node-id");
        order.verify(records).markReleased(eq(10L), eq("tenant deleted"), any(Date.class), eq(1));
        order.verify(client).deleteSandbox("db-id");
        order.verify(records).markReleased(eq(11L), eq("tenant deleted"), any(Date.class), eq(1));
        assertThat(Files.exists(selected)).isFalse();
        assertThat(Files.exists(other.resolve("keep"))).isTrue();
    }

    @Test
    void providerFailureKeepsPrivateVolumeForRetry(@TempDir Path root) throws IOException {
        long tenantId = 11222154L;
        Path selected = root.resolve("tenants").resolve(Long.toString(tenantId));
        Files.createDirectories(selected);
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        when(records.selectTenantRecords(tenantId)).thenReturn(List.of(tenantRecord(10L, "node-id")));
        doThrow(new IllegalStateException("provider unavailable")).when(client).deleteSandbox("node-id");
        TenantSandboxService service = new TenantSandboxService(mock(SandboxLifecycleFacade.class), client,
            mock(SandboxServiceSpecRepository.class), records, new ObjectMapper(), "db-image", root.toString(),
            "node-image", "redis", "6379", "0", "default", "password", "http://be", "token", "host");

        assertThatThrownBy(() -> service.deleteTenantResources(tenantId))
            .isInstanceOf(IllegalStateException.class);
        assertThat(Files.exists(selected)).isTrue();
        verify(records, never()).markReleased(eq(10L), any(), any(Date.class), eq(1));
    }

    @Test
    void retriesReuseAcsDatabaseAndNodeThroughProviderNeutralLifecycle() {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var legacy = mock(OpenSandboxClient.class);
        var records = mock(SsSandboxRecordMapper.class);
        var service = new TenantSandboxService(lifecycle, legacy,
            mock(SandboxServiceSpecRepository.class), records, new ObjectMapper(), "db-image", "/tmp",
            "node-image", "redis", "6379", "0", "default", "password", "http://be", "token", "host");
        for (String type : List.of("tenant-opengauss", "tenant-data-node")) {
            SsSandboxRecord record = tenantRecord(44L, "namespace--acs-" + type);
            record.setSandboxType(type);
            record.setServiceType(type);
            record.setUserCode("tenant-12");
            record.setEndpoint("tenant-opengauss".equals(type) ? "tcp://192.0.2.4:5432" : "http://gateway/node");
            when(records.selectActiveTenantByResourceAndType(12L, type)).thenReturn(record);
            var observed = com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance.builder()
                .sandboxId(record.getSandboxId()).state("Running").build();
            when(lifecycle.getSandbox(any())).thenReturn(
                com.iwhalecloud.byai.common.feign.response.SandboxResponse.success(observed));
            var result = "tenant-opengauss".equals(type)
                ? service.launchOpenGauss(12L, "m", "byclaw_t_12", "bc_t_12_admin", "password")
                : service.launchDataNode(12L, "m", 20L, 1L);
            assertThat(result.recordId()).isEqualTo(44L);
            assertThat(result.sandboxId()).isEqualTo(record.getSandboxId());
            verify(lifecycle).getSandbox(org.mockito.ArgumentMatchers.argThat(info ->
                record.getSandboxId().equals(info.getSandboxId()) && type.equals(info.getSandboxType())
                    && type.equals(info.getServiceKey()) && "tenant-12".equals(info.getUserCode())));
        }
        verify(lifecycle, never()).launchSandbox(any());
        verify(records, never()).insert(any(SsSandboxRecord.class));
        org.mockito.Mockito.verifyNoInteractions(legacy);
    }

    @Test
    void providerQueryFailureCannotRetireOrReplaceExistingDatabase() {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var legacy = mock(OpenSandboxClient.class);
        var records = mock(SsSandboxRecordMapper.class);
        var service = new TenantSandboxService(lifecycle, legacy,
            mock(SandboxServiceSpecRepository.class), records, new ObjectMapper(), "db-image", "/tmp",
            "node-image", "redis", "6379", "0", "default", "password", "http://be", "token", "host");
        var record = tenantRecord(44L, "namespace--existing-db");
        record.setSandboxType("tenant-opengauss");
        record.setEndpoint("tcp://192.0.2.4:5432");
        when(records.selectActiveTenantByResourceAndType(12L, "tenant-opengauss")).thenReturn(record);
        when(lifecycle.getSandbox(any())).thenReturn(
            com.iwhalecloud.byai.common.feign.response.SandboxResponse.error("provider unavailable"));
        assertThatThrownBy(() -> service.launchOpenGauss(12L, "m", "byclaw_t_12", "bc_t_12_admin", "password"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("tenant.sandbox.provider.unavailable");
        verify(records, never()).updateStatusToFailed(any(), any(), any(), any());
        verify(lifecycle, never()).launchSandbox(any());
        org.mockito.Mockito.verifyNoInteractions(legacy);
    }

    private SsSandboxRecord tenantRecord(long id, String sandboxId) {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(id);
        record.setSandboxId(sandboxId);
        record.setStatus("RUNNING");
        record.setLockVersion(1);
        return record;
    }

    @Test
    void recreatesNodeSandboxFromImageWithoutReplacingDatabase() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        TenantSandboxService service = spy(new TenantSandboxService(mock(SandboxLifecycleFacade.class), client,
            mock(SandboxServiceSpecRepository.class), records, new ObjectMapper(), "db-image", "/tmp",
            "node-image", "redis", "6379", "0", "default", "password", "http://be", "token",
            "host.containers.internal"));
        SsSandboxRecord old = new SsSandboxRecord();
        old.setId(30L);
        old.setSandboxId("old-sandbox");
        old.setStatus("RUNNING");
        old.setLockVersion(2);
        when(records.selectActiveTenantByResourceAndType(11221076L, "tenant-data-node")).thenReturn(old);
        when(records.updateStatusToReleased(eq(30L), eq("tenant Node image replacement"), any(Date.class),
            eq(2))).thenReturn(1);
        TenantSandboxService.TenantSandboxView fresh = new TenantSandboxService.TenantSandboxView(
            31L, "fresh-sandbox", "/v1/sandboxes/fresh-sandbox/proxy/3100");
        doReturn(fresh).when(service).launchDataNode(11221076L, "s", 22L, 1L);

        assertThat(service.recreateDataNode(11221076L, "s", 22L, 1L)).isSameAs(fresh);

        InOrder order = inOrder(client, records, service);
        order.verify(client).deleteSandbox("old-sandbox");
        order.verify(records).updateStatusToReleased(eq(30L), eq("tenant Node image replacement"),
            any(Date.class), eq(2));
        order.verify(service).launchDataNode(11221076L, "s", 22L, 1L);
    }

    @Test
    void releasesFailedDatabaseRecordBeforeRecreatingOnTheSameTenant() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
        TenantSandboxService service = new TenantSandboxService(mock(SandboxLifecycleFacade.class), client,
            mock(SandboxServiceSpecRepository.class), records, new ObjectMapper(), "db-image", "/tmp",
            "node-image", "redis", "6379", "0", "default", "password", "http://be", "token",
            "host.containers.internal");
        SsSandboxRecord failed = new SsSandboxRecord();
        failed.setId(44L);
        failed.setStatus("FAILED");
        failed.setSandboxId("old-db");
        failed.setLockVersion(3);
        when(records.selectLatestTenantByResourceAndType(11221076L, "tenant-opengauss")).thenReturn(failed);
        when(records.markReleased(eq(44L), eq("tenant sandbox restart"), any(Date.class), eq(3)))
            .thenReturn(1);

        service.releaseForReplacement(11221076L, "tenant-opengauss", 44L);

        InOrder order = inOrder(client, records);
        order.verify(client).deleteSandbox("old-db");
        order.verify(records).markReleased(eq(44L), eq("tenant sandbox restart"), any(Date.class), eq(3));
        assertThatThrownBy(() -> service.releaseForReplacement(11221076L, "tenant-opengauss", 43L))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void reportsProviderStateWithoutTreatingAnUnreachableProviderAsStopped() {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        TenantSandboxService service = new TenantSandboxService(lifecycle, client,
            mock(SandboxServiceSpecRepository.class), mock(SsSandboxRecordMapper.class), new ObjectMapper(),
            "db-image", "/tmp", "node-image", "redis", "6379", "0", "default", "password",
            "http://be", "token", "host.containers.internal");
        SsSandboxRecord record = tenantRecord(45L, "tenant-sandbox");
        var running = com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance.builder()
            .sandboxId("tenant-sandbox").state("Running").build();
        when(lifecycle.getSandbox(any()))
            .thenReturn(com.iwhalecloud.byai.common.feign.response.SandboxResponse.success(running))
            .thenReturn(com.iwhalecloud.byai.common.feign.response.SandboxResponse.success(null))
            .thenReturn(com.iwhalecloud.byai.common.feign.response.SandboxResponse.error("provider unavailable"));

        assertThat(service.providerStatus(record)).isEqualTo("RUNNING");
        assertThat(service.providerStatus(record)).isEqualTo("MISSING");
        assertThat(service.providerStatus(record)).isEqualTo("UNKNOWN");
        org.mockito.Mockito.verifyNoInteractions(client);
    }
}
