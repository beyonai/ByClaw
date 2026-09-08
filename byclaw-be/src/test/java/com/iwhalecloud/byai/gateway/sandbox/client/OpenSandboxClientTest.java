package com.iwhalecloud.byai.gateway.sandbox.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.OutputStream;
import java.lang.reflect.Method;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.sun.net.httpserver.HttpServer;

class OpenSandboxClientTest {

    @Test
    void sandboxCreateLogSummaryDoesNotContainEnvironmentValues() throws Exception {
        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .env(Map.of(
                "TENCENTCLOUD_SECRET_ID", "sensitive-id-value",
                "TENCENTCLOUD_SECRET_KEY", "sensitive-key-value"))
            .metadata(Map.of("serviceKey", "openclaw"))
            .build();
        Method summaryMethod = OpenSandboxClient.class.getDeclaredMethod(
            "createSandboxLogSummary", CreateSandboxRequest.class);
        summaryMethod.setAccessible(true);

        String summary = (String) summaryMethod.invoke(null, request);

        assertThat(summary)
            .contains("TENCENTCLOUD_SECRET_ID", "TENCENTCLOUD_SECRET_KEY", "serviceKey")
            .doesNotContain("sensitive-id-value", "sensitive-key-value");
    }

    @Test
    void commandOutputBudgetCountsUtf8BytesAcrossStdoutAndStderrAtExactBoundary() throws Exception {
        OpenSandboxClient client = new OpenSandboxClient(new SandboxProperties());
        Method parser = OpenSandboxClient.class.getDeclaredMethod(
            "parseCommandStream", String.class, int.class, boolean.class);
        parser.setAccessible(true);
        String exact = event("stdout", "你") + "\n" + event("stderr", "ab");
        SandboxCommandResult result = (SandboxCommandResult) parser.invoke(client, exact, 5, false);
        assertThat(result.stdout()).isEqualTo("你");
        assertThat(result.stderr()).isEqualTo("ab");
        assertThat(result.truncated()).isFalse();

        assertThatThrownBy(() -> parser.invoke(client, exact, 4, false))
            .hasCauseInstanceOf(OpenSandboxClient.OpenSandboxOutputLimitException.class);
    }

    @Test
    void commandOutputRejectsOversizedStdoutStderrAndCombinedOutput() throws Exception {
        OpenSandboxClient client = new OpenSandboxClient(new SandboxProperties());
        Method parser = OpenSandboxClient.class.getDeclaredMethod(
            "parseCommandStream", String.class, int.class, boolean.class);
        parser.setAccessible(true);
        for (String stream : List.of(
            event("stdout", "12345"),
            event("stderr", "12345"),
            event("stdout", "123") + "\n" + event("stderr", "12"))) {
            assertThatThrownBy(() -> parser.invoke(client, stream, 4, false))
                .hasCauseInstanceOf(OpenSandboxClient.OpenSandboxOutputLimitException.class);
        }
    }

    @Test
    void commandHttpDeadlineCoversDelayedHeadersAndBody() throws Exception {
        assertThatThrownBy(() -> runCommandServer(event("stdout", "ok"), 32, 150, 0, Duration.ofMillis(40)))
            .isInstanceOf(OpenSandboxClient.OpenSandboxCommandTimeoutException.class);
        assertThatThrownBy(() -> runCommandServer(event("stdout", "ok"), 32, 0, 150, Duration.ofMillis(40)))
            .isInstanceOf(OpenSandboxClient.OpenSandboxCommandTimeoutException.class);
    }

    @Test
    void commandHttpBodyIsRawBoundedBeforeJsonParsing() throws Exception {
        assertThatThrownBy(() -> runCommandServer("x".repeat(80_000), 16, 0, 0, Duration.ofSeconds(2)))
            .isInstanceOf(OpenSandboxClient.OpenSandboxOutputLimitException.class);
    }

    @Test
    void commandDeadlineIncludesSlowEndpointHeadersAndBodyWithoutDispatch() throws Exception {
        for (long[] delays : List.of(new long[] {150, 0}, new long[] {0, 150})) {
            AtomicInteger dispatches = new AtomicInteger();
            assertThatThrownBy(() -> runDiscoveryScenario(null, 200, delays[0], delays[1], 0,
                Duration.ofMillis(40), dispatches))
                .isInstanceOf(OpenSandboxClient.OpenSandboxCommandTimeoutException.class);
            assertThat(dispatches).hasValue(0);
        }
    }

    @Test
    void commandReceivesOnlyDeadlineRemainderAfterDiscovery() throws Exception {
        AtomicInteger dispatches = new AtomicInteger();
        assertThatThrownBy(() -> runDiscoveryScenario(null, 200, 0, 70, 70,
            Duration.ofMillis(110), dispatches))
            .isInstanceOf(OpenSandboxClient.OpenSandboxCommandTimeoutException.class);
        assertThat(dispatches).hasValue(1);
    }

