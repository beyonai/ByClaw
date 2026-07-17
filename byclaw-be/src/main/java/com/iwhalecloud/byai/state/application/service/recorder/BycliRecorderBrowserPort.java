package com.iwhalecloud.byai.state.application.service.recorder;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderSession;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(prefix = "recorder.browser", name = "adapter", havingValue = "bycli", matchIfMissing = true)
public class BycliRecorderBrowserPort implements RecorderBrowserPort {

    private static final String BYCLI_HEADER = "X-byCLI";
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final RecorderBrowserProperties properties;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    @Autowired
    public BycliRecorderBrowserPort(RecorderBrowserProperties properties) {
        this(
            properties,
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getTimeoutMs()))
                .build(),
            new ObjectMapper()
        );
    }

    BycliRecorderBrowserPort(RecorderBrowserProperties properties, HttpClient httpClient, ObjectMapper objectMapper) {
        this.properties = properties;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public Map<String, Object> health() {
        try {
            DaemonResponse response = sendGet("/status", 2000);
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return downHealth("daemon status failed (HTTP " + response.statusCode() + ")");
            }
            Map<String, Object> status = dataMap(response.body());
            boolean extensionConnected = Boolean.TRUE.equals(status.get("extensionConnected"));
            String localService = stringValue(status.get("localService"));
            return Map.of(
                "localService", localService == null ? "ok" : localService,
                "daemon", "ok",
                "extension", extensionConnected ? "ok" : "disconnected",
                "highLevel", extensionConnected ? "ok" : "down",
                "llmSynthesis", false
            );
        } catch (RecorderBrowserException e) {
            return downHealth(e.getMessage());
        }
    }

    @Override
    public Map<String, Object> navigate(RecorderSession session, String url) {
        Map<String, Object> command = baseCommand(session, session.targetId() == null ? "tabs" : "navigate");
        if (session.targetId() == null) {
            command.put("op", "new");
        } else {
            command.put("page", session.targetId());
        }
        command.put("url", url);

        DaemonCommandResult result = command(session, command);
        Map<String, Object> data = result.data();
        String page = result.page() != null ? result.page() : stringValue(data.get("page"));
        if (page != null && !page.isBlank()) {
            session.targetId(page);
        }
        session.currentUrl(url);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("page", session.targetId());
        response.put("url", url);
        response.put("title", stringValue(data.getOrDefault("title", "Recorder page")));
        return response;
    }

    @Override
    public Map<String, Object> captureStart(RecorderSession session, String sampleName) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("sampleName", sampleName);
        response.put("started", true);
        response.putAll(command(session, basePageCommand(session, "network-capture-start")).data());
        return response;
    }

    @Override
    public Map<String, Object> captureRead(RecorderSession session, String sampleName, String seed) {
        Map<String, Object> data = command(session, basePageCommand(session, "network-capture-read")).data();
        List<Map<String, Object>> entries = entryList(data);
        session.samples().put(sampleName, entries);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("sampleName", sampleName);
        response.put("entries", entries);
        response.put("actions", data.getOrDefault("actions", List.of()));
        response.put("actionsDropped", data.getOrDefault("actionsDropped", 0));
        return response;
    }

    @Override
    public Map<String, Object> screenshot(RecorderSession session, Integer quality) {
        Map<String, Object> command = basePageCommand(session, "screenshot");
        command.put("format", "jpeg");
        command.put("quality", quality == null ? 60 : quality);
        Map<String, Object> data = command(session, command).data();
        if (data.isEmpty()) {
            return Map.of("format", "jpeg", "data", "");
        }
        return data;
    }

    @Override
    public Map<String, Object> input(RecorderSession session, String cdpMethod, Map<String, Object> cdpParams) {
        Map<String, Object> command = basePageCommand(session, "cdp");
        command.put("cdpMethod", cdpMethod);
        command.put("cdpParams", cdpParams == null ? Map.of() : cdpParams);
        Map<String, Object> data = command(session, command).data();
        return data.isEmpty() ? Map.of("dispatched", true) : data;
    }

    private DaemonCommandResult command(RecorderSession session, Map<String, Object> command) {
        command.put("id", "be_" + UUID.randomUUID().toString().replace("-", "").substring(0, 16));
        DaemonResponse response = sendPost(session, "/command", command, properties.getTimeoutMs());
        Map<String, Object> payload = response.body();
        if (response.statusCode() >= 200 && response.statusCode() < 300 && Boolean.TRUE.equals(payload.get("ok"))) {
            return new DaemonCommandResult(dataMap(payload), stringValue(payload.get("page")));
        }

        String message = stringValue(payload.get("error"));
        if (message == null || message.isBlank()) {
            message = "daemon command failed (HTTP " + response.statusCode() + ")";
        }
        String rawCode = stringValue(payload.get("errorCode"));
        if (rawCode == null || rawCode.isBlank()) {
            rawCode = inferHttpErrorCode(response.statusCode(), message);
        }
        throw new RecorderBrowserException(toRecorderErrorCode(rawCode, message), message);
    }

    private DaemonResponse sendGet(String path, int timeoutMs) {
        HttpRequest request = HttpRequest.newBuilder(uri(path))
            .timeout(Duration.ofMillis(timeoutMs))
            .header(BYCLI_HEADER, "1")
            .GET()
            .build();
        return send(request);
    }

    private DaemonResponse sendPost(RecorderSession session, String path, Map<String, Object> body, int timeoutMs) {
        HttpRequest request;
        try {
            request = HttpRequest.newBuilder(uri(session, path))
                .timeout(Duration.ofMillis(timeoutMs))
                .header(BYCLI_HEADER, "1")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();
        } catch (JsonProcessingException e) {
            throw new RecorderBrowserException("network_error", "failed to encode daemon command");
        }
        return send(request);
    }

    private DaemonResponse send(HttpRequest request) {
        try {
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            Map<String, Object> body = response.body() == null || response.body().isBlank()
                ? Map.of()
                : objectMapper.readValue(response.body(), MAP_TYPE);
            return new DaemonResponse(response.statusCode(), body);
        } catch (HttpTimeoutException e) {
            throw new RecorderBrowserException("daemon_unavailable", "byCLI daemon timed out");
        } catch (IOException e) {
            throw new RecorderBrowserException("daemon_unavailable", e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RecorderBrowserException("daemon_unavailable", "daemon request interrupted");
        }
    }

    private URI uri(String path) {
        return URI.create("http://" + properties.getDaemonHost() + ":" + properties.getDaemonPort() + path);
    }

    private URI uri(RecorderSession session, String path) {
        String host = session.isVnc() && session.gatewayHost() != null && !session.gatewayHost().isBlank()
            ? session.gatewayHost()
            : properties.getDaemonHost();
        int port = session.isVnc() && session.gatewayPort() != null ? session.gatewayPort() : properties.getDaemonPort();
        return URI.create("http://" + host + ":" + port + path);
    }

    private Map<String, Object> basePageCommand(RecorderSession session, String action) {
        Map<String, Object> command = baseCommand(session, action);
        if (session.targetId() != null) {
            command.put("page", session.targetId());
        }
        return command;
    }

    private Map<String, Object> baseCommand(RecorderSession session, String action) {
        Map<String, Object> command = new LinkedHashMap<>();
        command.put("action", action);
        command.put("session", session.sessionId());
        command.put("surface", "browser");
        command.put("contextId", session.contextId());
        command.put("windowMode", session.isVnc() ? "foreground" : "background");
        return command;
    }

    private List<Map<String, Object>> entryList(Map<String, Object> data) {
        Object entries = data.get("entries");
        if (entries == null) {
            entries = data.get("networkEntries");
        }
        if (!(entries instanceof List<?> items)) {
            return List.of();
        }
        List<Map<String, Object>> result = new ArrayList<>();
        for (Object item : items) {
            if (item instanceof Map<?, ?> raw) {
                result.add(stringMap(raw));
            }
        }
        return result;
    }

    private Map<String, Object> dataMap(Map<String, Object> payload) {
        Object data = payload.get("data");
        if (data instanceof Map<?, ?> raw) {
            return stringMap(raw);
        }
        if (data instanceof List<?> items) {
            return Map.of("entries", items);
        }
        return stringMap(payload);
    }

    private Map<String, Object> stringMap(Map<?, ?> raw) {
        Map<String, Object> result = new LinkedHashMap<>();
        raw.forEach((key, value) -> {
            if (key instanceof String text) {
                result.put(text, value);
            }
        });
        return result;
    }

    private String stringValue(Object value) {
        return value instanceof String text ? text : null;
    }

    private String inferHttpErrorCode(int statusCode, String message) {
        if (message != null && message.contains("stale page identity")) {
            return "page_lost";
        }
        if (statusCode == 408) {
            return "daemon_timeout";
        }
        if (statusCode >= 500) {
            return "daemon_unavailable";
        }
        return "request_failed";
    }

    private String toRecorderErrorCode(String rawCode, String message) {
        if ("page_lost".equals(rawCode)
            || "profile_disconnected".equals(rawCode)
            || "bound_tab_not_found".equals(rawCode)
            || (message != null && message.contains("stale page identity"))) {
            return "page_lost";
        }
        if ("extension_not_connected".equals(rawCode) || "extension_disconnected".equals(rawCode)) {
            return "extension_disconnected";
        }
        if ("navigation_blocked_by_policy".equals(rawCode)) {
            return "navigation_url_forbidden";
        }
        if ("daemon_timeout".equals(rawCode) || "daemon_unavailable".equals(rawCode)) {
            return "daemon_unavailable";
        }
        return "network_error";
    }

    private Map<String, Object> downHealth(String message) {
        return Map.of(
            "localService", "ok",
            "daemon", "down",
            "extension", "disconnected",
            "highLevel", "down",
            "llmSynthesis", false,
            "message", message
        );
    }

    private record DaemonResponse(int statusCode, Map<String, Object> body) {
    }

    private record DaemonCommandResult(Map<String, Object> data, String page) {
    }
}
