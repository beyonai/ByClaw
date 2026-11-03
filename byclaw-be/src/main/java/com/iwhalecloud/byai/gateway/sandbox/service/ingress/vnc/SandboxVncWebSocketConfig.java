package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;
import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextInterceptor;

@Configuration
public class SandboxVncWebSocketConfig {
    @Bean
    public SimpleUrlHandlerMapping sandboxVncWebSocketMapping(SandboxVncTargetResolver resolver,
        SandboxVncWebSocketHandler handler, AccessTokenVerifyInterceptor authentication,
        TenantContextInterceptor tenant) {
        var websocket = new WebSocketHttpRequestHandler(handler);
        websocket.setHandshakeInterceptors(java.util.List.of(new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                WebSocketHandler wsHandler, Map<String, Object> attributes) {
                if (!sameOrigin(request)) {
                    response.setStatusCode(org.springframework.http.HttpStatus.FORBIDDEN);
                    return false;
                }
                if (!request.getURI().getRawPath().endsWith("/websockify")) {
                    response.setStatusCode(org.springframework.http.HttpStatus.NOT_FOUND);
                    return false;
                }
                try {
                    attributes.put(SandboxVncWebSocketHandler.TARGET,
                        resolver.resolve(request.getURI().getRawPath().replaceFirst("^/byaiService", ""), request.getURI().getRawQuery()));
                    return true;
                } catch (org.springframework.web.server.ResponseStatusException denied) {
                    response.setStatusCode(denied.getStatusCode());
                    return false;
                }
            }
            @Override
            public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                WebSocketHandler handler, Exception exception) { }
        }));
        SimpleUrlHandlerMapping mapping = new SimpleUrlHandlerMapping() {
            @Override
            protected Object getHandlerInternal(HttpServletRequest request) throws Exception {
                return "websocket".equalsIgnoreCase(request.getHeader("Upgrade"))
                    ? super.getHandlerInternal(request) : null;
            }
        };
        mapping.setOrder(-1);
        mapping.setUrlMap(Map.of("/sandbox/vnc/**", websocket));
        // Custom HandlerMappings do not inherit MVC's authentication interceptors.
        mapping.setInterceptors(authentication, tenant);
        return mapping;
    }
    static boolean sameOrigin(ServerHttpRequest request) {
        String origin = request.getHeaders().getOrigin();
        if (origin == null) return false;
        try {
            java.net.URI browser = java.net.URI.create(origin);
            String forwarded = request.getHeaders().getFirst("X-Forwarded-Proto");
            String scheme = forwarded == null ? request.getURI().getScheme() : forwarded.split(",", 2)[0].trim();
            java.net.InetSocketAddress host = request.getHeaders().getHost();
            if (host == null || !(scheme.equals("http") || scheme.equals("https"))) return false;
            int serverPort = host.getPort() <= 0 ? (scheme.equals("https") ? 443 : 80) : host.getPort();
            int originPort = browser.getPort() < 0 ? ("https".equals(browser.getScheme()) ? 443 : 80) : browser.getPort();
            return scheme.equals(browser.getScheme()) && host.getHostString().equalsIgnoreCase(browser.getHost())
                && serverPort == originPort && browser.getRawUserInfo() == null;
        } catch (IllegalArgumentException invalid) { return false; }
    }

}
