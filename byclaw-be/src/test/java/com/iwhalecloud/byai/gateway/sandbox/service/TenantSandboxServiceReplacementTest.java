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
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxStatus;
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
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        TenantSandboxService service = new TenantSandboxService(mock(SandboxLifecycleFacade.class), client,
            mock(SandboxServiceSpecRepository.class), mock(SsSandboxRecordMapper.class), new ObjectMapper(),
            "db-image", "/tmp", "node-image", "redis", "6379", "0", "default", "password",
            "http://be", "token", "host.containers.internal");
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(45L);
        record.setSandboxId("tenant-sandbox");
        SandboxDetail detail = new SandboxDetail();
        SandboxStatus status = new SandboxStatus();
        status.setState("Running");
        detail.setStatus(status);
        when(client.getSandboxIfExists("tenant-sandbox"))
            .thenReturn(detail)
            .thenReturn(null)
            .thenThrow(new IllegalStateException("provider unavailable"));

        assertThat(service.providerStatus(record)).isEqualTo("RUNNING");
        assertThat(service.providerStatus(record)).isEqualTo("MISSING");
        assertThat(service.providerStatus(record)).isEqualTo("UNKNOWN");
    }
}
