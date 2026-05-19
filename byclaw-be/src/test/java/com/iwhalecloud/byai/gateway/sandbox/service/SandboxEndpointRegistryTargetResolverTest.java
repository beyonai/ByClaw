package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SandboxEndpointRegistryTargetResolverTest {

    private final SandboxEndpointRegistryTargetResolver resolver = new SandboxEndpointRegistryTargetResolver();

    @Test
    void resolve_keepsRootPathPrefixForUiAgentEndpoint() {
        SandboxEndpointRegistryTarget target = resolver.resolve(
            "https://gateway.example.test:18082/sandboxes/sb-1/proxy/8080/chat?token=ztesoft");

        assertThat(target.protocol()).isEqualTo("https");
        assertThat(target.host()).isEqualTo("gateway.example.test");
        assertThat(target.port()).isEqualTo(18082);
        assertThat(target.pathPrefix()).isEqualTo("/");
    }

    @Test
    void resolve_keepsRootPathPrefixForOpenclawEndpoint() {
        SandboxEndpointRegistryTarget target = resolver.resolve(
            "https://gateway.example.test:8443/sandboxes/sb-1/proxy/18789/chat?token=ztesoft");

        assertThat(target.pathPrefix()).isEqualTo("/");
    }
}
