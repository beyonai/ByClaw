package com.iwhalecloud.byai.gateway.sandbox.service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.SandboxIngressRuntimeResolver;

import lombok.extern.slf4j.Slf4j;
import okhttp3.HttpUrl;

/**
 * 复用采集链路的沙箱浏览器导航能力，避免前端跨域直连 byCLI 服务。
 */
@Service
@Slf4j
public class SandboxBrowserNavigationService {

    private static final String BYCLI_HEADER = "X-byCLI";
    private static final int REQUEST_TIMEOUT_MS = 10_000;
    private static final int MAX_LOG_VALUE_LENGTH = 500;
    private static final Pattern SENSITIVE_PARAMETER_PATTERN = Pattern.compile(
        "(?i)(token|authorization|cookie|secret|password|ticket)=([^\\s&,}]+)");
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final SandboxService sandboxService;
    private final SandboxIngressRuntimeResolver runtimeResolver;
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public SandboxBrowserNavigationService(
        SandboxService sandboxService,
        SandboxIngressRuntimeResolver runtimeResolver
    ) {
        this.sandboxService = sandboxService;
        this.runtimeResolver = runtimeResolver;
        this.httpClient = HttpClient.newBuilder()
            .version(HttpClient.Version.HTTP_1_1)
            .connectTimeout(Duration.ofMillis(REQUEST_TIMEOUT_MS))
            .build();
        this.objectMapper = new ObjectMapper();
    }

