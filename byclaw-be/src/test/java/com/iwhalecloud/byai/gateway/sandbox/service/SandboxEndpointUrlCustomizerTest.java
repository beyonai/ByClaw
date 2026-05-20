package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class SandboxEndpointUrlCustomizerTest {

    @Test
    void toAccessEndpoint_appendsChatTokenForBlankAndOpenclawImageType() {
        SandboxEndpointUrlCustomizer customizer = new SandboxEndpointUrlCustomizer("ztesoft");

        assertThat(customizer.toAccessEndpoint("http://host/proxy/18789"))
            .isEqualTo("http://host/proxy/18789/chat?token=ztesoft");
        assertThat(customizer.toAccessEndpoint("http://host/proxy/18789/"))
            .isEqualTo("http://host/proxy/18789/chat?token=ztesoft");
    }

    @Test
    void toAccessEndpoint_usesSameChatPathForUiAgentEndpoint() {
        SandboxEndpointUrlCustomizer customizer = new SandboxEndpointUrlCustomizer("ztesoft");

        assertThat(customizer.toAccessEndpoint("https://host:8443/sandboxes/sb-1/proxy/3000/"))
            .isEqualTo("https://host:8443/sandboxes/sb-1/proxy/3000/chat?token=ztesoft");
    }
}
