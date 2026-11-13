package com.iwhalecloud.byai.gateway.voice;

import java.net.URI;
import java.util.List;
import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.servlet.handler.SimpleUrlHandlerMapping;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.socket.server.support.WebSocketHttpRequestHandler;

@Configuration
class VoiceStreamWebSocketConfig {
    @Bean
    SimpleUrlHandlerMapping voiceStreamHandlerMapping(VolcengineVoiceRelay relay) {
        WebSocketHttpRequestHandler handler = new WebSocketHttpRequestHandler(relay);
        handler.setHandshakeInterceptors(List.of(new HandshakeInterceptor() {
            @Override
            public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                WebSocketHandler wsHandler, Map<String, Object> attributes) {
                if (matchesBrowserAuthority(request.getHeaders())) {
                    return true;
                }
                response.setStatusCode(HttpStatus.FORBIDDEN);
                return false;
            }

            @Override
            public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                WebSocketHandler wsHandler, Exception exception) {
            }
        }));
        SimpleUrlHandlerMapping mapping = new SimpleUrlHandlerMapping();
        mapping.setOrder(-1);
        mapping.setUrlMap(Map.of("/voice/stream", handler));
        return mapping;
    }

    static boolean matchesBrowserAuthority(HttpHeaders headers) {
        String originHeader = headers.getOrigin();
        if (originHeader == null) {
            return true;
        }
        try {
            URI origin = URI.create(originHeader);
            String scheme = origin.getScheme();
            if (!"https".equals(scheme) && !"http".equals(scheme)) {
                return false;
            }
            // A TLS-terminating proxy can use HTTP to reach Spring. Compare the browser's
            // authority with the preserved Host instead of the internal servlet scheme.
            String authority = headers.getFirst(HttpHeaders.HOST);
            if (authority == null) {
                return false;
            }
            URI host = URI.create(scheme + "://" + authority);
            return origin.getHost() != null && origin.getHost().equalsIgnoreCase(host.getHost())
                && effectivePort(origin) == effectivePort(host)
                && origin.getRawUserInfo() == null && origin.getRawPath().isEmpty()
                && origin.getRawQuery() == null && origin.getRawFragment() == null;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private static int effectivePort(URI uri) {
        return uri.getPort() >= 0 ? uri.getPort() : "https".equals(uri.getScheme()) ? 443 : 80;
    }
}