    @Test
    void commandEndpointResponseIsBoundedStrictAndSanitized() throws Exception {
        AtomicInteger dispatches = new AtomicInteger();
        assertThatThrownBy(() -> runDiscoveryScenario("raw-secret".repeat(1025), 200, 0, 0, 0,
            Duration.ofSeconds(1), dispatches))
            .isInstanceOf(OpenSandboxClient.OpenSandboxEndpointInvalidResponseException.class)
            .hasMessageNotContaining("raw-secret");
        assertThat(dispatches).hasValue(0);

        assertThatThrownBy(() -> runDiscoveryScenario(
            "{\"endpoint\":\"%s\",\"headers\":{},\"secret\":\"body-token\"}",
            200, 0, 0, 0, Duration.ofSeconds(1), dispatches))
            .isInstanceOf(OpenSandboxClient.OpenSandboxEndpointInvalidResponseException.class)
            .hasMessageNotContaining("body-token");

        assertThatThrownBy(() -> runDiscoveryScenario("body-token", 503, 0, 0, 0,
            Duration.ofSeconds(1), dispatches))
            .isInstanceOf(OpenSandboxClient.OpenSandboxEndpointUnavailableException.class)
            .hasMessageNotContaining("body-token")
            .hasMessageNotContaining("header-token");
    }

    @Test
    void commandEndpointAcceptsExactRawBoundaryAndValidSchema() throws Exception {
        AtomicInteger dispatches = new AtomicInteger();
        String template = "{\"endpoint\":\"%s\",\"headers\":{}}";
        SandboxCommandResult normal = runDiscoveryScenario(template, 200, 0, 0, 0,
            Duration.ofSeconds(1), dispatches);
        assertThat(normal.stdout()).isEqualTo("ok");
        assertThat(dispatches).hasValue(1);

        dispatches.set(0);
        SandboxCommandResult exact = runDiscoveryScenario("__EXACT_BOUNDARY__", 200, 0, 0, 0,
            Duration.ofSeconds(1), dispatches);
        assertThat(exact.stdout()).isEqualTo("ok");
        assertThat(dispatches).hasValue(1);
    }

    @Test
    void commandEndpointRejectsDuplicateTrailingAndMalformedUtf8WithoutEcho() throws Exception {
        AtomicInteger dispatches = new AtomicInteger();
        for (String body : List.of(
            "{\"endpoint\":\"%s\",\"endpoint\":\"http://duplicate-secret\",\"headers\":{}}",
            "{\"endpoint\":\"%s\",\"headers\":{},\"headers\":{}}",
            "{\"endpoint\":\"%s\",\"headers\":{}} {\"secret\":\"trailing-secret\"}")) {
            assertThatThrownBy(() -> runDiscoveryScenario(body, 200, 0, 0, 0,
                Duration.ofSeconds(1), dispatches))
                .isInstanceOf(OpenSandboxClient.OpenSandboxEndpointInvalidResponseException.class)
                .hasMessageNotContaining("duplicate-secret")
                .hasMessageNotContaining("trailing-secret");
        }
        byte[] prefix = "{\"endpoint\":\"http://malformed-".getBytes(StandardCharsets.UTF_8);
        byte[] suffix = "\",\"headers\":{}}".getBytes(StandardCharsets.UTF_8);
        byte[] malformed = new byte[prefix.length + 2 + suffix.length];
        System.arraycopy(prefix, 0, malformed, 0, prefix.length);
        malformed[prefix.length] = (byte) 0xC3;
        malformed[prefix.length + 1] = (byte) 0x28;
        System.arraycopy(suffix, 0, malformed, prefix.length + 2, suffix.length);
        assertThatThrownBy(() -> runRawDiscoveryScenario(malformed, dispatches))
            .isInstanceOf(OpenSandboxClient.OpenSandboxEndpointInvalidResponseException.class)
            .hasMessageNotContaining("malformed");
        assertThat(dispatches).hasValue(0);
    }

    @Test
    void readsBackgroundCommandIdFromNdjsonInitText() throws Exception {
        OpenSandboxClient client = new OpenSandboxClient(new SandboxProperties());
        String stream = "{\"type\":\"init\",\"text\":\"90b1315fad0e447b8bb26c77c311e162\","
            + "\"timestamp\":1785996105659}\n\n"
            + "{\"type\":\"ping\",\"text\":\"pong\",\"timestamp\":1785996105659}\n\n"
            + "{\"type\":\"execution_complete\",\"timestamp\":1785996105660}";

        Method parser = OpenSandboxClient.class.getDeclaredMethod("firstCommandId", String.class);
        parser.setAccessible(true);

        assertThat(parser.invoke(client, stream)).isEqualTo("90b1315fad0e447b8bb26c77c311e162");
    }

