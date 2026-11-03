package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import java.io.IOException;
import java.time.Duration;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import okhttp3.*;
import okio.ByteString;

@Component
public class SandboxVncWebSocketHandler extends AbstractWebSocketHandler {
    static final String TARGET = "sandbox.vnc.target";
    private static final String UPSTREAM = "sandbox.vnc.upstream";
    private final OkHttpClient client = new OkHttpClient.Builder().followRedirects(false).followSslRedirects(false)
        .connectTimeout(Duration.ofSeconds(15)).readTimeout(Duration.ZERO).pingInterval(Duration.ofSeconds(30)).build();

    @Override
    public void afterConnectionEstablished(WebSocketSession browser) throws Exception {
        var target = (SandboxVncTargetResolver.Target) browser.getAttributes().get(TARGET);
        if (target == null) { browser.close(CloseStatus.POLICY_VIOLATION); return; }
        browser.setBinaryMessageSizeLimit(1024 * 1024);
        browser.setTextMessageSizeLimit(1024 * 1024);
        var outbound = new ConcurrentWebSocketSessionDecorator(browser, 10000, 1024 * 1024);
        WebSocket upstream = client.newWebSocket(SandboxVncProxyController.request(target), new WebSocketListener() {
            @Override public void onMessage(WebSocket ws, String text) { send(new TextMessage(text)); }
            @Override public void onMessage(WebSocket ws, ByteString bytes) { send(new BinaryMessage(bytes.toByteArray())); }
            @Override public void onClosing(WebSocket ws, int code, String reason) { ws.close(1000, null); close(browser); }
            @Override public void onClosed(WebSocket ws, int code, String reason) { close(browser); }
            @Override public void onFailure(WebSocket ws, Throwable failure, Response response) { close(browser); }
            private void send(WebSocketMessage<?> message) {
                try { if (outbound.isOpen()) outbound.sendMessage(message); }
                catch (IOException failure) { close(browser); }
            }
        });
        browser.getAttributes().put(UPSTREAM, upstream);
        if (!browser.isOpen()) upstream.cancel();
    }
    @Override protected void handleBinaryMessage(WebSocketSession browser, BinaryMessage message) {
        WebSocket upstream = (WebSocket) browser.getAttributes().get(UPSTREAM);
        if (upstream != null && !upstream.send(ByteString.of(message.getPayload()))) close(browser);
    }
    @Override protected void handleTextMessage(WebSocketSession browser, TextMessage message) {
        WebSocket upstream = (WebSocket) browser.getAttributes().get(UPSTREAM);
        if (upstream != null && !upstream.send(message.getPayload())) close(browser);
    }
    @Override public void afterConnectionClosed(WebSocketSession browser, CloseStatus status) {
        WebSocket upstream = (WebSocket) browser.getAttributes().remove(UPSTREAM);
        if (upstream != null) upstream.cancel();
    }
    @Override public void handleTransportError(WebSocketSession browser, Throwable failure) {
        afterConnectionClosed(browser, CloseStatus.SERVER_ERROR); close(browser);
    }
    private static void close(WebSocketSession session) {
        try { if (session.isOpen()) session.close(CloseStatus.SERVER_ERROR); } catch (IOException ignored) { }
    }
}
