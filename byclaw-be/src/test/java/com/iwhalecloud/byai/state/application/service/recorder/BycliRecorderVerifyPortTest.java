package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;

@DisabledOnOs(OS.WINDOWS)
class BycliRecorderVerifyPortTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private FakeDaemon daemon;

    @AfterEach
    void tearDown() {
        if (daemon != null) {
            daemon.close();
        }
    }

    @Test
    void startPostsCanonicalRequestAndBycliHeaderThenStatusGetsDaemonRequest() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(202, Map.of("ok", true, "data", Map.of("requestId", "req-canonical", "accepted", true)));
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "data", Map.of(
                "requestId", "req-canonical",
                "type", "verify",
                "status", "succeeded",
                "result", Map.of("ok", true, "stage", "execute", "rows", 2, "fieldCount", 3)
            )
        ));

        BycliRecorderVerifyPort port = port(3000);
        String expectedSourceSha256 = "a".repeat(64);
        String daemonRequestId = port.start(
            "req-canonical",
            "session-1",
            "example/search",
            Path.of("/tmp/draft.ts").toString(),
            expectedSourceSha256,
            Map.of("q", "alpha")
        );
        Map<String, Object> status = port.status(daemonRequestId);

        assertThat(daemonRequestId).isEqualTo("req-canonical");
        assertThat(daemon.requests()).hasSize(2);
        assertThat(daemon.requests().get(0).method()).isEqualTo("POST");
        assertThat(daemon.requests().get(0).path()).isEqualTo("/v1/verify");
        assertThat(daemon.requests().get(0).header("X-byCLI")).isEqualTo("1");
        assertThat(daemon.requests().get(0).body())
            .containsEntry("requestId", "req-canonical")
            .containsEntry("sessionId", "session-1")
            .containsEntry("name", "example/search")
            .containsEntry("adapterPath", "/tmp/draft.ts")
            .containsEntry("expectedSourceSha256", expectedSourceSha256)
            .containsEntry("executionSeedArgs", Map.of("q", "alpha"));
        assertThat(daemon.requests().get(1).method()).isEqualTo("GET");
        assertThat(daemon.requests().get(1).path()).isEqualTo("/v1/requests/req-canonical");
        assertThat(daemon.requests().get(1).header("X-byCLI")).isEqualTo("1");
        assertThat(status).containsEntry("status", "succeeded");
    }

    @Test
    void ownerAwareVerifyUsesCurrentUsersBycliProxyEndpoint() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(202, Map.of("ok", true, "data", Map.of("requestId", "req-owner", "accepted", true)));
        RecorderSandboxEndpointResolver resolver = org.mockito.Mockito.mock(RecorderSandboxEndpointResolver.class);
        org.mockito.Mockito.when(resolver.resolve(new com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner(1L, "alice"), "bycli", "/v1/verify"))
            .thenReturn(URI.create("http://127.0.0.1:" + daemon.port() + "/v1/sandboxes/sandbox-1/proxy/19825/v1/verify"));

        BycliRecorderVerifyPort port = port(resolver, 3000);
        String requestId = port.start(
            new com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner(1L, "alice"),
            "req-owner", "session-1", "example/search", "/tmp/draft.ts", Map.of()
        );

        assertThat(requestId).isEqualTo("req-owner");
        assertThat(daemon.requests().getFirst().path()).isEqualTo("/v1/sandboxes/sandbox-1/proxy/19825/v1/verify");
    }

    @Test
    void startRejectsMismatchedDaemonRequestId() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(202, Map.of("ok", true, "data", Map.of("requestId", "different-request")));

        assertThatThrownBy(() -> port(3000).start(
            "req-canonical", "session-1", "example/search", "/tmp/draft.ts", Map.of()
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .extracting("code")
            .isEqualTo("runner_protocol_error");
    }

    @Test
    void startRejectsJsonEnvelopesMissingExplicitSuccessOrData() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(202, Map.of("data", Map.of("requestId", "req-missing-ok")));

        assertThatThrownBy(() -> port(3000).start(
            "req-missing-ok", "session-1", "example/search", "/tmp/draft.ts", Map.of()
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "runner_protocol_error");

        daemon.enqueueJson(202, Map.of("ok", true, "requestId", "req-missing-data"));

        assertThatThrownBy(() -> port(3000).start(
            "req-missing-data", "session-1", "example/search", "/tmp/draft.ts", Map.of()
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "runner_protocol_error");
    }

    @Test
    void statusRequiresStrictEnvelopeAndMatchingRequestId() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of(
            "ok", true,
            "data", Map.of("requestId", "different-request", "status", "succeeded", "result", Map.of())
        ));

        assertThatThrownBy(() -> port(3000).status("req-status"))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "runner_protocol_error");

        daemon.enqueueJson(200, Map.of("status", "succeeded", "result", Map.of()));

        assertThatThrownBy(() -> port(3000).status("req-status"))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "runner_protocol_error");
    }

    @Test
    void daemonValidationAndQueueErrorsUseSafeTopLevelMappings() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(400, Map.of(
            "ok", false,
            "errorCode", "validation_failed",
            "error", "SECRET request body must not escape"
        ));

        assertThatThrownBy(() -> port(3000).start(
            "req-validation", "session-1", "example/search", "/tmp/draft.ts", Map.of("password", "SECRET")
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "validation_failed")
            .hasMessage("verify request validation failed");

        daemon.enqueueJson(429, Map.of(
            "ok", false,
            "errorCode", "queue_full",
            "error", "SECRET queue detail"
        ));

        assertThatThrownBy(() -> port(3000).start(
            "req-queue", "session-1", "example/search", "/tmp/draft.ts", Map.of()
        ))
            .isInstanceOf(RecorderVerifyException.class)
            .hasFieldOrPropertyWithValue("code", "queue_full")
            .hasMessage("verify runner queue is full");
    }

    @Test
    void malformedAndTimedOutResponsesNeverBecomeSuccess() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueRaw(200, "not-json");

        assertThatThrownBy(() -> port(3000).status("req-1"))
            .isInstanceOf(RecorderVerifyException.class)
            .extracting("code")
            .isEqualTo("runner_protocol_error");

        daemon.close();
        daemon = FakeDaemon.start();
        daemon.enqueueDelayedJson(200, Map.of("status", "succeeded"), 200);

        assertThatThrownBy(() -> port(25).status("req-2"))
            .isInstanceOf(RecorderVerifyException.class)
            .extracting("code")
            .isEqualTo("daemon_timeout");
    }

    private BycliRecorderVerifyPort port(int timeoutMs) {
        RecorderBrowserProperties properties = new RecorderBrowserProperties();
        properties.setDaemonHost("127.0.0.1");
        properties.setDaemonPort(daemon.port());
        properties.setTimeoutMs(timeoutMs);
        return new BycliRecorderVerifyPort(properties);
    }

    private BycliRecorderVerifyPort port(RecorderSandboxEndpointResolver resolver, int timeoutMs) {
        RecorderBrowserProperties properties = new RecorderBrowserProperties();
        properties.setTimeoutMs(timeoutMs);
        return new BycliRecorderVerifyPort(resolver, properties, java.net.http.HttpClient.newHttpClient(), OBJECT_MAPPER);
    }

    static final class FakeDaemon implements AutoCloseable {
        private final HttpServer server;
        private final Queue<QueuedResponse> responses = new ArrayDeque<>();
        private final List<ReceivedRequest> requests = new java.util.concurrent.CopyOnWriteArrayList<>();

        private FakeDaemon(HttpServer server) {
            this.server = server;
        }

        static FakeDaemon start() throws IOException {
            HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            FakeDaemon daemon = new FakeDaemon(server);
            server.createContext("/", daemon::handle);
            server.start();
            return daemon;
        }

        int port() {
            return server.getAddress().getPort();
        }

        List<ReceivedRequest> requests() {
            return requests;
        }

        void enqueueJson(int status, Map<String, Object> body) {
            try {
                responses.add(new QueuedResponse(status, OBJECT_MAPPER.writeValueAsString(body), 0));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        void enqueueDelayedJson(int status, Map<String, Object> body, long delayMs) {
            try {
                responses.add(new QueuedResponse(status, OBJECT_MAPPER.writeValueAsString(body), delayMs));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        void enqueueRaw(int status, String body) {
            responses.add(new QueuedResponse(status, body, 0));
        }

        private void handle(HttpExchange exchange) {
            try (exchange) {
                byte[] requestBody = exchange.getRequestBody().readAllBytes();
                Map<String, Object> body = requestBody.length == 0
                    ? Map.of()
                    : OBJECT_MAPPER.readValue(requestBody, new TypeReference<>() {});
                requests.add(new ReceivedRequest(
                    exchange.getRequestMethod(),
                    exchange.getRequestURI().getPath(),
                    new LinkedHashMap<>(exchange.getRequestHeaders()),
                    body
                ));
                QueuedResponse response = responses.remove();
                if (response.delayMs() > 0) {
                    Thread.sleep(response.delayMs());
                }
                byte[] payload = response.body().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(response.status(), payload.length);
                exchange.getResponseBody().write(payload);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        @Override
        public void close() {
            server.stop((int) Duration.ZERO.toSeconds());
        }
    }

    private record QueuedResponse(int status, String body, long delayMs) {
    }

    private record ReceivedRequest(String method, String path, Map<String, List<String>> headers, Map<String, Object> body) {
        String header(String name) {
            return headers.entrySet().stream()
                .filter(entry -> entry.getKey().equalsIgnoreCase(name))
                .findFirst()
                .flatMap(entry -> entry.getValue().stream().findFirst())
                .orElse(null);
        }
    }
}
