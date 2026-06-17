package com.iwhalecloud.byai.gateway.sandbox.client;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.sun.net.httpserver.HttpServer;

class OpenSandboxClientTest {

    @Test
    void listSandboxesByMetadataUsesSingleEncodedMetadataQueryParameter() throws Exception {
        AtomicReference<String> rawQuery = new AtomicReference<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/v1/sandboxes", exchange -> {
            rawQuery.set(exchange.getRequestURI().getRawQuery());
            byte[] body = "[]".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(body);
            }
        });
        server.start();
        try {
            SandboxProperties properties = new SandboxProperties();
            properties.getOpensandbox().setBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
            properties.getOpensandbox().setApiKey("dev");
            OpenSandboxClient client = new OpenSandboxClient(properties);
            Map<String, String> metadata = new LinkedHashMap<>();
            metadata.put("userCode", "0027000620");
            metadata.put("serviceKey", "openclaw");

            client.listSandboxesByMetadataStrict(metadata, 1, 2);

            assertThat(rawQuery.get())
                .contains("page=1")
                .contains("pageSize=2")
                .contains("metadata=userCode%3D0027000620%26serviceKey%3Dopenclaw")
                .doesNotContain("userCode=0027000620")
                .doesNotContain("serviceKey=openclaw");
        }
        finally {
            server.stop(0);
        }
    }
}
