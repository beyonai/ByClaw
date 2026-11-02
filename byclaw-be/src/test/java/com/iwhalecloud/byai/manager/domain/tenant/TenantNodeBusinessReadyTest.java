package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

class TenantNodeBusinessReadyTest {
    @Test void waitsForBusinessReadyRatherThanProvisioningReady() throws Exception {
        try (Fixture f = new Fixture()) {
            f.responses.set("delayed");
            await(f, Duration.ofSeconds(3));
            assertEquals(2, f.calls.get());
        }
    }

    @Test void wrongTenantGenerationOrDatabaseCanNeverCompleteBusinessHandshake() throws Exception {
        for (String field : new String[]{"enterpriseId", "generation", "dbSandboxRecordId"}) {
            try (Fixture f = new Fixture()) {
                f.responses.set(field);
                var error = assertThrows(IllegalStateException.class, () -> await(f, Duration.ofSeconds(3)));
                assertTrue(error.getMessage().contains("identity mismatch"));
                assertEquals(1, f.calls.get());
            }
        }
    }

    @Test void staleDiscoveryRegistrationIsRetriedWithoutCallingItsMismatchedEndpoint() throws Exception {
        try (Fixture f = new Fixture()) {
            f.responses.set("delayed");
            when(f.client.schemaEndpoint(12, 3, 20))
                .thenThrow(new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "tenant.node.registration.mismatch"))
                .thenThrow(new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "tenant.node.registration.unavailable"))
                .thenReturn(f.base);
            await(f, Duration.ofSeconds(3));
            assertEquals(2, f.calls.get());
            verify(f.client, times(4)).schemaEndpoint(12, 3, 20);
        }
    }

    @Test void provisioningReadyWithoutBusinessReadyTimesOut() throws Exception {
        try (Fixture f = new Fixture()) {
            f.responses.set("never");
            var error = assertThrows(IllegalStateException.class, () -> await(f, Duration.ofMillis(200)));
            assertTrue(error.getMessage().contains("timed out"));
            assertTrue(f.calls.get() > 0);
        }
    }

    private static void await(Fixture f, Duration budget) throws Exception {
        var method = TenantNodeSchemaService.class.getDeclaredMethod("awaitBusinessReady", long.class,
            long.class, long.class, TenantSandboxView.class, Duration.class, Duration.class);
        method.setAccessible(true);
        try {
            method.invoke(f.service, 12L, 3L, 20L,
                new TenantSandboxView(30L, "node", "http://127.0.0.1:1/unverified-provider"),
                budget, Duration.ofMillis(1));
        } catch (java.lang.reflect.InvocationTargetException e) {
            if (e.getCause() instanceof Exception error) throw error;
            throw e;
        }
    }

    private static final class Fixture implements AutoCloseable {
        final HttpServer server;
        final AtomicReference<String> responses = new AtomicReference<>();
        final AtomicInteger calls = new AtomicInteger();
        final TenantNodeSchemaService service;
        final TenantNodeClient client = mock(TenantNodeClient.class);
        final URI base;
        Fixture() throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext("/internal/v1/health/ready", exchange -> {
                int call = calls.incrementAndGet();
                var json = new ObjectMapper().createObjectNode().put("enterpriseId", "12")
                    .put("generation", "3").put("dbSandboxRecordId", "20").put("ready", true)
                    .put("businessReady", !"never".equals(responses.get()) && call > 1);
                if (!"delayed".equals(responses.get()) && !"never".equals(responses.get())) {
                    json.put(responses.get(), "wrong"); json.put("businessReady", true);
                }
                byte[] bytes = json.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, bytes.length);
                exchange.getResponseBody().write(bytes); exchange.close();
            });
            server.start();
            base = URI.create("http://127.0.0.1:" + server.getAddress().getPort());
            when(client.schemaEndpoint(12, 3, 20)).thenReturn(base);
            service = new TenantNodeSchemaService(null, new ObjectMapper(), "", "fixture-token", client);
        }
        public void close() { server.stop(0); }
    }
}
