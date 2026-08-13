package com.iwhalecloud.byai.gateway.sandbox.service;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
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
    private static final Set<String> LOGIN_HOSTS = Set.of(
        "mp.weixin.qq.com",
        "creator.xiaohongshu.com",
        "channels.weixin.qq.com",
        "creator.douyin.com"
    );
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
            .connectTimeout(Duration.ofMillis(REQUEST_TIMEOUT_MS))
            .build();
        this.objectMapper = new ObjectMapper();
    }

    /** 在当前用户指定的运行中沙箱内打开运营平台登录页。 */
    public void navigate(String userCode, String sandboxId, String targetUrl, String sessionKey) {
        validateRequest(userCode, sandboxId, targetUrl, sessionKey);
        SandboxInfo sandbox = findOwnedSandbox(userCode, sandboxId);
        URI commandEndpoint = buildEndpoint(sandbox, "/command");
        Map<String, Object> command = new LinkedHashMap<>();
        command.put("id", "operation_account_" + UUID.randomUUID().toString().replace("-", ""));
        command.put("action", "tabs");
        command.put("op", "new");
        command.put("url", targetUrl);
        command.put("session", sessionKey);
        command.put("surface", "browser");
        command.put("windowMode", "foreground");

        DaemonResponse response = post(commandEndpoint, command);
        if (isSuccessful(response)) {
            return;
        }

        // 采集流程在扩展断开时会先恢复浏览器，账号登录沿用同样的恢复动作。
        post(buildEndpoint(sandbox, "/v1/browser/recover"), Map.of());
        for (int attempt = 0; attempt < 10; attempt++) {
            waitForRetry();
            response = post(commandEndpoint, command);
            if (isSuccessful(response)) {
                return;
            }
        }
        log.warn("[SandboxBrowser] 浏览器导航失败，userCode={}，sandboxId={}，statusCode={}，error={}", userCode,
            sandboxId, response.statusCode(), response.body().get("error"));
        throw new IllegalStateException(StringUtils.defaultIfBlank(stringValue(response.body().get("error")),
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
        if (!"https".equalsIgnoreCase(target.getScheme()) || !LOGIN_HOSTS.contains(target.getHost())) {
            throw new IllegalArgumentException("Unsupported operation account login URL");
        }
    }

    private DaemonResponse post(URI endpoint, Map<String, Object> body) {
        try {
            HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofMillis(REQUEST_TIMEOUT_MS))
                .header(BYCLI_HEADER, "1")
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(body)))
                .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            Map<String, Object> responseBody = response.body() == null || response.body().isBlank()
                ? Map.of()
                : objectMapper.readValue(response.body(), MAP_TYPE);
            return new DaemonResponse(response.statusCode(), responseBody);
        } catch (IOException | InterruptedException exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return new DaemonResponse(503,
                Map.of("error", StringUtils.defaultIfBlank(exception.getMessage(), "sandbox browser request failed")));
        }
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

    private String stringValue(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private record DaemonResponse(int statusCode, Map<String, Object> body) {
    }
}
