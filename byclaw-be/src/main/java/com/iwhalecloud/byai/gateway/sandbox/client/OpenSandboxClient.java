package com.iwhalecloud.byai.gateway.sandbox.client;

import java.io.IOException;
import java.time.Duration;
import java.util.Collections;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ErrorResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.model.RenewSandboxExpirationRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxEndpoint;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class OpenSandboxClient {

    private static final Logger log = LoggerFactory.getLogger(OpenSandboxClient.class);
    private static final MediaType JSON_MEDIA_TYPE = MediaType.get("application/json; charset=utf-8");

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final SandboxProperties properties;
    private final String baseUrl;
    private final String apiKey;
    private final Duration pollInterval;
    private final Duration pollTimeout;
    private final String endpointScheme;

    public OpenSandboxClient(SandboxProperties properties) {
        this.properties = properties;
        this.baseUrl = normalizeBaseUrl(properties.getOpensandbox().getBaseUrl());
        this.apiKey = properties.getOpensandbox().getApiKey();
        this.pollInterval = properties.getPollInterval();
        this.pollTimeout = properties.getPollTimeout();
        this.endpointScheme = properties.getOpensandbox().getEndpointScheme();

        this.httpClient = new OkHttpClient.Builder()
                .connectTimeout(Duration.ofSeconds(30))
                .readTimeout(Duration.ofSeconds(60))
                .writeTimeout(Duration.ofSeconds(60))
                .build();

        this.objectMapper = new ObjectMapper();
        this.objectMapper.registerModule(new JavaTimeModule());
        this.objectMapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
    }

    public CreateSandboxResponse createSandbox(CreateSandboxRequest request) {
        return createSandbox(request, null);
    }

    /**
     * 创建沙箱；若 {@code idempotencyKey} 非空且配置开启，则携带 Idempotency-Key 请求头。
     */
    public CreateSandboxResponse createSandbox(CreateSandboxRequest request, String idempotencyKey) {
        String url = baseUrl + "/v1/sandboxes";
        String body = toJson(request);
        Request.Builder rb = newRequestBuilder(url)
                .post(RequestBody.create(body, JSON_MEDIA_TYPE));
        if (idempotencyKey != null
                && !idempotencyKey.isBlank()
                && properties.getOpensandbox().isSendIdempotencyKeyHeader()) {
            rb.header("Idempotency-Key", idempotencyKey.trim());
        }
        return execute(rb.build(), CreateSandboxResponse.class);
    }

    /**
     * 按 userCode、serviceKey（与创建时 metadata 一致）查询已有沙箱。
     * 远端不支持或非 2xx 时返回空列表，不阻断创建流程。
     */
    public List<SandboxDetail> listSandboxes(String userCode, String serviceKey) {
        SandboxProperties.OpenSandboxConfig cfg = properties.getOpensandbox();
        if (!cfg.isListSandboxesBeforeCreate()) {
            return List.of();
        }
        if (userCode == null || userCode.isBlank() || serviceKey == null || serviceKey.isBlank()) {
            return List.of();
        }
        String path = cfg.getListSandboxesPath();
        if (path == null || path.isBlank()) {
            path = "/v1/sandboxes";
        }
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        HttpUrl base = HttpUrl.parse(baseUrl + path);
        if (base == null) {
            log.warn("listSandboxes: invalid URL baseUrl={} path={}", baseUrl, path);
            return List.of();
        }
        HttpUrl.Builder urlBuilder = base.newBuilder()
                .addQueryParameter(cfg.getListQueryUserCodeParam(), userCode)
                .addQueryParameter(cfg.getListQueryServiceKeyParam(), serviceKey);
        Request httpRequest = newRequestBuilder(urlBuilder.build().toString()).get().build();
        try {
            return executeSandboxesList(httpRequest);
        } catch (OpenSandboxException e) {
            log.debug("listSandboxes failed (will create new if needed): {}", e.getMessage());
            return List.of();
        }
    }

    public SandboxDetail getSandbox(String sandboxId) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId;
        Request httpRequest = newRequestBuilder(url).get().build();
        return execute(httpRequest, SandboxDetail.class);
    }

    public void deleteSandbox(String sandboxId) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId;
        Request httpRequest = newRequestBuilder(url).delete().build();
        try (Response response = httpClient.newCall(httpRequest).execute()) {
            if (!response.isSuccessful() && response.code() != 404) {
                String responseBody = response.body() != null ? response.body().string() : "";
                throw new OpenSandboxException("Failed to delete sandbox " + sandboxId
                        + ", status=" + response.code() + ", body=" + responseBody);
            }
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to delete sandbox " + sandboxId, e);
        }
    }

    public SandboxEndpoint getSandboxEndpoint(String sandboxId, int port) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId + "/endpoints/" + port;
        Request httpRequest = newRequestBuilder(url).get().build();
        return execute(httpRequest, SandboxEndpoint.class);
    }

    /**
     * 续期沙箱过期时间。
     */
    public void renewExpiration(String sandboxId, RenewSandboxExpirationRequest request) {
        String url = baseUrl + "/v1/sandboxes/" + sandboxId + "/renew-expiration";
        String body = toJson(request);
        Request httpRequest = newRequestBuilder(url)
                .post(RequestBody.create(body, JSON_MEDIA_TYPE))
                .build();
        try (Response response = httpClient.newCall(httpRequest).execute()) {
            if (!response.isSuccessful()) {
                String responseBody = response.body() != null ? response.body().string() : "";
                throw new OpenSandboxException("Failed to renew expiration for sandbox " + sandboxId
                        + ", status=" + response.code() + ", body=" + responseBody);
            }
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to renew expiration for sandbox " + sandboxId, e);
        }
    }

    /**
     * 轮询等待沙箱进入 Running 状态。
     * 如果进入 Failed/Terminated 状态则抛出异常。
     */
    public SandboxDetail waitForRunning(String sandboxId, String endpoint) {
        return waitForRunning(sandboxId, endpoint, null);
    }

    /**
     * Poll until sandbox endpoint is ready.
     *
     * If {@code endpoint} already contains scheme (http/https), we use it as-is.
     * Otherwise we apply {@code protocol} (if not blank) or fall back to {@link #endpointScheme}.
     */
    public SandboxDetail waitForRunning(String sandboxId, String endpoint, String protocol) {
        long startTime = System.currentTimeMillis();
        long timeoutMs = pollTimeout.toMillis();
        long intervalMs = pollInterval.toMillis();
        String url;
        if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
            url = endpoint;
        } else {
            String scheme = (protocol != null && !protocol.isBlank()) ? protocol : endpointScheme;
            url = scheme + "://" + endpoint;
        }
        while (System.currentTimeMillis() - startTime < timeoutMs) {
            Request httpRequest = new Request.Builder().url(url).get().build();
            try (Response response = httpClient.newCall(httpRequest).execute()) {
                if (response.isSuccessful() && response.code() == 200) {
                    log.debug("Endpoint {} returned 200, sandbox {} is ready", endpoint, sandboxId);
                    return getSandbox(sandboxId);
                }
                log.debug("Endpoint {} returned {}, sandbox {} not ready", endpoint, response.code(), sandboxId);
            } catch (IOException e) {
                log.debug("Endpoint {} request failed: {}, sandbox {} not ready", endpoint, e.getMessage(), sandboxId);
            }

            try {
                Thread.sleep(intervalMs);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new OpenSandboxException("Interrupted while waiting for sandbox " + sandboxId, e);
            }
        }
        throw new OpenSandboxException("Timeout waiting for sandbox " + sandboxId
                + " to become ready after " + pollTimeout.toSeconds() + "s");
    }

    private Request.Builder newRequestBuilder(String url) {
        Request.Builder builder = new Request.Builder().url(url);
        if (apiKey != null && !apiKey.isBlank()) {
//            builder.header("Authorization", "Bearer " + apiKey);
            builder.header("OPEN-SANDBOX-API-KEY", apiKey);
        }
        return builder;
    }

    private <T> T execute(Request request, Class<T> responseType) {
        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                ErrorResponse error = null;
                try {
                    error = objectMapper.readValue(responseBody, ErrorResponse.class);
                } catch (Exception ignored) {
                }
                String msg = error != null
                        ? error.getCode() + ": " + error.getMessage()
                        : "HTTP " + response.code() + ": " + responseBody;
                throw new OpenSandboxException("OpenSandbox API error: " + msg);
            }
            return objectMapper.readValue(responseBody, responseType);
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to call OpenSandbox API: " + request.url(), e);
        }
    }

    private List<SandboxDetail> executeSandboxesList(Request request) {
        try (Response response = httpClient.newCall(request).execute()) {
            String responseBody = response.body() != null ? response.body().string() : "";
            if (!response.isSuccessful()) {
                throw new OpenSandboxException("HTTP " + response.code() + ": " + responseBody);
            }
            return parseSandboxesListBody(responseBody);
        } catch (OpenSandboxException e) {
            throw e;
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to list sandboxes: " + request.url(), e);
        }
    }

    private List<SandboxDetail> parseSandboxesListBody(String body) throws IOException {
        if (body == null) {
            return List.of();
        }
        String trimmed = body.trim();
        if (trimmed.isEmpty()) {
            return List.of();
        }
        if (trimmed.startsWith("[")) {
            return objectMapper.readValue(trimmed, new TypeReference<List<SandboxDetail>>() {});
        }
        JsonNode root = objectMapper.readTree(trimmed);
        if (root.isArray()) {
            return objectMapper.convertValue(root, new TypeReference<List<SandboxDetail>>() {});
        }
        for (String field : List.of("items", "sandboxes", "data", "results")) {
            JsonNode arr = root.get(field);
            if (arr != null && arr.isArray()) {
                return objectMapper.convertValue(arr, new TypeReference<List<SandboxDetail>>() {});
            }
        }
        return Collections.emptyList();
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (IOException e) {
            throw new OpenSandboxException("Failed to serialize request", e);
        }
    }

    private String normalizeBaseUrl(String url) {
        return url != null && url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    public static class OpenSandboxException extends RuntimeException {
        public OpenSandboxException(String message) {
            super(message);
        }

        public OpenSandboxException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
