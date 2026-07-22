package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class BycliRecorderBrowserPortTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private FakeDaemon daemon;

    @AfterEach
    void tearDown() {
        if (daemon != null) {
            daemon.close();
        }
    }

    @Test
    void healthMapsDaemonAndExtensionStatus() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "data", Map.of(
                "extensionConnected", true,
                "localService", "ok"
            )
        ));

        BycliRecorderBrowserPort port = port();

        Map<String, Object> health = port.health();

        assertThat(daemon.lastPath()).isEqualTo("/status");
        assertThat(daemon.lastHeader("X-byCLI")).isEqualTo("1");
        assertThat(health).containsEntry("daemon", "ok")
            .containsEntry("extension", "ok")
            .containsEntry("localService", "ok")
            .containsEntry("highLevel", "ok")
            .containsEntry("llmSynthesis", false);
    }

    @Test
    void healthRecoversDisconnectedExtensionThenReturnsRefreshedStatus() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of("ok", true, "extensionConnected", false));
        daemon.enqueueJson(202, Map.of("ok", true, "data", Map.of("started", true)));
        daemon.enqueueJson(200, Map.of("ok", true, "extensionConnected", false));
        daemon.enqueueJson(200, Map.of("ok", true, "extensionConnected", true));

        RecorderBrowserProperties properties = new RecorderBrowserProperties();
        properties.setDaemonHost("127.0.0.1");
        properties.setDaemonPort(daemon.port());

        Map<String, Object> health = new BycliRecorderBrowserPort(properties).health();

        assertThat(daemon.paths()).containsExactly("/status", "/v1/browser/recover", "/status", "/status");
        assertThat(health).containsEntry("daemon", "ok")
            .containsEntry("extension", "ok")
            .containsEntry("highLevel", "ok");
    }

    @Test
    void navigateRecoversDisconnectedExtensionAndRetriesOnce() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(503, Map.of(
            "ok", false,
            "errorCode", "extension_not_connected",
            "error", "Extension not connected"
        ));
        daemon.enqueueJson(202, Map.of("ok", true, "data", Map.of("started", true)));
        daemon.enqueueJson(200, Map.of("ok", true, "extensionConnected", true));
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "page", "page-after-recovery",
            "data", Map.of("title", "Recovered")
        ));
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));

        Map<String, Object> result = port().navigate(session, "https://example.com/recovered");

        assertThat(daemon.paths()).containsExactly("/command", "/v1/browser/recover", "/status", "/command");
        assertThat(result).containsEntry("page", "page-after-recovery")
            .containsEntry("title", "Recovered");
    }

    @Test
    void healthUsesCurrentUsersBycliSandboxEndpoint() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "data", Map.of("extensionConnected", true, "localService", "ok")
        ));
        RecorderOwner owner = new RecorderOwner(1L, "alice");
        RecorderSandboxEndpointResolver resolver = org.mockito.Mockito.mock(RecorderSandboxEndpointResolver.class);
        org.mockito.Mockito.when(resolver.resolve(owner, "bycli", "/status"))
            .thenReturn(URI.create(daemon.endpoint() + "/status"));

        Map<String, Object> health = new BycliRecorderBrowserPort(
            resolver,
            new RecorderBrowserProperties(),
            HttpClient.newHttpClient(),
            OBJECT_MAPPER
        ).health(owner);

        assertThat(health).containsEntry("daemon", "ok");
        org.mockito.Mockito.verify(resolver).resolve(owner, "bycli", "/status");
    }

    @Test
    void navigatePostsBycliCommandAndStoresTopLevelPage() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "page", "page-real-1",
            "data", Map.of("title", "Search")
        ));
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.contextId("ctx-1");

        BycliRecorderBrowserPort port = port();

        Map<String, Object> result = port.navigate(session, "https://example.com/search?q=alpha");

        assertThat(daemon.lastPath()).isEqualTo("/command");
        assertThat(daemon.lastHeader("X-byCLI")).isEqualTo("1");
        assertThat(daemon.lastBody()).containsEntry("action", "tabs")
            .containsEntry("op", "new")
            .containsEntry("url", "https://example.com/search?q=alpha")
            .containsEntry("session", "session-1")
            .containsEntry("contextId", "ctx-1")
            .containsEntry("surface", "browser")
            .containsEntry("windowMode", "background");
        assertThat(session.targetId()).isEqualTo("page-real-1");
        assertThat(session.currentUrl()).isEqualTo("https://example.com/search?q=alpha");
        assertThat(result).containsEntry("page", "page-real-1")
            .containsEntry("url", "https://example.com/search?q=alpha")
            .containsEntry("title", "Search");
    }

    @Test
    void captureReadStoresDaemonEntriesOnSessionSample() throws Exception {
        daemon = FakeDaemon.start();
        List<Map<String, Object>> entries = List.of(Map.of(
            "requestId", "net-1",
            "method", "GET",
            "url", "https://api.example.test/search?q=alpha",
            "status", 200
        ));
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "data", Map.of(
                "entries", entries,
                "actions", List.of(Map.of("type", "click")),
                "actionsDropped", 1
            )
        ));
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.contextId("ctx-1");
        session.targetId("page-real-1");

        BycliRecorderBrowserPort port = port();

        Map<String, Object> result = port.captureRead(session, "A", "alpha");

        assertThat(daemon.lastBody()).containsEntry("action", "network-capture-read")
            .containsEntry("page", "page-real-1");
        assertThat(session.samples()).containsKey("A");
        assertThat(session.samples().get("A")).containsExactlyElementsOf(entries);
        assertThat(result).containsEntry("sampleName", "A")
            .containsEntry("entries", entries)
            .containsEntry("actionsDropped", 1);
    }

    @Test
    void daemonFailuresMapToRecorderBrowserExceptionCodes() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of(
            "ok", false,
            "error", "stale page identity: page was closed"
        ));
        RecorderSession session = new RecorderSession("session-1", new RecorderOwner(1L, "alice"));
        session.targetId("old-page");

        BycliRecorderBrowserPort port = port();

        assertThatThrownBy(() -> port.screenshot(session, 60))
            .isInstanceOf(RecorderBrowserException.class)
            .extracting("code")
            .isEqualTo("page_lost");
    }

    private BycliRecorderBrowserPort port() {
        RecorderBrowserProperties properties = new RecorderBrowserProperties();
        properties.setDaemonHost("127.0.0.1");
        properties.setDaemonPort(daemon.port());
        properties.setTimeoutMs(3000);
        return new BycliRecorderBrowserPort(properties);
    }

    static final class FakeDaemon implements AutoCloseable {
        private final HttpServer server;
        private final Queue<QueuedResponse> responses = new ArrayDeque<>();
        private String lastPath;
        private final List<String> paths = new java.util.ArrayList<>();
        private Map<String, List<String>> lastHeaders = Map.of();
        private Map<String, Object> lastBody = Map.of();

        private FakeDaemon(HttpServer server) {
            this.server = server;
        }

        static FakeDaemon start() throws IOException {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            FakeDaemon daemon = new FakeDaemon(server);
            server.createContext("/status", daemon::handle);
            server.createContext("/command", daemon::handle);
            server.createContext("/v1/browser/recover", daemon::handle);
            server.start();
            return daemon;
        }

        int port() {
            return server.getAddress().getPort();
        }

        String endpoint() {
            return "http://127.0.0.1:" + port();
        }

        String lastPath() {
            return lastPath;
        }

        List<String> paths() {
            return paths;
        }

        String lastHeader(String name) {
            return lastHeaders.entrySet().stream()
                .filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .findFirst()
                .flatMap(entry -> entry.getValue().stream().findFirst())
                .orElse(null);
        }

        Map<String, Object> lastBody() {
            return lastBody;
        }

        int receivedCount() {
            return lastPath == null ? 0 : 1;
        }

        void enqueueJson(int status, Map<String, Object> body) {
            responses.add(new QueuedResponse(status, body));
        }

        private void handle(HttpExchange exchange) {
            try (exchange) {
                lastPath = exchange.getRequestURI().getPath();
                paths.add(lastPath);
                lastHeaders = new LinkedHashMap<>(exchange.getRequestHeaders());
                byte[] requestBody = exchange.getRequestBody().readAllBytes();
                if (requestBody.length > 0) {
                    lastBody = OBJECT_MAPPER.readValue(requestBody, new TypeReference<>() {});
                } else {
                    lastBody = Map.of();
                }
                QueuedResponse response = responses.remove();
                byte[] payload = OBJECT_MAPPER.writeValueAsBytes(response.body());
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(response.status(), payload.length);
                exchange.getResponseBody().write(payload);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        @Override
        public void close() {
            server.stop((int) Duration.ZERO.toSeconds());
        }
    }

    private record QueuedResponse(int status, Map<String, Object> body) {
    }
}