    /** 在当前用户指定的运行中沙箱内打开运营平台登录页。 */
    public void navigate(String userCode, String sandboxId, String targetUrl, String sessionKey) {
        validateRequest(userCode, sandboxId, targetUrl, sessionKey);
        SandboxInfo sandbox = findOwnedSandbox(userCode, sandboxId);
        URI commandEndpoint = buildEndpoint(sandbox, "/command");
        String operationId = "operation_account_" + UUID.randomUUID().toString().replace("-", "");
        Map<String, Object> command = new LinkedHashMap<>();
        command.put("id", operationId);
        command.put("action", "tabs");
        command.put("op", "new");
        command.put("url", targetUrl);
        command.put("session", sessionKey);
        command.put("surface", "browser");
        command.put("windowMode", "foreground");

        Long requestId = RequestContextUtil.getRequestId();
        log.info("[SandboxBrowser] stage=NAVIGATION_START requestId={} operationId={} userCode={} sandboxId={} "
                + "sessionKey={} target={} endpoint={}",
            requestId, operationId, userCode, sandboxId, sessionKey, safeUri(targetUrl), safeUri(commandEndpoint));

        DaemonResponse response = post(commandEndpoint, command);
        logResponse("INITIAL_COMMAND", 1, requestId, operationId, userCode, sandboxId, response);
        if (isSuccessful(response)) {
            logSuccess(requestId, operationId, userCode, sandboxId, sessionKey, 1, response);
            return;
        }

        // 采集流程在扩展断开时会先恢复浏览器，账号登录沿用同样的恢复动作。
        URI recoverEndpoint = buildEndpoint(sandbox, "/v1/browser/recover");
        log.warn("[SandboxBrowser] stage=RECOVERY_START requestId={} operationId={} userCode={} sandboxId={} "
                + "triggerStatusCode={} triggerErrorCode={} triggerError={} endpoint={}",
            requestId, operationId, userCode, sandboxId, response.statusCode(), response.errorCode(),
            response.error(), safeUri(recoverEndpoint));
        DaemonResponse recoverResponse = post(recoverEndpoint, Map.of());
        logResponse("BROWSER_RECOVER", 1, requestId, operationId, userCode, sandboxId, recoverResponse);
        // 浏览器启动需要时间（约10-15秒），首次启动需要等待浏览器进程启动和扩展连接
        try {
            Thread.sleep(3000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        for (int attempt = 0; attempt < 20; attempt++) {
            response = post(commandEndpoint, command);
            int totalAttempt = attempt + 2;
            logResponse("RETRY_COMMAND", totalAttempt, requestId, operationId, userCode, sandboxId, response);
            if (isSuccessful(response)) {
                logSuccess(requestId, operationId, userCode, sandboxId, sessionKey, totalAttempt, response);
                return;
            }
            waitForRetry();
        }
        log.error("[SandboxBrowser] stage=NAVIGATION_FAILURE requestId={} operationId={} userCode={} sandboxId={} "
                + "sessionKey={} attempts={} statusCode={} ok={} errorCode={} error={} responseKeys={} "
                + "responseLength={} durationMs={} transportFailureType={} transportFailure={}",
            requestId, operationId, userCode, sandboxId, sessionKey, 21, response.statusCode(), response.ok(),
            response.errorCode(), response.error(), response.bodyKeys(), response.responseLength(),
            response.durationMs(), response.failureType(), response.failureMessage());
        throw new IllegalStateException(StringUtils.defaultIfBlank(response.error(),
            "sandbox browser navigation failed"));
    }

    private SandboxInfo findOwnedSandbox(String userCode, String sandboxId) {
        List<SandboxInfo> sandboxes = sandboxService.sandboxInfo(userCode);
        if (sandboxes == null) {
            throw new IllegalStateException("No running sandbox found");
        }
        return sandboxes.stream()
            .filter(item -> item != null && StringUtils.equals(item.getSandboxId(), sandboxId))
            .findFirst()
            .orElseThrow(() -> new IllegalStateException("Sandbox does not belong to current user"));
    }

    private URI buildEndpoint(SandboxInfo sandbox, String path) {
        String endpoint = null;
        if (sandbox.getInstanceEndpoints() != null) {
            for (Map.Entry<String, String> entry : sandbox.getInstanceEndpoints().entrySet()) {
                // 兼容历史沙箱规格中 bycil 的拼写，同时优先使用规范的 bycli。
                if ("bycli".equalsIgnoreCase(entry.getKey()) || "bycil".equalsIgnoreCase(entry.getKey())) {
                    endpoint = StringUtils.trimToNull(entry.getValue());
                    if ("bycli".equalsIgnoreCase(entry.getKey()) && endpoint != null) break;
                }
            }
        }
        if (endpoint == null && sandbox.getEndpoints() != null && !sandbox.getEndpoints().isEmpty()) {
            endpoint = StringUtils.trimToNull(sandbox.getEndpoints().getFirst());
        }
        if (endpoint == null) {
            throw new IllegalStateException("Sandbox browser endpoint is unavailable");
        }
        HttpUrl target = runtimeResolver.resolve().buildTargetUrl(endpoint, path, null);
        return target.uri();
    }

    private void validateRequest(String userCode, String sandboxId, String targetUrl, String sessionKey) {
        if (StringUtils.isBlank(userCode) || StringUtils.isBlank(sandboxId) || StringUtils.isBlank(sessionKey)) {
            throw new IllegalArgumentException("Sandbox navigation parameters are required");
        }
        URI target = URI.create(targetUrl);
        // CustomLink 支持公网、内网与 localhost，仅限制为浏览器可安全导航的 HTTP(S) 协议。
        boolean supportedScheme = "http".equalsIgnoreCase(target.getScheme())
            || "https".equalsIgnoreCase(target.getScheme());
        if (!supportedScheme || StringUtils.isBlank(target.getHost())) {
            throw new IllegalArgumentException("Unsupported operation account login URL");
        }
    }

    private DaemonResponse post(URI endpoint, Map<String, Object> body) {
        long startedAt = System.nanoTime();
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofMillis(REQUEST_TIMEOUT_MS))
                .header(BYCLI_HEADER, "1")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            String rawBody = response.body();
            int responseLength = rawBody == null ? 0 : rawBody.length();
            String contentType = response.headers().firstValue("Content-Type").orElse(null);
            try {
                Map<String, Object> responseBody = rawBody == null || rawBody.isBlank()
                    ? Map.of()
                    : objectMapper.readValue(rawBody, MAP_TYPE);
                return new DaemonResponse(response.statusCode(), responseBody, elapsedMillis(startedAt),
                    responseLength, contentType, null, null);
            } catch (IOException parseException) {
                return new DaemonResponse(response.statusCode(), Map.of("error", "invalid daemon response"),
                    elapsedMillis(startedAt), responseLength, contentType, parseException.getClass().getSimpleName(),
                    safeLogValue(parseException.getMessage()));
            }
        } catch (IOException | InterruptedException exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            String error = safeLogValue(StringUtils.defaultIfBlank(exception.getMessage(),
                "sandbox browser request failed"));
            return new DaemonResponse(503, Map.of("error", error), elapsedMillis(startedAt), 0, null,
                exception.getClass().getSimpleName(), error);
        }
    }

