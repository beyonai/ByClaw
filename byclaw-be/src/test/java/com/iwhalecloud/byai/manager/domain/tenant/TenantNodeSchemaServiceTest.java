package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.ZipInputStream;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class TenantNodeSchemaServiceTest {
    @org.junit.jupiter.api.Test
    void acsGatewayEndpointAcceptsHttpsAndNormalizesTrailingSlash() {
        var service = new TenantNodeSchemaService(null, new com.fasterxml.jackson.databind.ObjectMapper(), "", "", "", "token");
        var uri = (java.net.URI) org.springframework.test.util.ReflectionTestUtils.invokeMethod(service,
            "nodeUri", "https://tenant.example.test/kruise/node/3100/");
        org.junit.jupiter.api.Assertions.assertEquals("https://tenant.example.test/kruise/node/3100", uri.toString());
    }


    @Test
    void loadsBundledBaselineWhenNoExternalPathIsConfigured() throws Exception {
        byte[] bundle = service("").readBundle();
        try (ZipInputStream zip = new ZipInputStream(new java.io.ByteArrayInputStream(bundle))) {
            String sqlPath = zip.getNextEntry().getName();
            assertTrue(sqlPath.matches("baseline/V[0-9]+(\\.[0-9]+)*/__ddl\\.sql"));
            assertEquals(sqlPath.replace("__ddl.sql", "manifest.json"), zip.getNextEntry().getName());
        }
    }

    @Test
    void selectsNewestVersionNumerically() {
        assertTrue(TenantNodeSchemaService.compareVersions("V0.10.0", "V0.9.0") > 0);
        assertTrue(TenantNodeSchemaService.compareVersions("V1.0", "V0.99.99") > 0);
    }

    @Test
    void externalBundleOverridesBundledBaseline(@TempDir Path directory) throws Exception {
        byte[] content = "override".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Path bundle = directory.resolve("baseline.zip");
        Files.write(bundle, content);
        assertArrayEquals(content, service(bundle.toString()).readBundle());
    }

    @Test
    void rejectsMissingConfiguredBundle(@TempDir Path directory) {
        assertThrows(IllegalStateException.class,
            () -> service(directory.resolve("missing.zip").toString()).readBundle());
    }

    @Test
    void schemaUploadUsesHttp11WithoutUpgradeHeaders() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/schema", exchange -> {
            boolean upgrade = exchange.getRequestHeaders().containsKey("Upgrade");
            byte[] received = exchange.getRequestBody().readAllBytes();
            exchange.sendResponseHeaders(upgrade || received.length != 3 ? 500 : 202, -1);
            exchange.close();
        });
        server.start();
        try {
            var method = TenantNodeSchemaService.class.getDeclaredMethod("send", java.net.URI.class,
                String.class, byte[].class, String.class, long.class, long.class, java.util.Map.class);
            method.setAccessible(true);
            var response = (java.net.http.HttpResponse<?>) method.invoke(service(""),
                java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/schema"),
                "POST", new byte[] {1, 2, 3}, "application/zip", 1L, 1L, java.util.Map.of());
            assertEquals(202, response.statusCode());
        }
        finally {
            server.stop(0);
        }
    }

    @Test
    void reclaimedInitializationTransmitsCurrentFenceAndLegacyCallRetainsFirstFence() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var captures = new java.util.concurrent.CopyOnWriteArrayList<com.fasterxml.jackson.databind.JsonNode>();
        server.createContext("/internal/v1/health/db", exchange -> {
            exchange.sendResponseHeaders(200, -1);
            exchange.close();
        });
        server.createContext("/internal/v1/schema-tasks", exchange -> {
            String upload = new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            int start = upload.indexOf("\r\n\r\n") + 4;
            int end = upload.indexOf("\r\n--", start);
            captures.add(new ObjectMapper().readTree(upload.substring(start, end)));
            // Stop after the real task upload; audit polling is outside this transport contract.
            exchange.sendResponseHeaders(409, -1);
            exchange.close();
        });
        server.start();
        try {
            var jdbc = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
            var service = new TenantNodeSchemaService(jdbc, new ObjectMapper(), "",
                "http://127.0.0.1:" + server.getAddress().getPort(), "", "token");
            var node = new com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView(1L, "node", "http://127.0.0.1:" + server.getAddress().getPort());
            assertThrows(IllegalStateException.class, () -> service.initialize(12L, 3L, 20L, node, "command-41", 2L));
            assertThrows(IllegalStateException.class, () -> service.initialize(12L, 3L, 20L, node, "legacy"));
            assertEquals(2, captures.size());
            assertEquals("2", captures.get(0).path("fencingToken").asText());
            assertEquals("1", captures.get(1).path("fencingToken").asText());
            assertEquals("3", captures.get(0).path("generation").asText());
            assertEquals("command-41", captures.get(0).path("requestId").asText());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void initializationRejectsInvalidFenceBeforeAuditOrProviderCalls() {
        var jdbc = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
        var service = new TenantNodeSchemaService(jdbc, new ObjectMapper(), "", "http://sandbox", "", "token");
        assertThrows(IllegalArgumentException.class, () -> service.initialize(12L, 3L, 20L, null, "request", 0L));
        org.mockito.Mockito.verifyNoInteractions(jdbc);
    }

    private TenantNodeSchemaService service(String bundlePath) {
        return new TenantNodeSchemaService(null, new ObjectMapper(), bundlePath, "http://opensandbox:9005", "", "token");
    }
}
