package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.spec.PortSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;

class OpenSandboxEndpointResolverTest {

    @Test
    void resolve_openclawUsesServicePortOnly() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        when(client.getSandboxEndpoint("sb-1", 18789))
            .thenReturn(new SandboxEndpoint("sandbox.example.test:8443/sandboxes/sb-1/proxy/18789", Map.of("X", "Y")));

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setImageType("openclaw");
        spec.setServicePort(18789);
        spec.setPorts(List.of(port(18789, "https"), port(3000, "http")));

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-1").build();

        List<String> endpoints = new OpenSandboxEndpointResolver(client, new SandboxProperties()).resolve(instance, spec);

        assertThat(endpoints).containsExactly("https://sandbox.example.test:8443/sandboxes/sb-1/proxy/18789");
        assertThat(instance.getEndpointHeaders()).containsEntry("X", "Y");
        verify(client).getSandboxEndpoint("sb-1", 18789);
        verify(client, never()).getSandboxEndpoint("sb-1", 3000);
    }

    @Test
    void resolve_uiAgentBuildsProxyEndpointFromConfiguredBaseUrl() {
        SandboxProperties properties = new SandboxProperties();
        properties.getOpensandbox().setUiAgentProxyBaseUrl("https://uiagent-proxy.example.test/sandboxes/");

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setImageType("uiagent");
        spec.setServicePort(3000);

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-2").build();
        OpenSandboxClient client = mock(OpenSandboxClient.class);

        List<String> endpoints = new OpenSandboxEndpointResolver(client, properties).resolve(instance, spec);

        assertThat(endpoints).containsExactly("https://uiagent-proxy.example.test/sandboxes/sb-2/proxy/3000/");
        verify(client, never()).getSandboxEndpoint("sb-2", 3000);
    }

    @Test
    void resolve_blankImageTypeKeepsExistingPortListRule() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        when(client.getSandboxEndpoint("sb-3", 1000)).thenReturn(new SandboxEndpoint("host:1000", null));
        when(client.getSandboxEndpoint("sb-3", 2000)).thenReturn(new SandboxEndpoint("http://host:2000", null));

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setPorts(List.of(port(1000, "https"), port(2000, "http")));
        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-3").build();

        List<String> endpoints = new OpenSandboxEndpointResolver(client, new SandboxProperties()).resolve(instance, spec);

        assertThat(endpoints).containsExactly("https://host:1000", "http://host:2000");
    }

    private PortSpec port(int value, String protocol) {
        PortSpec portSpec = new PortSpec();
        portSpec.setPort(value);
        portSpec.setProtocol(protocol);
        return portSpec;
    }
}
