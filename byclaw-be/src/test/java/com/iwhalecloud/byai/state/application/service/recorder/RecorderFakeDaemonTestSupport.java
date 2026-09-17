package com.iwhalecloud.byai.state.application.service.recorder;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;

final class RecorderFakeDaemonTestSupport {

    private RecorderFakeDaemonTestSupport() {
    }

    static final class FakeDaemon implements AutoCloseable {
        private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
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
                }
                else {
                    lastBody = Map.of();
                }
                QueuedResponse queuedResponse = responses.remove();
                byte[] payload = OBJECT_MAPPER.writeValueAsBytes(queuedResponse.body());
                exchange.getResponseHeaders().add("Content-Type", "application/json");
                exchange.sendResponseHeaders(queuedResponse.status(), payload.length);
                exchange.getResponseBody().write(payload);
            }
            catch (IOException e) {
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