    private void logResponse(String phase, int attempt, Long requestId, String operationId, String userCode,
                             String sandboxId, DaemonResponse response) {
        String message = "[SandboxBrowser] stage=COMMAND_RESULT phase={} attempt={} requestId={} operationId={} "
            + "userCode={} sandboxId={} statusCode={} ok={} responseId={} errorCode={} error={} responseKeys={} "
            + "responseLength={} contentType={} durationMs={} transportFailureType={} transportFailure={}";
        Object[] arguments = { phase, attempt, requestId, operationId, userCode, sandboxId, response.statusCode(),
            response.ok(), response.responseId(), response.errorCode(), response.error(), response.bodyKeys(),
            response.responseLength(), response.contentType(), response.durationMs(), response.failureType(),
            response.failureMessage() };
        if (isSuccessful(response)) {
            log.info(message, arguments);
        } else {
            log.warn(message, arguments);
        }
    }

    private void logSuccess(Long requestId, String operationId, String userCode, String sandboxId,
                            String sessionKey, int attempts, DaemonResponse response) {
        log.info("[SandboxBrowser] stage=NAVIGATION_SUCCESS requestId={} operationId={} userCode={} sandboxId={} "
                + "sessionKey={} attempts={} statusCode={} durationMs={}",
            requestId, operationId, userCode, sandboxId, sessionKey, attempts, response.statusCode(),
            response.durationMs());
    }

    private boolean isSuccessful(DaemonResponse response) {
        return response.statusCode() >= 200 && response.statusCode() < 300
            && Boolean.TRUE.equals(response.body().get("ok"));
    }

    private void waitForRetry() {
        try {
            Thread.sleep(500);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    private static long elapsedMillis(long startedAt) {
        return Duration.ofNanos(System.nanoTime() - startedAt).toMillis();
    }

    public static String safeUri(String value) {
        if (StringUtils.isBlank(value)) {
            return value;
        }
        try {
            return safeUri(URI.create(value));
        } catch (IllegalArgumentException exception) {
            return "<invalid-uri>";
        }
    }

    private static String safeUri(URI uri) {
        if (uri == null) {
            return null;
        }
        String host = uri.getHost();
        if (host == null) {
            return uri.getScheme() == null ? "<relative-uri>" : uri.getScheme() + ":<invalid-host>";
        }
        String displayHost = host.contains(":") ? "[" + host + "]" : host;
        String port = uri.getPort() < 0 ? "" : ":" + uri.getPort();
        String path = StringUtils.defaultIfBlank(uri.getRawPath(), "/");
        return uri.getScheme() + "://" + displayHost + port + path;
    }

    public static String safeLogValue(String value) {
        if (value == null) {
            return null;
        }
        String sanitized = SENSITIVE_PARAMETER_PATTERN.matcher(value).replaceAll("$1=<redacted>")
            .replace('\n', ' ')
            .replace('\r', ' ');
        return StringUtils.abbreviate(sanitized, MAX_LOG_VALUE_LENGTH);
    }

    public static String safeStackTrace(Throwable throwable) {
        if (throwable == null) {
            return null;
        }
        StringBuilder summary = new StringBuilder();
        Throwable current = throwable;
        int causeCount = 0;
        while (current != null && causeCount < 3) {
            if (causeCount > 0) {
                summary.append(" causedBy=");
            }
            summary.append(current.getClass().getName());
            StackTraceElement[] frames = current.getStackTrace();
            int frameCount = Math.min(frames.length, 12);
            for (int index = 0; index < frameCount; index++) {
                summary.append(" at ").append(frames[index]);
            }
            current = current.getCause();
            causeCount++;
        }
        return StringUtils.abbreviate(summary.toString(), 4000);
    }

    private record DaemonResponse(int statusCode, Map<String, Object> body, long durationMs, int responseLength,
                                  String contentType, String failureType, String failureMessage) {

        private Object ok() {
            return body == null ? null : body.get("ok");
        }

        private String responseId() {
            return safeLogValue(value("id"));
        }

        private String errorCode() {
            return safeLogValue(value("errorCode"));
        }

        private String error() {
            return safeLogValue(value("error"));
        }

        private Set<String> bodyKeys() {
            return body == null ? Collections.emptySet() : body.keySet();
        }

        private String value(String key) {
            Object value = body == null ? null : body.get(key);
            return value == null ? null : String.valueOf(value);
        }
    }
}
