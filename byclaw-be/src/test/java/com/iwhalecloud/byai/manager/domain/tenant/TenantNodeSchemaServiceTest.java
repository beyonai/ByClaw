package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.startsWith;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.zip.ZipInputStream;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;

class TenantNodeSchemaServiceTest {
    @org.junit.jupiter.api.Test
    void endpointAcceptsHttpsAndNormalizesTrailingSlash() {
        var service = new TenantNodeSchemaService(null, new com.fasterxml.jackson.databind.ObjectMapper(), "", "token", null);
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
            byte[] health = "{\"enterpriseId\":\"12\",\"generation\":\"3\",\"dbSandboxRecordId\":\"20\",\"dbWritable\":true}"
                .getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, health.length);
            exchange.getResponseBody().write(health);
            exchange.close();
        });
        server.createContext("/internal/v1/schema-tasks", exchange -> {
            String upload = new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
            int start = upload.indexOf("\r\n\r\n") + 4;
            int end = upload.indexOf("\r\n--", start);
            captures.add(new ObjectMapper().readTree(upload.substring(start, end)));
            // Stop after the real task upload; audit polling is outside this transport contract.
            byte[] rejection = "{\"error\":{\"code\":\"IDEMPOTENCY_CONFLICT\"}}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(409, rejection.length);
            exchange.getResponseBody().write(rejection);
            exchange.close();
        });
        server.start();
        try {
            var jdbc = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
            var nodeClient = org.mockito.Mockito.mock(TenantNodeClient.class);
            org.mockito.Mockito.when(nodeClient.schemaEndpoint(12L, 3L, 20L))
                .thenReturn(java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            var service = new TenantNodeSchemaService(jdbc, new ObjectMapper(), "", "token", nodeClient);
            var node = new com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView(1L, "node", "http://127.0.0.1:1/unreachable-gateway");
            var failure = assertThrows(IllegalStateException.class,
                () -> service.initialize(12L, 3L, 20L, node, "command-41", 2L));
            assertEquals("tenant Node rejected schema initialization: HTTP 409 (IDEMPOTENCY_CONFLICT)", failure.getMessage());
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
        var service = new TenantNodeSchemaService(jdbc, new ObjectMapper(), "", "token", null);
        assertThrows(IllegalArgumentException.class, () -> service.initialize(12L, 3L, 20L, null, "request", 0L));
        org.mockito.Mockito.verifyNoInteractions(jdbc);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void retriesSchema503WithTheOriginalAuditAndUploadWhileLeaseIsValid(boolean leaseExpiredBeforeRetry) throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        var uploads = new CopyOnWriteArrayList<byte[]>();
        var keys = new CopyOnWriteArrayList<String>();
        var polls = new AtomicInteger();
        server.createContext("/internal/v1/health/db", exchange -> {
            byte[] health = """
                {"enterpriseId":"12","generation":"3","dbSandboxRecordId":"20","dbWritable":true}
                """.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, health.length);
            exchange.getResponseBody().write(health);
            exchange.close();
        });
        server.createContext("/internal/v1/schema-tasks", exchange -> {
            if ("POST".equals(exchange.getRequestMethod())) {
                uploads.add(exchange.getRequestBody().readAllBytes());
                keys.add(exchange.getRequestHeaders().getFirst("Idempotency-Key"));
                exchange.sendResponseHeaders(uploads.size() == 1 ? 503 : 202, -1);
            } else {
                polls.incrementAndGet();
                byte[] verified = "{\"status\":\"VERIFIED\"}".getBytes(StandardCharsets.UTF_8);
                exchange.sendResponseHeaders(200, verified.length);
                exchange.getResponseBody().write(verified);
            }
            exchange.close();
        });
        server.start();
        try {
            var jdbc = mock(JdbcTemplate.class);
            when(jdbc.queryForObject(startsWith("SELECT status FROM byai.tenant_schema_audit"),
                eq(String.class), any(String.class))).thenReturn("VERIFIED");
            var client = mock(TenantNodeClient.class);
            when(client.schemaEndpoint(12L, 3L, 20L))
                .thenReturn(URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            var service = new TenantNodeSchemaService(jdbc, new ObjectMapper(), "", "token", client);
            var fenceChecks = new AtomicInteger();
            Consumer<Runnable> guard = action -> {
                if (fenceChecks.incrementAndGet() == 3 && leaseExpiredBeforeRetry) {
                    throw new IllegalStateException("STALE_COMMAND_LEASE");
                }
                action.run();
            };

            if (leaseExpiredBeforeRetry) {
                var failure = assertThrows(IllegalStateException.class,
                    () -> service.initialize(12L, 3L, 20L, null, "cold-provision", 26L, guard));
                assertEquals("STALE_COMMAND_LEASE", failure.getMessage());
                assertEquals(1, uploads.size());
                assertEquals(0, polls.get());
            } else {
                service.initialize(12L, 3L, 20L, null, "cold-provision", 26L, guard);
                assertEquals(2, uploads.size());
                assertArrayEquals(uploads.get(0), uploads.get(1));
                assertEquals(List.of(keys.getFirst(), keys.getFirst()), keys);
                assertEquals(1, polls.get());
            }
            assertTrue(keys.getFirst().matches("[a-f0-9]{32}:1"));
            assertEquals(3, fenceChecks.get());
            verify(jdbc, times(1)).update(startsWith("INSERT INTO byai.tenant_schema_audit"), any(Object[].class));
        } finally {
            server.stop(0);
        }
    }

    @Test
    void healthResponseMustMatchTenantGenerationAndDatabaseBeforeUpload() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var responseBody = new java.util.concurrent.atomic.AtomicReference<String>();
        var uploads = new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/internal/v1/health/db", exchange -> {
            byte[] bytes = responseBody.get().getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.createContext("/internal/v1/schema-tasks", exchange -> {
            uploads.incrementAndGet();
            exchange.sendResponseHeaders(409, -1);
            exchange.close();
        });
        server.start();
        try {
            var jdbc = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
            var client = org.mockito.Mockito.mock(TenantNodeClient.class);
            org.mockito.Mockito.when(client.schemaEndpoint(12L, 3L, 20L))
                .thenReturn(java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort()));
            var service = new TenantNodeSchemaService(jdbc, new ObjectMapper(), "", "token", client);
            for (var identity : java.util.List.of(java.util.List.of("13", "3", "20"),
                java.util.List.of("12", "4", "20"), java.util.List.of("12", "3", "21"))) {
                responseBody.set(new ObjectMapper().writeValueAsString(java.util.Map.of(
                    "enterpriseId", identity.get(0), "generation", identity.get(1),
                    "dbSandboxRecordId", identity.get(2), "dbWritable", true)));
                var failure = assertThrows(IllegalStateException.class,
                    () -> service.initialize(12L, 3L, 20L, null, "mismatch"));
                assertEquals("tenant Node database health identity mismatch", failure.getMessage());
            }
            assertEquals(0, uploads.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void waitsForRegistrationAndWritableDatabaseBeforeReturningRegisteredEndpoint() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var probes = new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/internal/v1/health/db", exchange -> {
            byte[] bytes = new ObjectMapper().writeValueAsBytes(java.util.Map.of(
                "enterpriseId", "12", "generation", "3", "dbSandboxRecordId", "20",
                "dbWritable", probes.incrementAndGet() > 1));
            exchange.sendResponseHeaders(200, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        try {
            var client = org.mockito.Mockito.mock(TenantNodeClient.class);
            var endpoint = java.net.URI.create("http://127.0.0.1:" + server.getAddress().getPort());
            org.mockito.Mockito.when(client.schemaEndpoint(12L, 3L, 20L))
                .thenThrow(new org.springframework.web.server.ResponseStatusException(
                    org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "tenant.node.registration.unavailable"))
                .thenReturn(endpoint);
            var service = new TenantNodeSchemaService(null, new ObjectMapper(), "", "token", client);
            assertEquals(endpoint, org.springframework.test.util.ReflectionTestUtils.invokeMethod(
                service, "waitForDatabase", 12L, 3L, 20L));
            assertEquals(2, probes.get());
            org.mockito.Mockito.verify(client, org.mockito.Mockito.times(3)).schemaEndpoint(12L, 3L, 20L);
        } finally {
            server.stop(0);
        }
    }

    private TenantNodeSchemaService service(String bundlePath) {
        return new TenantNodeSchemaService(null, new ObjectMapper(), bundlePath, "token", null);
    }
    @Test
    void firstDispatchRequiresReadableBundleAndNoEnterpriseAudit(@TempDir Path directory) throws Exception {
        var jdbc = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
        String sql = "SELECT count(*) FROM byai.tenant_schema_audit WHERE enterprise_id=?";
        var service = new TenantNodeSchemaService(jdbc,new ObjectMapper(),"","token",null);
        org.mockito.Mockito.when(jdbc.queryForObject(sql,Integer.class,12L)).thenReturn(0);
        assertTrue(service.canRetryBeforeDispatch(12L));
        org.mockito.Mockito.when(jdbc.queryForObject(sql,Integer.class,12L)).thenReturn(1);
        org.junit.jupiter.api.Assertions.assertFalse(service.canRetryBeforeDispatch(12L));
        var missing = new TenantNodeSchemaService(jdbc,new ObjectMapper(),directory.resolve("missing.zip").toString(),"token",null);
        org.junit.jupiter.api.Assertions.assertFalse(missing.canRetryBeforeDispatch(12L));
        org.mockito.Mockito.when(jdbc.queryForObject(sql,Integer.class,12L)).thenThrow(new IllegalStateException("unavailable"));
        org.junit.jupiter.api.Assertions.assertFalse(service.canRetryBeforeDispatch(12L));
    }

    @Test
    void staleWorkerCannotPersistAuditOrUploadAfterRecovery() {
        var jdbc = org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
        var nodeClient = org.mockito.Mockito.mock(TenantNodeClient.class);
        var service = new TenantNodeSchemaService(jdbc,new ObjectMapper(),"","token",nodeClient);
        assertThrows(IllegalStateException.class, () -> service.initialize(12L,1L,20L,null,"original",2L,
            audit -> { throw new IllegalStateException("STALE_COMMAND_LEASE"); }));
        org.mockito.Mockito.verify(jdbc,org.mockito.Mockito.never()).update(
            org.mockito.ArgumentMatchers.startsWith("INSERT INTO byai.tenant_schema_audit"),
            org.mockito.ArgumentMatchers.<Object[]>any());
        org.mockito.Mockito.verifyNoInteractions(nodeClient);
    }

}