    @Test
    void parsesRawNdjsonCommandEventsAndPreservesCliError() throws Exception {
        OpenSandboxClient client = new OpenSandboxClient(new SandboxProperties());
        String cliError = "{\"ok\":false,\"error\":{\"type\":\"config\","
            + "\"subtype\":\"not_configured\"}}";
        String stream = "{\"type\":\"init\",\"text\":\"started\",\"timestamp\":1}\n\n"
            + "{\"type\":\"stderr\",\"text\":" + quoteJson(cliError) + ",\"timestamp\":2}\n\n"
            + "{\"type\":\"error\",\"timestamp\":3,\"error\":{"
            + "\"ename\":\"Error\",\"evalue\":\"Process exited with code 3\",\"traceback\":[]}}";

        Method parser = OpenSandboxClient.class.getDeclaredMethod(
            "parseCommandStream", String.class, int.class, boolean.class);
        parser.setAccessible(true);
        SandboxCommandResult result = (SandboxCommandResult) parser.invoke(client, stream, 4096, false);

        assertThat(result.exitCode()).isEqualTo(3);
        assertThat(result.stdout()).isEmpty();
        assertThat(result.stderr()).isEqualTo(cliError);
    }

    private static String quoteJson(String value) {
        return '"' + value.replace("\\", "\\\\").replace("\"", "\\\"") + '"';
    }

    private static String event(String type, String text) {
        return "{\"type\":\"" + type + "\",\"text\":" + quoteJson(text) + "}";
    }

    private SandboxCommandResult runCommandServer(String stream, int maxOutput, long headerDelay,
            long bodyDelay, Duration timeout) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/v1/sandboxes/s1/endpoints/", exchange ->
            write(exchange, "{\"endpoint\":\"" + endpoint + "\",\"headers\":{}}", 0, 0));
        server.createContext("/command", exchange -> write(exchange, stream, headerDelay, bodyDelay));
        server.start();
        try {
            SandboxProperties properties = new SandboxProperties();
            properties.getOpensandbox().setBaseUrl(endpoint);
            properties.getOpensandbox().setApiKey("test");
            return new OpenSandboxClient(properties).runCommand("s1", new SandboxCommandRequest(
                List.of("fixed"), Map.of(), null, timeout, maxOutput, false));
        } finally {
            server.stop(0);
        }
    }

    private SandboxCommandResult runDiscoveryScenario(String endpointTemplate, int endpointStatus,
            long endpointHeaderDelay, long endpointBodyDelay, long commandBodyDelay,
            Duration timeout, AtomicInteger dispatches) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
        String validEndpointBody = "{\"endpoint\":\"" + endpoint + "\",\"headers\":{}}";
        String endpointBody;
        if ("__EXACT_BOUNDARY__".equals(endpointTemplate)) {
            endpointBody = validEndpointBody + " ".repeat(
                8192 - validEndpointBody.getBytes(StandardCharsets.UTF_8).length);
        } else {
            endpointBody = endpointTemplate == null ? validEndpointBody
                : endpointTemplate.contains("%s") ? endpointTemplate.formatted(endpoint) : endpointTemplate;
        }
        server.createContext("/v1/sandboxes/s1/endpoints/", exchange -> {
            exchange.getResponseHeaders().add("X-Test-Secret", "header-token");
            write(exchange, endpointBody, endpointStatus, endpointHeaderDelay, endpointBodyDelay);
        });
        server.createContext("/command", exchange -> {
            dispatches.incrementAndGet();
            write(exchange, event("stdout", "ok"), 200, 0, commandBodyDelay);
        });
        server.start();
        try {
            SandboxProperties properties = new SandboxProperties();
            properties.getOpensandbox().setBaseUrl(endpoint);
            properties.getOpensandbox().setApiKey("test-secret-key");
            return new OpenSandboxClient(properties).runCommand("s1", new SandboxCommandRequest(
                List.of("fixed"), Map.of(), null, timeout, 32, false));
        } finally {
            server.stop(0);
        }
    }

    private SandboxCommandResult runRawDiscoveryScenario(byte[] endpointBody, AtomicInteger dispatches)
            throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        String endpoint = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/v1/sandboxes/s1/endpoints/", exchange -> {
            exchange.sendResponseHeaders(200, endpointBody.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(endpointBody);
            }
        });
        server.createContext("/command", exchange -> {
            dispatches.incrementAndGet();
            write(exchange, event("stdout", "ok"), 0, 0);
        });
        server.start();
        try {
            SandboxProperties properties = new SandboxProperties();
            properties.getOpensandbox().setBaseUrl(endpoint);
            properties.getOpensandbox().setApiKey("test");
            return new OpenSandboxClient(properties).runCommand("s1", new SandboxCommandRequest(
                List.of("fixed"), Map.of(), null, Duration.ofSeconds(1), 32, false));
        } finally {
            server.stop(0);
        }
    }

    private static void write(com.sun.net.httpserver.HttpExchange exchange, String body,
            long headerDelay, long bodyDelay) throws java.io.IOException {
        write(exchange, body, 200, headerDelay, bodyDelay);
    }

    private static void write(com.sun.net.httpserver.HttpExchange exchange, String body, int status,
            long headerDelay, long bodyDelay) throws java.io.IOException {
        try {
            if (headerDelay > 0) Thread.sleep(headerDelay);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, bytes.length);
            if (bodyDelay > 0) Thread.sleep(bodyDelay);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(bytes);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

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
