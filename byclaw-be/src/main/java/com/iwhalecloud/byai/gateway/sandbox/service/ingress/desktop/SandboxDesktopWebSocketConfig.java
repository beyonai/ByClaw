package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextInterceptor;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.socket.server.support.DefaultHandshakeHandler;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;

@Configuration
public class SandboxDesktopWebSocketConfig {
    private final SandboxDesktopAccess access;

    public SandboxDesktopWebSocketConfig(SandboxDesktopAccess access) { this.access = access; }

    @Bean
    public SimpleUrlHandlerMapping desktopWebSocketHandlerMapping(SandboxDesktopWebSocketProxyHandler proxy,
        @org.springframework.beans.factory.annotation.Qualifier("tokenVerifyInterceptor")
        AccessTokenVerifyInterceptor auth, TenantContextInterceptor tenant) {
        WebSocketHttpRequestHandler handler = new WebSocketHttpRequestHandler(proxy, new DefaultHandshakeHandler());
        handler.setHandshakeInterceptors(java.util.List.of(new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                WebSocketHandler wsHandler, Map<String, Object> attributes) {
                if (!(request instanceof ServletServerHttpRequest servlet)) return false;
                Object target = servlet.getServletRequest().getAttribute(SandboxDesktopWebSocketProxyHandler.TARGET_ATTRIBUTE);
                if (!(target instanceof SandboxDesktopAccess.Target)) return false;
                attributes.put(SandboxDesktopWebSocketProxyHandler.TARGET_ATTRIBUTE, target);
                return true;
            }

            @Override
            public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                WebSocketHandler wsHandler, Exception exception) { }
        }));
        SimpleUrlHandlerMapping mapping = new SimpleUrlHandlerMapping() {
            @Override
            protected Object getHandlerInternal(HttpServletRequest request) throws Exception {
                String upgrade = request.getHeader("Upgrade"), connection = request.getHeader("Connection");
                if (!"websocket".equalsIgnoreCase(upgrade) || connection == null
                    || !connection.toLowerCase(java.util.Locale.ROOT).contains("upgrade")) return null;
                return super.getHandlerInternal(request);
            }
        };
        HandlerInterceptor cleanup = new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                CurrentUserHolder.clearLoginInfo(); TenantRequestContextHolder.clear(); return true;
            }
            @Override
            public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception exception) {
                CurrentUserHolder.clearLoginInfo(); TenantRequestContextHolder.clear();
            }
        };
        HandlerInterceptor authorize = new HandlerInterceptor() {
            @Override
            public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
                request.setAttribute(SandboxDesktopWebSocketProxyHandler.TARGET_ATTRIBUTE, access.resolve(request, true));
                return true;
            }
        };
        mapping.setOrder(-1);
        mapping.setUrlMap(Map.of("/sandbox/desktop/exclusive/**", handler, "/sandbox/desktop/shared/**", handler));
        mapping.setInterceptors(cleanup, auth, tenant, authorize);
        return mapping;
    }
}
