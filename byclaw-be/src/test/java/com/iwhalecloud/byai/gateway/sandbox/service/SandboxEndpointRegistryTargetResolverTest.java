package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SandboxEndpointRegistryTargetResolverTest {

    private final SandboxEndpointRegistryTargetResolver resolver = new SandboxEndpointRegistryTargetResolver();

    @Test
    void resolve_uiAgentUsesSandboxProxyPathPrefix() {
        SandboxEndpointRegistryTarget target = resolver.resolve(
            "https://gateway.example.test:18082/sandboxes/sb-1/proxy/8080/?gatewayUrl=wss://gateway.example.test:18082/sandboxes/sb-1/proxy/8080/",
            "uiagent", "sb-1", 8080);

        assertThat(target.protocol()).isEqualTo("https");
        assertThat(target.host()).isEqualTo("gateway.example.test");
        assertThat(target.port()).isEqualTo(18082);
        assertThat(target.pathPrefix()).isEqualTo("sandboxes/sb-1/proxy/8080/");
    }

    @Test
    void resolve_openclawKeepsRootPathPrefix() {
        SandboxEndpointRegistryTarget target = resolver.resolve(
            "https://gateway.example.test:8443/sandboxes/sb-1/proxy/18789/chat?token=ztesoft",
            "openclaw", "sb-1", 18789);

        assertThat(target.pathPrefix()).isEqualTo("/");
    }
}
