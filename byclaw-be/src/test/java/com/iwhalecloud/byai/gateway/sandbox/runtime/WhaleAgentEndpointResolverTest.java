package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

class WhaleAgentEndpointResolverTest {

    private static PortSpec port(int portNumber, String instance, String protocol) {
        PortSpec p = new PortSpec();
        p.setPort(portNumber);
        p.setInstance(instance);
        p.setProtocol(protocol);
        return p;
    }

    @Test
    void resolve_hitsGetSandboxEndpointForEachPortAndUsesServicePortAsPrimary() {
        FeignWhaleAgentService feign = mock(FeignWhaleAgentService.class);
        when(feign.getSandboxEndpoint(anyMap()))
            .thenAnswer(inv -> {
                Map<String, Object> req = inv.getArgument(0);
                Integer p = (Integer) req.get("port");
                if (p == 18789) {
                    return KnowledgeResponse.success(
                        "http://10.10.186.25:8080/knowledge/opensandbox2/v1/sandboxes/sb-1/proxy/18789");
                }
                return KnowledgeResponse.success(
                    "http://10.10.186.25:8080/knowledge/opensandbox2/v1/sandboxes/sb-1/proxy/3000");
            });

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);
        spec.setPorts(List.of(port(18789, "openclaw", "https"), port(3000, "ui", "http")));

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-1").build();

        List<String> endpoints = new WhaleAgentEndpointResolver(feign).resolve(instance, spec, "byclaw");

        assertThat(endpoints)
            .containsExactly("http://10.10.186.25:8080/knowledge/opensandbox2/v1/sandboxes/sb-1/proxy/18789");
        assertThat(instance.getInstanceEndpoints())
            .containsEntry("openclaw",
                "http://10.10.186.25:8080/knowledge/opensandbox2/v1/sandboxes/sb-1/proxy/18789")
            .containsEntry("ui",
                "http://10.10.186.25:8080/knowledge/opensandbox2/v1/sandboxes/sb-1/proxy/3000");

        ArgumentCaptor<Map<String, Object>> captor = ArgumentCaptor.forClass(Map.class);
        verify(feign, org.mockito.Mockito.times(2)).getSandboxEndpoint(captor.capture());
        Map<String, Object> firstCall = captor.getAllValues().get(0);
        assertThat(firstCall).containsEntry("sandboxId", "sb-1").containsEntry("sandboxType", "byclaw");
        assertThat(firstCall).containsKey("port");
    }

    @Test
    void resolve_fallsBackToServicePortWhenPortsListEmpty() {
        FeignWhaleAgentService feign = mock(FeignWhaleAgentService.class);
        when(feign.getSandboxEndpoint(anyMap()))
            .thenReturn(KnowledgeResponse.success("http://sandbox.example/proxy/18789"));

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-2").build();

        List<String> endpoints = new WhaleAgentEndpointResolver(feign).resolve(instance, spec, "byclaw");

        assertThat(endpoints).containsExactly("http://sandbox.example/proxy/18789");
        assertThat(instance.getInstanceEndpoints()).containsEntry("openclaw", "http://sandbox.example/proxy/18789");
    }

    @Test
    void resolve_returnsEmptyWhenSandboxIdMissing() {
        FeignWhaleAgentService feign = mock(FeignWhaleAgentService.class);
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);

        List<String> endpoints = new WhaleAgentEndpointResolver(feign)
            .resolve(SandboxRuntimeInstance.builder().build(), spec, "byclaw");

        assertThat(endpoints).isEmpty();
        verify(feign, org.mockito.Mockito.never()).getSandboxEndpoint(anyMap());
    }

    @Test
    void resolve_skipsPortsWhereFeignReturnsFailureOrBlank() {
        FeignWhaleAgentService feign = mock(FeignWhaleAgentService.class);
        // Port 18789 succeeds; port 3000 returns failure code — must be dropped, not error.
        KnowledgeResponse<String> failure = new KnowledgeResponse<>();
        failure.setResultCode("-1");
        failure.setResultMsg("endpoint not ready");
        when(feign.getSandboxEndpoint(anyMap()))
            .thenAnswer(inv -> {
                Map<String, Object> req = inv.getArgument(0);
                if ((Integer) req.get("port") == 18789) {
                    return KnowledgeResponse.success("http://sandbox.example/proxy/18789");
                }
                return failure;
            });

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);
        spec.setPorts(List.of(port(18789, "openclaw", "https"), port(3000, "ui", "http")));

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-3").build();

        List<String> endpoints = new WhaleAgentEndpointResolver(feign).resolve(instance, spec, "byclaw");

        assertThat(endpoints).containsExactly("http://sandbox.example/proxy/18789");
        assertThat(instance.getInstanceEndpoints()).doesNotContainKey("ui");
    }

    @Test
    void resolve_swallowsFeignExceptionAndReturnsEmpty() {
        FeignWhaleAgentService feign = mock(FeignWhaleAgentService.class);
        when(feign.getSandboxEndpoint(anyMap())).thenThrow(new RuntimeException("boom"));

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);
        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-4").build();

        List<String> endpoints = new WhaleAgentEndpointResolver(feign).resolve(instance, spec, "byclaw");

        assertThat(endpoints).isEmpty();
        assertThat(instance.getInstanceEndpoints()).isNullOrEmpty();
    }
}
