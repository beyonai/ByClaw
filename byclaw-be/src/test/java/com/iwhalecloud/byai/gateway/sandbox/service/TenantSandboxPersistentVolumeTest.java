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
}
