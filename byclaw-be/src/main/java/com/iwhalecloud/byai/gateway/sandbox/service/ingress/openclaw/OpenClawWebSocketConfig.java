package com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw;

import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.HttpRequestHandler;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeHandler;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;

/**
 * 注册 OpenClaw 控制台整页代理中的 WebSocket 端点。
 *
 * <p>难点：openclaw 控制台的 WS 与 HTTP 资源**共用同一路径前缀**
 * {@code /openclaw-ui/{ip}/{port}/...}（WS 地址由控制台基于 location 自动推导，无独立后缀），
 * 且 {@link OpenClawUiProxyController} 也映射在该前缀下做 HTTP 全站代理。
 *
 * <p>若用默认 {@code WebSocketConfigurer} 注册，其 HandlerMapping（order=1）优先级低于
 * {@code RequestMappingHandlerMapping}（order=0），握手会被 controller 抢走；若把 order 调高，
 * 普通 HTTP 资源请求又会被 WS handler 以 400 拒绝（Spring 的 WebSocketHttpRequestHandler
 * 对非 Upgrade 请求不放行）。
 *
 * <p>解法：自建一个 order=-1 的 {@link SimpleUrlHandlerMapping}，但只在请求带
 * {@code Upgrade: websocket} 头时才匹配——非握手请求返回 null，自然回落到 controller 处理
 * HTTP；握手请求抢先进入 WS handler。
 */
@Configuration
public class OpenClawWebSocketConfig {

    private static final String WS_PATH_PATTERN = "/openclaw-ui/**";

    @Bean
    public HandshakeHandler openClawHandshakeHandler() {
        return new DefaultHandshakeHandler();
    }

    @Bean
    public SimpleUrlHandlerMapping openClawWebSocketHandlerMapping(
        OpenClawWebSocketProxyHandler proxyHandler,
        HandshakeHandler handshakeHandler) {

        WebSocketHttpRequestHandler requestHandler =
            new WebSocketHttpRequestHandler((WebSocketHandler) proxyHandler, handshakeHandler);

        // 只在 WebSocket 升级请求时匹配，否则放行给 RequestMappingHandlerMapping（controller）。
        HttpRequestHandler upgradeOnly = (request, response) -> requestHandler.handleRequest(request, response);

        SimpleUrlHandlerMapping mapping = new SimpleUrlHandlerMapping() {
            @Override
            protected Object getHandlerInternal(HttpServletRequest request) throws Exception {
                // 只在 WebSocket 升级请求时匹配；非握手请求返回 null，回落到
                // RequestMappingHandlerMapping（OpenClawUiProxyController）处理 HTTP。
                // 注意：必须重写 getHandlerInternal 这个稳定入口，而非 lookupHandler——
                // Spring 6 默认 PathPattern 解析下调用的 lookupHandler 重载不同，重写它不生效。
                if (!isWebSocketUpgrade(request)) {
                    return null;
                }
                return super.getHandlerInternal(request);
            }
        };
        mapping.setOrder(-1);
        mapping.setUrlMap(Map.of(WS_PATH_PATTERN, upgradeOnly));
        return mapping;
    }

    private static boolean isWebSocketUpgrade(HttpServletRequest request) {
        String upgrade = request.getHeader("Upgrade");
        String connection = request.getHeader("Connection");
        return upgrade != null && "websocket".equalsIgnoreCase(upgrade.trim())
            && connection != null && connection.toLowerCase().contains("upgrade");
    }
}
