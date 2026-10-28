package com.iwhalecloud.byai.gateway.sandbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformTenantFileRouting;
import com.iwhalecloud.byai.gateway.sandbox.spec.*;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantSandboxPersistentVolumeTest {
    @Test void providerManagedStorageDoesNotPrepareAnUnrelatedBeMountedDirectory() throws Exception {
        var spec = new ObjectMapper().readValue("""
            {"ownerScope":"TENANT","resourceLimits":{"cpu":"2","memory":"4Gi"},
             "volumes":[{"type":"persistent","volumeRef":"workspace","scope":"PRIVATE",
               "subPath":"tenants/${TENANT_ID}/opengauss/data","mountPath":"/var/lib/opengauss/data"}]}
            """, SandboxServiceSpec.class);
        var specs = mock(SandboxServiceSpecRepository.class);
        when(specs.findByServiceKeyAndProfile("tenant-opengauss", "m")).thenReturn(Optional.of(spec));
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var files = mock(PlatformTenantFileRouting.class);
        when(files.isRemote()).thenReturn(true);
        var records = mock(SsSandboxRecordMapper.class);
        doAnswer(call -> { call.<com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord>getArgument(0).setId(31L); return 1; })
            .when(records).insert(any(com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord.class));
        var service = new TenantSandboxService(lifecycle, mock(OpenSandboxClient.class), specs,
            records, new ObjectMapper(), "tenant-db", "/not-a-mounted-volume",
            "node", "redis", "6379", "0", "default", "password", "http://be", "token", "host.containers.internal");
        ReflectionTestUtils.setField(service, "platformTenantFiles", files);
        assertThrows(ResponseStatusException.class, () -> service.launchOpenGauss(42,"m","byclaw_t_42","bc_t_42_admin","password"));
        verify(lifecycle).launchSandbox(any());
        verify(files, never()).prepare(any(), any(), any());
        verify(files, never()).copy(any(), any(), any());
    }
    @Test void deletionPurgesNasOnlyAfterProviderAbsenceAndPropagatesPendingCleanup() throws Exception {
        var spec = new ObjectMapper().readValue("{\"volumes\":[{\"type\":\"persistent\"}]}", SandboxServiceSpec.class);
        var specs = mock(SandboxServiceSpecRepository.class);
        when(specs.findByServiceKey("tenant-opengauss")).thenReturn(Optional.of(spec));
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var files = mock(PlatformTenantFileRouting.class);
        when(files.isRemote()).thenReturn(true);
        var records = mock(SsSandboxRecordMapper.class);
        var record = new com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord();
        record.setId(31L); record.setSandboxId("namespace--db"); record.setSandboxType("tenant-opengauss");
        record.setServiceType("tenant-opengauss"); record.setUserCode("tenant-42");
        record.setStatus("RELEASED"); record.setLockVersion(2);
        when(records.selectTenantRecords(42L)).thenReturn(List.of(record));
        var service = new TenantSandboxService(lifecycle, mock(OpenSandboxClient.class), specs,
            records, new ObjectMapper(), "db", "/not-mounted", "node", "redis", "6379", "0",
            "default", "password", "http://be", "token", "host");
        ReflectionTestUtils.setField(service, "platformTenantFiles", files);
        when(lifecycle.removeSandbox(any())).thenReturn(com.iwhalecloud.byai.common.feign.response.SandboxResponse.success(null));
        var running = com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance.builder().state("Running").build();
        when(lifecycle.getSandbox(any())).thenReturn(com.iwhalecloud.byai.common.feign.response.SandboxResponse.success(running));
        assertThrows(ResponseStatusException.class, () -> service.deleteTenantResources(42L));
        verify(files, never()).purgeTenant(anyLong());
        when(lifecycle.getSandbox(any())).thenReturn(com.iwhalecloud.byai.common.feign.response.SandboxResponse.success(null));
        doThrow(new ResponseStatusException(org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "cleanup pending"))
            .doNothing().when(files).purgeTenant(42L);
        assertThrows(ResponseStatusException.class, () -> service.deleteTenantResources(42L));
        assertDoesNotThrow(() -> service.deleteTenantResources(42L));
        verify(files, times(2)).purgeTenant(42L);
        verify(files, never()).delete(any(), any(), any());
    }

}
