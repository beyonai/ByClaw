package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;

class OpenClawFileBrowserProviderTest {

    private final OpenClawFileBrowserProvider provider = new OpenClawFileBrowserProvider(
        mock(SandboxIngressEndpointResolver.class),
        mock(SandboxIngressRuntimeResolver.class),
        new ObjectMapper()
    );

    @Test
    void resolvePathKeepsLeadingSlashAsSingleRoot() {
        String path = invokeResolvePath("/.openclaw/workspace-baiying-agent-10005856/");

        assertThat(path).isEqualTo("/.openclaw/workspace-baiying-agent-10005856/");
    }

    @Test
    void resolvePathAddsLeadingSlashWhenMissing() {
        String path = invokeResolvePath(".openclaw/workspace-baiying-agent-10005856/");

        assertThat(path).isEqualTo("/.openclaw/workspace-baiying-agent-10005856/");
    }

    @Test
    void resolvePathCollapsesRepeatedLeadingSlashes() {
        String path = invokeResolvePath("//.openclaw/workspace-baiying-agent-10005856/");

        assertThat(path).isEqualTo("/.openclaw/workspace-baiying-agent-10005856/");
    }

    @Test
    void resolvePathUsesRootForBlankPath() {
        assertThat(invokeResolvePath(null)).isEqualTo("/");
        assertThat(invokeResolvePath("")).isEqualTo("/");
        assertThat(invokeResolvePath("/")).isEqualTo("/");
    }

    private String invokeResolvePath(String relativePath) {
        return ReflectionTestUtils.invokeMethod(provider, "resolvePath", relativePath);
    }
}
