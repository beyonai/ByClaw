package com.iwhalecloud.byai.state.application.service.recorder;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class BycliRecorderVerifyPort implements RecorderVerifyPort {

    private static final String BYCLI_HEADER = "X-byCLI";
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final RecorderBrowserProperties properties;
    private final RecorderSandboxEndpointResolver endpointResolver;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    @Autowired
    public BycliRecorderVerifyPort(
        RecorderSandboxEndpointResolver endpointResolver,
        RecorderBrowserProperties properties
    ) {
        this(
            endpointResolver,
            properties,
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getTimeoutMs()))
                .build(),
            new ObjectMapper()
        );
    }

    BycliRecorderVerifyPort(RecorderBrowserProperties properties, HttpClient httpClient, ObjectMapper objectMapper) {
        this(null, properties, httpClient, objectMapper);
    }

    BycliRecorderVerifyPort(RecorderBrowserProperties properties) {
        this(
            properties,
            HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(properties.getTimeoutMs()))
                .build(),
            new ObjectMapper()
        );
    }

    BycliRecorderVerifyPort(
        RecorderSandboxEndpointResolver endpointResolver,
        RecorderBrowserProperties properties,
        HttpClient httpClient,
        ObjectMapper objectMapper
    ) {
        this.endpointResolver = endpointResolver;
        this.properties = properties;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public String start(
        RecorderOwner owner,
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs
    ) {
        return start(owner, canonicalRequestId, sessionId, name, adapterPath, null, executionSeedArgs);
    }

    @Override
    public String start(
        RecorderOwner owner,
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        String expectedSourceSha256,
        Map<String, Object> executionSeedArgs
    ) {
        return startAt(
            endpointResolver.resolve(owner, "bycli", "/v1/verify"),
            canonicalRequestId,
            sessionId,
            name,
            adapterPath,
            expectedSourceSha256,
            executionSeedArgs
        );
    }

    @Override
    public String start(
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        Map<String, Object> executionSeedArgs
    ) {
        return start(canonicalRequestId, sessionId, name, adapterPath, null, executionSeedArgs);
    }

    @Override
    public String start(
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        String expectedSourceSha256,
        Map<String, Object> executionSeedArgs
    ) {
        return startAt(
            uri("/v1/verify"),
            canonicalRequestId,
            sessionId,
            name,
            adapterPath,
            expectedSourceSha256,
            executionSeedArgs
        );
    }

    private String startAt(
        URI target,
        String canonicalRequestId,
        String sessionId,
        String name,
        String adapterPath,
        String expectedSourceSha256,
        Map<String, Object> executionSeedArgs
    ) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("requestId", canonicalRequestId);
        body.put("sessionId", sessionId);
        body.put("name", name);
        body.put("adapterPath", adapterPath);
        if (expectedSourceSha256 != null) {
            body.put("expectedSourceSha256", expectedSourceSha256);
        }
        body.put("executionSeedArgs", executionSeedArgs == null ? Map.of() : executionSeedArgs);
        body.put("fixture", "ignore");
        body.put("trace", "off");

        DaemonResponse response = send(target, body);
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw daemonError(response, "verify runner start failed");
        }
        Map<String, Object> payload = response.body();
        if (Boolean.FALSE.equals(payload.get("ok"))) {
            throw daemonError(response, "verify runner rejected request");
        }
        Map<String, Object> accepted = envelopeData(payload);
        String daemonRequestId = stringValue(accepted.get("requestId"));
        if (daemonRequestId == null || !canonicalRequestId.equals(daemonRequestId)) {
            throw new RecorderVerifyException("runner_protocol_error", "daemon did not preserve canonical request id");
        }
        return daemonRequestId;
    }

    @Override
    public Map<String, Object> status(String daemonRequestId) {
        return statusAt(null, daemonRequestId);
    }

    @Override
    public Map<String, Object> status(RecorderOwner owner, String daemonRequestId) {
        return statusAt(owner, daemonRequestId);
    }

    private Map<String, Object> statusAt(RecorderOwner owner, String daemonRequestId) {
        String encoded = URLEncoder.encode(daemonRequestId, StandardCharsets.UTF_8);
        URI target = owner == null
            ? uri("/v1/requests/" + encoded)
            : endpointResolver.resolve(owner, "bycli", "/v1/requests/" + encoded);
        DaemonResponse response = send(target, null);
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw daemonError(response, "verify status request failed");
        }
        if (Boolean.FALSE.equals(response.body().get("ok"))) {
            throw daemonError(response, "verify status request failed");
        }
        Map<String, Object> statusBody = envelopeData(response.body());
        String responseRequestId = stringValue(statusBody.get("requestId"));
        if (responseRequestId == null || !daemonRequestId.equals(responseRequestId)) {
            throw new RecorderVerifyException("runner_protocol_error", "daemon verify status request id is invalid");
        }
        String status = stringValue(statusBody.get("status"));
        if (status == null || status.isBlank()) {
            throw new RecorderVerifyException("runner_protocol_error", "daemon verify status is malformed");
        }
        return statusBody;
    }

    private DaemonResponse send(URI target, Map<String, Object> body) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(target)
            .timeout(Duration.ofMillis(properties.getTimeoutMs()))
            .header(BYCLI_HEADER, "1");
        if (body == null) {
            builder.GET();
        } else {
            try {
                builder.header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)));
            } catch (JsonProcessingException e) {
                throw new RecorderVerifyException("runner_protocol_error", "failed to encode verify request");
            }
        }
        try {
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            Map<String, Object> payload = response.body() == null || response.body().isBlank()
                ? Map.of()
                : objectMapper.readValue(response.body(), MAP_TYPE);
            return new DaemonResponse(response.statusCode(), payload);
        } catch (HttpTimeoutException e) {
            throw new RecorderVerifyException("daemon_timeout", "byCLI daemon timed out");
        } catch (JsonProcessingException e) {
            throw new RecorderVerifyException("runner_protocol_error", "daemon returned malformed verify data");
        } catch (IOException e) {
            throw new RecorderVerifyException("daemon_unavailable", "byCLI daemon unavailable");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RecorderVerifyException("daemon_unavailable", "verify request interrupted");
        }
    }

    private RecorderVerifyException daemonError(DaemonResponse response, String fallback) {
        Map<?, ?> error = response.body().get("error") instanceof Map<?, ?> raw ? raw : Map.of();
        String rawCode = stringValue(error.get("code"));
        if (rawCode == null) {
            rawCode = stringValue(response.body().get("errorCode"));
        }
        String code = switch (rawCode == null ? "" : rawCode) {
            case "validation_failed", "runner_protocol_error", "queue_full", "daemon_unavailable", "daemon_timeout" -> rawCode;
            default -> response.statusCode() == 408 ? "daemon_timeout"
                : response.statusCode() >= 500 ? "daemon_unavailable" : "network_error";
        };
        String safeMessage = switch (code) {
            case "validation_failed" -> "verify request validation failed";
            case "runner_protocol_error" -> "verify runner protocol error";
            case "queue_full" -> "verify runner queue is full";
            case "daemon_timeout" -> "byCLI daemon timed out";
            case "daemon_unavailable" -> "byCLI daemon unavailable";
            default -> fallback;
        };
        return new RecorderVerifyException(code, safeMessage);
    }

    private URI uri(String path) {
        return URI.create("http://" + properties.getDaemonHost() + ":" + properties.getDaemonPort() + path);
    }

    private Map<String, Object> envelopeData(Map<String, Object> payload) {
        if (!Boolean.TRUE.equals(payload.get("ok")) || !(payload.get("data") instanceof Map<?, ?> raw)) {
            throw new RecorderVerifyException("runner_protocol_error", "daemon returned malformed verify envelope");
        }
        Map<String, Object> data = new LinkedHashMap<>();
        raw.forEach((key, value) -> {
            if (key instanceof String text) {
                data.put(text, value);
            }
        });
        return data;
    }

    private String stringValue(Object value) {
        return value instanceof String text ? text : null;
    }

    private record DaemonResponse(int statusCode, Map<String, Object> body) {
    }
}
