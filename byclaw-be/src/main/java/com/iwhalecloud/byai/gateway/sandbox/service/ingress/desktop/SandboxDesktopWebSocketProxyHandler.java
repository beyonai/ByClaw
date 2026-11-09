package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw.OpenClawWebSocketProxyHandler;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import okhttp3.HttpUrl;
import okhttp3.Request;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.SubProtocolCapable;
import org.springframework.web.socket.WebSocketSession;

/** Only the scoped handshake can supply this handler's upstream target. */
@Component
public class SandboxDesktopWebSocketProxyHandler extends OpenClawWebSocketProxyHandler implements SubProtocolCapable {
    public static final String TARGET_ATTRIBUTE = "sandbox.desktop.authorized-target";

    public SandboxDesktopWebSocketProxyHandler() { super(false); }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        // noVNC frames exceed the servlet container's default 8 KiB message buffer.
        // Keep the allowance bounded and local to authenticated desktop sessions.
        session.setBinaryMessageSizeLimit(2 * 1024 * 1024);
        session.setTextMessageSizeLimit(64 * 1024);
        super.afterConnectionEstablished(session);
    }

    @Override
    public List<String> getSubProtocols() { return List.of("binary"); }

    @Override
    protected Request buildUpstreamRequest(WebSocketSession session) {
        Object value = session.getAttributes().get(TARGET_ATTRIBUTE);
        if (!(value instanceof SandboxDesktopAccess.Target target)) return null;
        HttpUrl url = target.url();
        Request.Builder request = new Request.Builder().url(url.toString().replaceFirst("^http", "ws"));
        target.headers().forEach((name, header) -> {
            if (!Set.of("cookie", "beyond-token", "host", "connection", "upgrade").contains(name.toLowerCase(Locale.ROOT))) {
                request.header(name, header);
            }
        });
        request.header("Origin", url.scheme() + "://" + url.host()
            + (("https".equals(url.scheme()) && url.port() == 443) || ("http".equals(url.scheme()) && url.port() == 80) ? "" : ":" + url.port()));
        if ("binary".equals(session.getAcceptedProtocol())) request.header("Sec-WebSocket-Protocol", "binary");
        return request.build();
    }
}
