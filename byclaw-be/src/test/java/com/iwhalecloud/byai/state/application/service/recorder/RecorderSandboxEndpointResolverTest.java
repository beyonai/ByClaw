package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeSupport;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.net.URI;
import java.util.List;
import okhttp3.HttpUrl;
import org.junit.jupiter.api.Test;

class RecorderSandboxEndpointResolverTest {

    private static final RecorderOwner OWNER = new RecorderOwner(42L, "user-42");

    @Test
    void resolvesBycliProxyPathForCurrentUser() {
        SandboxIngressEndpointResolver endpointResolver = mock(SandboxIngressEndpointResolver.class);
        when(endpointResolver.resolveRequiredEndpoint("user-42", "bycli"))
            .thenReturn("/v1/sandboxes/sandbox-42/proxy/19825");
        SandboxIngressRuntimeSupport runtimeSupport = mock(SandboxIngressRuntimeSupport.class);
        when(runtimeSupport.supports("minio")).thenReturn(true);
        when(runtimeSupport.buildTargetUrl("/v1/sandboxes/sandbox-42/proxy/19825", "/status", null))
            .thenReturn(HttpUrl.get("http://sandbox-gateway/v1/sandboxes/sandbox-42/proxy/19825/status"));
        SandboxIngressRuntimeResolver runtimeResolver = new SandboxIngressRuntimeResolver(List.of(runtimeSupport), "minio");

        URI result = new RecorderSandboxEndpointResolver(endpointResolver, runtimeResolver)
            .resolve(OWNER, "bycli", "/status");

        assertThat(result).isEqualTo(URI.create("http://sandbox-gateway/v1/sandboxes/sandbox-42/proxy/19825/status"));
    }

    @Test
    void failsWhenInstanceEndpointIsMissing() {
        SandboxIngressEndpointResolver endpointResolver = mock(SandboxIngressEndpointResolver.class);
        when(endpointResolver.resolveRequiredEndpoint("user-42", "vnc"))
            .thenThrow(new IllegalStateException("missing vnc endpoint"));

        assertThatThrownBy(() -> new RecorderSandboxEndpointResolver(endpointResolver, mock(SandboxIngressRuntimeResolver.class))
            .resolve(OWNER, "vnc", "/"))
            .isInstanceOf(RecorderBrowserException.class)
            .hasFieldOrPropertyWithValue("code", "daemon_unavailable");
    }
}
