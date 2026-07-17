package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressEndpointResolver;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;

@DisabledOnOs(OS.WINDOWS)
class BycliRecorderSavePortTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final RecorderOwner OWNER = new RecorderOwner(42L, "AbC_001");

    private FakeDaemon daemon;

    @AfterEach
    void tearDown() {
        if (daemon != null) {
            daemon.close();
        }
    }

    @Test
    void resolvesExactOwnerInstanceAndPostsSaveContract() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, successEnvelope());
        SandboxIngressEndpointResolver resolver = resolverFor(daemon.endpoint());

        RecorderSavePort.PublishResult result = port(resolver, enabledProperties(3000)).publish(
            OWNER, "example_com/search", "export default {};", "model-x", false
        );

        verify(resolver).resolveRequiredEndpoint("AbC_001", "bycli");
        assertThat(daemon.requests()).singleElement().satisfies(request -> {
            assertThat(request.method()).isEqualTo("POST");
            assertThat(request.path()).isEqualTo("/v1/save-adapter");
            assertThat(request.header("X-byCLI")).isEqualTo("1");
            assertThat(request.body()).containsOnly(
                Map.entry("name", "example_com/search"),
                Map.entry("source", "export default {};"),
                Map.entry("llmModel", "model-x"),
                Map.entry("overwrite", false)
            );
        });
        assertThat(result.adapterPath()).isEqualTo("/by/.bycli/clis/example_com/search.js");
        assertThat(result.reportPath()).isEqualTo("/by/.bycli/sites/example_com/recorder/search-report.json");
    }

    @Test
    void omitsOptionalModelWhenAbsentLikeOpencliApi() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, successEnvelope());

        port(resolverFor(daemon.endpoint()), enabledProperties(3000))
            .publish(OWNER, "example_com/search", "export default {};", null, false);

        assertThat(daemon.requests().getFirst().body())
            .containsOnlyKeys("name", "source", "overwrite")
            .doesNotContainKey("llmModel");
    }

    @Test
    void forwardsConfirmedOverwriteAndMapsValidatedConflict() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, successEnvelope());
        daemon.enqueueJson(409, Map.of(
            "ok", false,
            "errorCode", "adapter_exists",
            "error", "already exists",
            "data", Map.of("adapterPath", "/by/.bycli/clis/example_com/search.js")
        ));
        BycliRecorderSavePort port = port(resolverFor(daemon.endpoint()), enabledProperties(3000));

        port.publish(OWNER, "example_com/search", "source", null, true);
        assertThat(daemon.requests().getFirst().body()).containsEntry("overwrite", true);

        assertThatThrownBy(() -> port.publish(OWNER, "example_com/search", "source", null, false))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "adapter_exists")
            .extracting(error -> ((RecorderSaveException) error).getDetails())
            .isEqualTo(Map.of("adapterPath", "/by/.bycli/clis/example_com/search.js"));
    }

    @Test
    void rejectsMalformedOrUnsafeConflictEnvelope() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(409, Map.of(
            "ok", false,
            "errorCode", "adapter_exists",
            "error", "already exists",
            "data", Map.of("adapterPath", "/tmp/escape.js")
        ));

        assertCode(
            () -> port(resolverFor(daemon.endpoint()), enabledProperties(3000))
                .publish(OWNER, "example_com/search", "source", null, false),
            "daemon_protocol_error",
            "byCLI daemon returned malformed publish data"
        );
    }

    @Test
    void disabledProductionPublishingFailsClosedBeforeResolution() {
        SandboxIngressEndpointResolver resolver = mock(SandboxIngressEndpointResolver.class);
        RecorderSaveProperties properties = enabledProperties(3000);
        properties.setProductionEnabled(false);

        assertCode(() -> port(resolver, properties).publish(OWNER, "example/search", "source", null, false),
            "save_adapter_disabled", "production adapter publishing is disabled");
        verify(resolver, never()).resolveRequiredEndpoint("AbC_001", "bycli");
    }

    @Test
    void resolvesEndpointForEveryPublishCall() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, successEnvelope());
        daemon.enqueueJson(200, successEnvelope());
        SandboxIngressEndpointResolver resolver = resolverFor(daemon.endpoint());
        BycliRecorderSavePort port = port(resolver, enabledProperties(3000));

        port.publish(OWNER, "example/search", "source one", null, false);
        port.publish(OWNER, "example/search", "source two", null, false);

        verify(resolver, org.mockito.Mockito.times(2)).resolveRequiredEndpoint("AbC_001", "bycli");
    }

    @Test
    void mapsValidationAndSecurityResponsesWithoutLeakingDaemonDetails() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(400, Map.of("ok", false, "errorCode", "validation_failed", "error", "SECRET source path"));
        daemon.enqueueJson(403, Map.of("ok", false, "error", "SECRET missing header"));
        BycliRecorderSavePort port = port(resolverFor(daemon.endpoint()), enabledProperties(3000));

        assertCode(() -> port.publish(OWNER, "bad", "source", null, false),
            "validation_failed", "adapter publish validation failed");
        assertCode(() -> port.publish(OWNER, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");
    }

    @Test
    void mapsResolverMalformedEndpointConnectionTimeoutAndInterruptionSafely() throws Exception {
        RecorderSaveProperties properties = enabledProperties(25);
        SandboxIngressEndpointResolver missing = mock(SandboxIngressEndpointResolver.class);
        when(missing.resolveRequiredEndpoint("AbC_001", "bycli")).thenThrow(new IllegalStateException("SECRET endpoint"));
        assertCode(() -> port(missing, properties).publish(OWNER, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");

        assertCode(() -> port(resolverFor("not a uri"), properties).publish(OWNER, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");
        assertCode(() -> port(resolverFor("http://127.0.0.1:99999"), properties)
                .publish(OWNER, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");
        assertCode(() -> port(resolverFor("http://127.0.0.1:1"), properties).publish(OWNER, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");

        daemon = FakeDaemon.start();
        daemon.enqueueDelayedJson(200, successEnvelope(), 200);
        assertCode(() -> port(resolverFor(daemon.endpoint()), properties).publish(OWNER, "example/search", "source", null, false),
            "daemon_timeout", "user byCLI daemon timed out");

        daemon.enqueueJson(200, successEnvelope());
        Thread.currentThread().interrupt();
        try {
            assertCode(() -> port(resolverFor(daemon.endpoint()), properties).publish(OWNER, "example/search", "source", null, false),
                "daemon_unavailable", "user byCLI daemon is unavailable");
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void timeoutDeadlineAlsoCoversBodyAfterResponseHeaders() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueStalledBody(200, successEnvelope(), 250);

        assertCode(() -> port(resolverFor(daemon.endpoint()), enabledProperties(25))
                .publish(OWNER, "example/search", "source", null, false),
            "daemon_timeout", "user byCLI daemon timed out");
    }

    @Test
    void rejectsMalformedOversizedOrNonSuccessEnvelopes() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueRaw(200, "not-json");
        daemon.enqueueJson(200, Map.of("data", Map.of("adapterPath", "/by/.bycli/a", "reportPath", "/by/.bycli/b")));
        daemon.enqueueJson(200, Map.of("ok", true, "data", "wrong"));
        daemon.enqueueJson(200, Map.of("ok", true, "data", Map.of("adapterPath", 7, "reportPath", true)));
        daemon.enqueueRaw(200, " ".repeat(BycliRecorderSavePort.MAX_RESPONSE_BYTES + 1));
        BycliRecorderSavePort port = port(resolverFor(daemon.endpoint()), enabledProperties(3000));

        for (int i = 0; i < 5; i++) {
            assertCode(() -> port.publish(OWNER, "example/search", "source", null, false),
                "daemon_protocol_error", "byCLI daemon returned malformed publish data");
        }
    }

    @Test
    void rejectsNonStandardErrorEnvelopesInsteadOfTrustingStatusAlone() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(400, Map.of());
        daemon.enqueueJson(400, Map.of("ok", true));
        daemon.enqueueJson(400, Map.of("ok", false, "errorCode", "unexpected", "error", "SECRET"));
        daemon.enqueueJson(400, Map.of("ok", false, "errorCode", "validation_failed"));
        daemon.enqueueJson(403, Map.of("error", "SECRET"));
        BycliRecorderSavePort port = port(resolverFor(daemon.endpoint()), enabledProperties(3000));

        for (int i = 0; i < 5; i++) {
            assertCode(() -> port.publish(OWNER, "example/search", "source", null, false),
                "daemon_protocol_error", "byCLI daemon returned malformed publish data");
        }
    }

    @Test
    void acceptsOnlyNormalizedAbsoluteStrictChildrenOfBycliRoot() throws Exception {
        List<String> invalidPaths = List.of(
            "/by/.bycli",
            "/by/.bycli-evil/file.js",
            "/by/.bycli/../escape.js",
            "/by/.bycli/clis/../search.js",
            "by/.bycli/clis/search.js",
            "/by/.bycli\\clis\\search.js",
            "/by/.bycli/clis/search\u0000.js",
            "/by/.bycli/clis/search\n.js",
            "/by/.bycli/clis/search\u0085.js"
        );
        daemon = FakeDaemon.start();
        for (String invalidPath : invalidPaths) {
            daemon.enqueueJson(200, Map.of("ok", true, "data", Map.of(
                "adapterPath", invalidPath,
                "reportPath", "/by/.bycli/sites/example/recorder/report.json"
            )));
        }
        BycliRecorderSavePort port = port(resolverFor(daemon.endpoint()), enabledProperties(3000));

        for (String ignored : invalidPaths) {
            assertCode(() -> port.publish(OWNER, "example/search", "source", null, false),
                "daemon_protocol_error", "byCLI daemon returned malformed publish data");
        }
    }

    @Test
    void rejectsControlCharactersInEitherReturnedPath() throws Exception {
        daemon = FakeDaemon.start();
        daemon.enqueueJson(200, Map.of("ok", true, "data", Map.of(
            "adapterPath", "/by/.bycli/clis/example/search.js",
            "reportPath", "/by/.bycli/sites/example/recorder/report\u0085.json"
        )));

        assertCode(() -> port(resolverFor(daemon.endpoint()), enabledProperties(3000))
                .publish(OWNER, "example/search", "source", null, false),
            "daemon_protocol_error", "byCLI daemon returned malformed publish data");
    }

    @Test
    void validatesLocalInputsAndEndpointShapeWithoutRawValuesInErrors() {
        RecorderSaveProperties properties = enabledProperties(3000);
        SandboxIngressEndpointResolver resolver = resolverFor("file:///tmp/SECRET");

        assertCode(() -> port(resolver, properties).publish(null, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");
        assertCode(() -> port(resolver, properties).publish(OWNER, "", "source", null, false),
            "validation_failed", "adapter publish validation failed");
        assertCode(() -> port(resolver, properties).publish(OWNER, "example/search", "", null, false),
            "validation_failed", "adapter publish validation failed");
        assertCode(() -> port(resolver, properties).publish(OWNER, "example/search", "source", null, false),
            "daemon_unavailable", "user byCLI daemon is unavailable");
    }

    private static Map<String, Object> successEnvelope() {
        return Map.of("ok", true, "data", Map.of(
            "adapterPath", "/by/.bycli/clis/example_com/search.js",
            "reportPath", "/by/.bycli/sites/example_com/recorder/search-report.json"
        ));
    }

    private static RecorderSaveProperties enabledProperties(int timeoutMs) {
        RecorderSaveProperties properties = new RecorderSaveProperties(timeoutMs);
        properties.setProductionEnabled(true);
        return properties;
    }

    private static SandboxIngressEndpointResolver resolverFor(String endpoint) {
        SandboxIngressEndpointResolver resolver = mock(SandboxIngressEndpointResolver.class);
        when(resolver.resolveRequiredEndpoint("AbC_001", "bycli")).thenReturn(endpoint);
        return resolver;
    }

    private static BycliRecorderSavePort port(
        SandboxIngressEndpointResolver resolver,
        RecorderSaveProperties properties
    ) {
        HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(properties.getTimeoutMs()))
            .build();
        return new BycliRecorderSavePort(resolver, properties, client, OBJECT_MAPPER);
    }

    private static void assertCode(ThrowingRunnable action, String code, String message) {
        assertThatThrownBy(action::run)
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", code)
            .hasMessage(message)
            .hasMessageNotContaining("SECRET");
    }

    @FunctionalInterface
    private interface ThrowingRunnable {
        void run() throws Exception;
    }

    static final class FakeDaemon implements AutoCloseable {
        private final HttpServer server;
        private final Queue<QueuedResponse> responses = new ConcurrentLinkedQueue<>();
        private final List<ReceivedRequest> requests = new CopyOnWriteArrayList<>();

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

        String endpoint() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        List<ReceivedRequest> requests() {
            return requests;
        }

        void enqueueJson(int status, Map<String, Object> body) {
            try {
                responses.add(new QueuedResponse(status, OBJECT_MAPPER.writeValueAsBytes(body), 0, false));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        void enqueueDelayedJson(int status, Map<String, Object> body, long delayMs) {
            try {
                responses.add(new QueuedResponse(status, OBJECT_MAPPER.writeValueAsBytes(body), delayMs, false));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        void enqueueRaw(int status, String body) {
            responses.add(new QueuedResponse(status, body.getBytes(java.nio.charset.StandardCharsets.UTF_8), 0, false));
        }

        void enqueueStalledBody(int status, Map<String, Object> body, long delayMs) {
            try {
                responses.add(new QueuedResponse(status, OBJECT_MAPPER.writeValueAsBytes(body), delayMs, true));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }

        private void handle(HttpExchange exchange) {
            try (exchange) {
                byte[] requestBody = exchange.getRequestBody().readAllBytes();
                Map<String, Object> body = requestBody.length == 0
                    ? Map.of()
                    : OBJECT_MAPPER.readValue(requestBody, new TypeReference<>() {});
                requests.add(new ReceivedRequest(
                    exchange.getRequestMethod(), exchange.getRequestURI().getPath(), exchange.getRequestHeaders(), body
                ));
                QueuedResponse response = responses.poll();
                if (response == null) {
                    throw new AssertionError("fake daemon received an unexpected request");
                }
                if (response.headersBeforeDelay()) {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(response.status(), response.body().length);
                    exchange.getResponseBody().flush();
                }
                if (response.delayMs() > 0) {
                    Thread.sleep(response.delayMs());
                }
                if (!response.headersBeforeDelay()) {
                    exchange.getResponseHeaders().set("Content-Type", "application/json");
                    exchange.sendResponseHeaders(response.status(), response.body().length);
                }
                exchange.getResponseBody().write(response.body());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } catch (IOException ignored) {
                // Expected when the client timeout closes the exchange.
            }
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    private record QueuedResponse(int status, byte[] body, long delayMs, boolean headersBeforeDelay) {
    }

    private record ReceivedRequest(
        String method,
        String path,
        com.sun.net.httpserver.Headers headers,
        Map<String, Object> body
    ) {
        String header(String name) {
            return headers.getFirst(name);
        }
    }
}
