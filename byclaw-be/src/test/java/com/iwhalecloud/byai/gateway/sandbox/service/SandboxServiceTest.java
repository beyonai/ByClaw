package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;

class SandboxServiceTest {

    @Test
    void sandboxInfo_hydratesGatewayTokenFromCachedEndpoint() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        SandboxInfo cached = SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .userCode("user001")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .build();
        when(sandboxMetadataCache.listByUser("user001")).thenReturn(List.of(cached));

        List<SandboxInfo> result = sandboxService.sandboxInfo("user001");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGatewayToken()).isEqualTo("0123456789abcdef0123456789abcdef");
    }
}
