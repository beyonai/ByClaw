package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
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
    void resolve_usesServicePortOnlyForOpenclaw() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        when(client.getSandboxEndpoint("sb-1", 18789))
            .thenReturn(new SandboxEndpoint("sandbox.example.test:8443/sandboxes/sb-1/proxy/18789", Map.of("X", "Y")));
        when(client.getSandboxEndpoint("sb-1", 3000))
            .thenReturn(new SandboxEndpoint("sandbox.example.test:8443/sandboxes/sb-1/proxy/3000", null));

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(18789);
        spec.setPorts(List.of(port(18789, "openclaw", "https"), port(3000, "ui", "http")));

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-1").build();

        List<String> endpoints = new OpenSandboxEndpointResolver(client, new SandboxProperties()).resolve(instance, spec);

        assertThat(endpoints).containsExactly("https://sandbox.example.test:8443/sandboxes/sb-1/proxy/18789");
        assertThat(instance.getInstanceEndpoints())
            .containsEntry("openclaw", "https://sandbox.example.test:8443/sandboxes/sb-1/proxy/18789")
            .containsEntry("ui", "/v1/sandboxes/sb-1/proxy/3000");
        assertThat(instance.getEndpointHeaders()).containsEntry("X", "Y");
        verify(client).getSandboxEndpoint("sb-1", 18789);
        verify(client).getSandboxEndpoint("sb-1", 3000);
    }

    @Test
    void resolve_usesServicePortOnlyForUiAgent() {
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(3000);
        spec.setPorts(List.of(port(3000, "openclaw", "https"), port(9222, "debug", "http")));

        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-2").build();
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        when(client.getSandboxEndpoint("sb-2", 3000))
            .thenReturn(new SandboxEndpoint("sandbox.example.test:8443/sandboxes/sb-2/proxy/3000", null));
        when(client.getSandboxEndpoint("sb-2", 9222))
            .thenReturn(new SandboxEndpoint("sandbox.example.test:8443/sandboxes/sb-2/proxy/9222", null));

        List<String> endpoints = new OpenSandboxEndpointResolver(client, new SandboxProperties()).resolve(instance, spec);

        assertThat(endpoints).containsExactly("https://sandbox.example.test:8443/sandboxes/sb-2/proxy/3000");
        assertThat(instance.getInstanceEndpoints())
            .containsEntry("openclaw", "https://sandbox.example.test:8443/sandboxes/sb-2/proxy/3000")
            .containsEntry("debug", "/v1/sandboxes/sb-2/proxy/9222");
        verify(client).getSandboxEndpoint("sb-2", 3000);
        verify(client).getSandboxEndpoint("sb-2", 9222);
    }

    @Test
    void resolve_blankImageTypeKeepsExistingPortListRule() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        when(client.getSandboxEndpoint("sb-3", 1000)).thenReturn(new SandboxEndpoint("host:1000", null));
        when(client.getSandboxEndpoint("sb-3", 2000)).thenReturn(new SandboxEndpoint("http://host:2000", null));

        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setPorts(List.of(port(1000, "openclaw", "https"), port(2000, "svc-2000", "http")));
        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("sb-3").build();

        List<String> endpoints = new OpenSandboxEndpointResolver(client, new SandboxProperties()).resolve(instance, spec);

        assertThat(endpoints).containsExactly(
            "https://host:1000",
            "/v1/sandboxes/sb-3/proxy/2000");
        assertThat(instance.getInstanceEndpoints())
            .containsEntry("openclaw", "https://host:1000")
            .containsEntry("svc-2000", "/v1/sandboxes/sb-3/proxy/2000");
    }

    @Test
    void resolve_tcpPortUsesPublishedHostPortForJdbc() {
        OpenSandboxClient client = mock(OpenSandboxClient.class);
        when(client.getSandboxEndpoint("db-1", 5432, true))
            .thenReturn(new SandboxEndpoint("127.0.0.1:57865", null));
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServicePort(5432);
        spec.setPorts(List.of(port(5432, "opengauss", "tcp")));
        SandboxRuntimeInstance instance = SandboxRuntimeInstance.builder().sandboxId("db-1").build();

        List<String> endpoints = new OpenSandboxEndpointResolver(client, new SandboxProperties()).resolve(instance, spec);

        assertThat(endpoints).containsExactly("tcp://127.0.0.1:57865");
        assertThat(instance.getInstanceEndpoints()).containsEntry("opengauss", "tcp://127.0.0.1:57865");
    }

    @Test
    void tcpPortRequestsInternalEndpointInsteadOfKubernetesIngressPath() throws Exception {
        var query = new java.util.concurrent.atomic.AtomicReference<String>();
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/sandboxes/db-k3s/endpoints/5432", exchange -> {
            query.set(exchange.getRequestURI().getQuery());
            String endpoint = "resolve_internal=true".equals(query.get())
                ? "10.42.0.164:5432" : "gateway.example/v1/sandboxes/db-k3s/5432";
            byte[] response = ("{\"endpoint\":\"" + endpoint + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            try (var body = exchange.getResponseBody()) { body.write(response); }
        });
        server.start();
        try {
            var properties = new SandboxProperties();
            properties.getOpensandbox().setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            var client = new OpenSandboxClient(properties);
            var spec = new SandboxServiceSpec();
            spec.setServicePort(5432);
            spec.setPorts(List.of(port(5432, "opengauss", "tcp")));
            var instance = SandboxRuntimeInstance.builder().sandboxId("db-k3s").build();
            assertThat(new OpenSandboxEndpointResolver(client, properties).resolve(instance, spec))
                .containsExactly("tcp://10.42.0.164:5432");
            assertThat(query.get()).isEqualTo("resolve_internal=true");
        } finally { server.stop(0); }
    }

    private PortSpec port(int value, String instance, String protocol) {
        PortSpec portSpec = new PortSpec();
        portSpec.setPort(value);
        portSpec.setInstance(instance);
        portSpec.setProtocol(protocol);
        return portSpec;
    }
}
