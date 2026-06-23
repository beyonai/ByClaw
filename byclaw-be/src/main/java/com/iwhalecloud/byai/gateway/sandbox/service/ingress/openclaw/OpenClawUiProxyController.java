package com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw;

import java.nio.charset.StandardCharsets;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * OpenClaw 控制台整页反向代理（HTTP）。
 *
 * <p>opensandbox 为每个会话动态分配 openclaw 控制台端口（如 10.10.168.200:45421），动态端口
 * 外网不可达。本 controller 让浏览器统一经网关固定入口整页打开控制台：
 * <pre>
 *   /byaiService/openclaw-ui/{ip}/{port}/chat?token=xxx
 *     -> http://{ip}:{port}/chat?token=xxx
 *   /byaiService/openclaw-ui/{ip}/{port}/assets/index-*.js   （SPA 相对资源自动落到此前缀）
 *     -> http://{ip}:{port}/assets/index-*.js
 * </pre>
 * 由于 openclaw 是相对路径打包的 SPA，把 ip/port 编码进路径前缀后，相对资源、SPA 路由、
 * 内部 WS（见 {@code OpenClawWebSocketProxyHandler}）会全部自动对齐到同一前缀。
 *
 * <p>控制台从 {@code /__openclaw/control-ui-config.json} 的 {@code basePath} 字段确定路由与
 * WS 前缀，默认是空串。代理该响应时把 basePath 改写成本前缀，使其在子路径下正常工作。
 *
 * <p>ip/port 来自路径，纯透传，不做校验（按既定设计）。
 */
@RestController
public class OpenClawUiProxyController {

    private static final Logger log = LoggerFactory.getLogger(OpenClawUiProxyController.class);

    private static final String ROUTE_PREFIX = "/openclaw-ui";
    private static final String CONFIG_PATH = "/__openclaw/control-ui-config.json";

    private final OpenClawUiHttpProxyService proxyService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public OpenClawUiProxyController(OpenClawUiHttpProxyService proxyService) {
        this.proxyService = proxyService;
    }

    @RequestMapping(path = {
        "/openclaw-ui/{ip}/{port}",
        "/openclaw-ui/{ip}/{port}/**"
    })
    public void proxy(@PathVariable("ip") String ip,
                      @PathVariable("port") String port,
                      HttpServletRequest request,
                      HttpServletResponse response) {
        String upstreamPath = extractUpstreamPath(request, ip, port);
        String queryString = request.getQueryString();
        String targetUrl = "http://" + ip + ":" + port + upstreamPath
            + (queryString != null && !queryString.isBlank() ? "?" + queryString : "");

        // 浏览器可见的完整前缀（含 context-path /byaiService）：basePath 改写要用它。
        String publicPrefix = request.getContextPath() + ROUTE_PREFIX + "/" + ip + "/" + port;

        OpenClawUiHttpProxyService.ResponseBodyRewriter rewriter =
            CONFIG_PATH.equals(upstreamPath) ? body -> rewriteConfigBasePath(body, publicPrefix) : null;

        log.debug("OpenClaw ui proxy: {} {} -> {}", request.getMethod(), request.getRequestURI(), targetUrl);
        proxyService.forward(request, response, targetUrl, rewriter);
    }

    /** 剥掉 context-path 与 /openclaw-ui/{ip}/{port} 前缀，得到要转发给上游的真实路径。 */
    private String extractUpstreamPath(HttpServletRequest request, String ip, String port) {
        String uri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath != null && !contextPath.isBlank() && uri.startsWith(contextPath)) {
            uri = uri.substring(contextPath.length());
        }
        String prefix = ROUTE_PREFIX + "/" + ip + "/" + port;
        if (uri.equals(prefix)) {
            // 访问 /openclaw-ui/{ip}/{port} 本身 -> 上游根路径
            return "/";
        }
        if (uri.startsWith(prefix + "/")) {
            return uri.substring(prefix.length());
        }
        return "/";
    }

    /** 把 control-ui-config.json 的 basePath 改写为本代理前缀。 */
    private byte[] rewriteConfigBasePath(byte[] original, String publicPrefix) {
        try {
            JsonNode root = objectMapper.readTree(original);
            if (root instanceof ObjectNode objectNode) {
                objectNode.put("basePath", publicPrefix);
                return objectMapper.writeValueAsBytes(objectNode);
            }
        }
        catch (Exception e) {
            log.warn("OpenClaw ui proxy: rewrite control-ui-config.json basePath failed, passthrough", e);
        }
        return original;
    }
}
