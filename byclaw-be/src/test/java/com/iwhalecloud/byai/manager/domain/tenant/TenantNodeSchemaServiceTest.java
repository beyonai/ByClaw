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

    private TenantNodeSchemaService service(String bundlePath) {
        return new TenantNodeSchemaService(null, new ObjectMapper(), bundlePath, "http://opensandbox:9005", "", "token");
    }
}
