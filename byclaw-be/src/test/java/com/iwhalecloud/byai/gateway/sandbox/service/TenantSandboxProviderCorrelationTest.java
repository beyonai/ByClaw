package com.iwhalecloud.byai.gateway.sandbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import java.nio.file.Path;
import java.util.Map;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantSandboxProviderCorrelationTest {
    private TenantSandboxService service(Path root, SandboxLifecycleFacade lifecycle,
        SsSandboxRecordMapper records) {
        doAnswer(invocation -> {
            invocation.<com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord>getArgument(0).setId(31L);
            return 1;
        }).when(records).insert(any(com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord.class));
        var specs = mock(SandboxServiceSpecRepository.class);
        var spec = new SandboxServiceSpec();
        spec.setOwnerScope("TENANT");
        spec.setResourceLimits(Map.of("cpu", "1", "memory", "1Gi"));
        when(specs.findByServiceKeyAndProfile(anyString(), eq("s"))).thenReturn(Optional.of(spec));
        var service = new TenantSandboxService(lifecycle, mock(OpenSandboxClient.class), specs,
            records, new ObjectMapper(), "db", root.toString(), "node", "localhost", "6379", "0",
            "default", "password", "http://be", "token", "localhost");
        ReflectionTestUtils.setField(service, "tenantPolicyConfigs", mock(TenantAdminTenantMapper.class));
        return service;
    }

    @Test void databaseRequestRetainsPersistedCorrelationAlongsideOwnership(@TempDir Path root) {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var service = service(root, lifecycle, mock(SsSandboxRecordMapper.class));
        assertThrows(ResponseStatusException.class,
            () -> service.launchOpenGauss(12L, "s", "byclaw_t_12", "bc_t_12_admin", "password", "command-41:DB_CREATE"));
        var request = ArgumentCaptor.forClass(SandboxLaunchRequest.class);
        verify(lifecycle).launchSandbox(request.capture());
        assertEquals("command-41:DB_CREATE", request.getValue().getMetadata().get("providerRequestKey"));
        assertEquals("TENANT", request.getValue().getMetadata().get("ownerScope"));
        assertEquals("12", request.getValue().getMetadata().get("enterpriseId"));
        assertEquals("5432", request.getValue().getMetadata().get("byclawTcpPort"));
    }

    @Test void nodeRequestRetainsPersistedCorrelationAlongsideOwnership(@TempDir Path root) {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var service = service(root, lifecycle, mock(SsSandboxRecordMapper.class));
        assertThrows(ResponseStatusException.class,
            () -> service.launchDataNode(12L, "s", 20L, 1L, "command-41:NODE_CREATE"));
        var request = ArgumentCaptor.forClass(SandboxLaunchRequest.class);
        verify(lifecycle).launchSandbox(request.capture());
        assertEquals("command-41:NODE_CREATE", request.getValue().getMetadata().get("providerRequestKey"));
        assertEquals("TENANT", request.getValue().getMetadata().get("ownerScope"));
        assertEquals("12", request.getValue().getMetadata().get("enterpriseId"));
    }

    @Test void malformedCorrelationIsRejectedBeforeAnyResourceMutation(@TempDir Path root) {
        var lifecycle = mock(SandboxLifecycleFacade.class);
        var records = mock(SsSandboxRecordMapper.class);
        var service = service(root, lifecycle, records);
        assertThrows(IllegalArgumentException.class,
            () -> service.launchDataNode(12L, "s", 20L, 1L, "invalid key"));
        assertThrows(IllegalArgumentException.class,
            () -> service.launchOpenGauss(12L, "s", "byclaw_t_12", "bc_t_12_admin", "password", "x".repeat(129)));
        verifyNoInteractions(records, lifecycle);
    }
}
