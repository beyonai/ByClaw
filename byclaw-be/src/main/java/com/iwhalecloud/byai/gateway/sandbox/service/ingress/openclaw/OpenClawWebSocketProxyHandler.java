package com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw;

import java.io.IOException;
import java.net.URI;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * OpenClaw 控制台整页代理中的 WebSocket 反向代理。
 *
 * <p>opensandbox 为每个会话动态分配 openclaw 控制台端口（如 10.10.168.200:45421），动态端口
 * 外网不可达。整页代理下，控制台页面经
 * {@code /byaiService/openclaw-ui/{ip}/{port}/...} 打开，其内部 WS 也基于 location 推导出
 * 同前缀地址（见 bundle 的 {@code zf()}）。本 handler 接受握手后，从路径解析出 ip/port 与
 * 剩余路径，用 OkHttp 回连 {@code ws://{ip}:{port}/<剩余>?<query>}，双向转发帧。
 *
 * <p>ip:port 来自请求路径，纯透传，不做校验。
 */
@Component
public class OpenClawWebSocketProxyHandler extends AbstractWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(OpenClawWebSocketProxyHandler.class);

    /** 路由前缀（相对 context-path）。 */
    private static final String ROUTE_PREFIX = "/openclaw-ui";

    /** 存放 upstream（网关->sandbox）WebSocket 句柄的会话属性键。 */
    private static final String UPSTREAM_ATTR = "openclaw.upstream.ws";

    private final OkHttpClient wsClient;

    public OpenClawWebSocketProxyHandler() {
        // WebSocket 为长连接，不能设置 callTimeout / readTimeout，否则会被定时强杀。
        // pingInterval 维持连接活性。
        this.wsClient = new OkHttpClient.Builder()
            .connectTimeout(java.time.Duration.ofSeconds(30))
            .readTimeout(java.time.Duration.ZERO)
            .writeTimeout(java.time.Duration.ofSeconds(30))
            .pingInterval(java.time.Duration.ofSeconds(30))
            .build();
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession browserSession) {
        URI uri = browserSession.getUri();
        if (uri == null) {
            closeQuietly(browserSession, CloseStatus.SERVER_ERROR.withReason("missing request uri"));
            return;
        }
        // 整页代理下，WS 路径为 /byaiService/openclaw-ui/{ip}/{port}/<剩余>，
        // openclaw 控制台内部基于 location 自动推导出该地址（见 bundle zf()）。
        UpstreamTarget target = parsePathTarget(uri.getRawPath(), uri.getRawQuery());
        if (target == null) {
            log.warn("OpenClaw ws proxy rejected: cannot parse ip/port from path={}", uri.getRawPath());
            closeQuietly(browserSession, CloseStatus.BAD_DATA.withReason("missing ip/port in path"));
            return;
        }

        log.debug("OpenClaw ws proxy connecting upstream: sessionId={}, target={}",
            browserSession.getId(), maskToken(target.url()));

        // openclaw 网关握手时校验 Origin（不在白名单则返回 CONTROL_UI_ORIGIN_NOT_ALLOWED）。
        // 整页代理下浏览器带的是网关 Origin，这里改写成 openclaw 自身地址使其同源放行。
        Request upstreamRequest = new Request.Builder()
            .url(target.url())
            .header("Origin", "http://" + target.ip() + ":" + target.port())
            .build();
        WebSocket upstream = wsClient.newWebSocket(upstreamRequest,
            new UpstreamListener(browserSession));
        browserSession.getAttributes().put(UPSTREAM_ATTR, upstream);
    }

    @Override
    protected void handleTextMessage(WebSocketSession browserSession, TextMessage message) {
        WebSocket upstream = upstream(browserSession);
        if (upstream != null) {
            upstream.send(message.getPayload());
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession browserSession, BinaryMessage message) {
        WebSocket upstream = upstream(browserSession);
        if (upstream != null) {
            upstream.send(ByteString.of(message.getPayload()));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession browserSession, CloseStatus status) {
        WebSocket upstream = upstream(browserSession);
        if (upstream != null) {
            // 1000 正常关闭；把浏览器关闭原因透传给 sandbox。
            upstream.close(normalizeCloseCode(status.getCode()), status.getReason());
            browserSession.getAttributes().remove(UPSTREAM_ATTR);
        }
        log.debug("OpenClaw ws proxy browser session closed: sessionId={}, code={}",
            browserSession.getId(), status.getCode());
    }

    @Override
    public void handleTransportError(WebSocketSession browserSession, Throwable exception) {
        log.debug("OpenClaw ws proxy browser transport error: sessionId={}", browserSession.getId(), exception);
        WebSocket upstream = upstream(browserSession);
        if (upstream != null) {
            upstream.cancel();
            browserSession.getAttributes().remove(UPSTREAM_ATTR);
        }
        closeQuietly(browserSession, CloseStatus.SERVER_ERROR);
    }

    private WebSocket upstream(WebSocketSession browserSession) {
        Object value = browserSession.getAttributes().get(UPSTREAM_ATTR);
        return value instanceof WebSocket ws ? ws : null;
    }

    /** OkHttp 回连 sandbox 的监听器：把 sandbox 的帧写回浏览器，关闭/错误互相传播。 */
    private static final class UpstreamListener extends WebSocketListener {

        private final WebSocketSession browserSession;

        private UpstreamListener(WebSocketSession browserSession) {
            this.browserSession = browserSession;
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
            sendToBrowser(new TextMessage(text));
        }

        @Override
        public void onMessage(WebSocket webSocket, ByteString bytes) {
            sendToBrowser(new BinaryMessage(bytes.toByteArray()));
        }

        @Override
        public void onClosing(WebSocket webSocket, int code, String reason) {
            webSocket.close(code, reason);
            closeBrowser(new CloseStatus(normalizeCloseCode(code), reason));
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable t, Response response) {
            log.debug("OpenClaw ws proxy upstream failure: sessionId={}", browserSession.getId(), t);
            closeBrowser(CloseStatus.SERVER_ERROR.withReason("upstream failure"));
        }

        private void sendToBrowser(org.springframework.web.socket.WebSocketMessage<?> message) {
            try {
                if (browserSession.isOpen()) {
                    synchronized (browserSession) {
                        browserSession.sendMessage(message);
                    }
                }
            }
            catch (IOException e) {
                log.debug("OpenClaw ws proxy write to browser failed: sessionId={}", browserSession.getId(), e);
            }
        }

        private void closeBrowser(CloseStatus status) {
            try {
                if (browserSession.isOpen()) {
                    browserSession.close(status);
                }
            }
            catch (IOException e) {
                log.debug("OpenClaw ws proxy close browser failed: sessionId={}", browserSession.getId(), e);
            }
        }
    }

    /**
     * 从代理路径解析出上游 WS 地址。路径形如
     * {@code [/byaiService]/openclaw-ui/{ip}/{port}/<剩余>}，转发到
     * {@code ws://{ip}:{port}/<剩余>?<query>}。返回 null 表示无法解析。
     */
    private static UpstreamTarget parsePathTarget(String rawPath, String rawQuery) {
        if (isBlank(rawPath)) {
            return null;
        }
        int idx = rawPath.indexOf(ROUTE_PREFIX + "/");
        if (idx < 0) {
            return null;
        }
        String afterPrefix = rawPath.substring(idx + ROUTE_PREFIX.length() + 1);
        // afterPrefix = {ip}/{port}[/剩余]
        int firstSlash = afterPrefix.indexOf('/');
        if (firstSlash < 0) {
            return null;
        }
        String ip = afterPrefix.substring(0, firstSlash);
        String rest = afterPrefix.substring(firstSlash + 1);
        int secondSlash = rest.indexOf('/');
        String port = secondSlash < 0 ? rest : rest.substring(0, secondSlash);
        String upstreamPath = secondSlash < 0 ? "/" : rest.substring(secondSlash);
        if (isBlank(ip) || isBlank(port)) {
            return null;
        }
        StringBuilder url = new StringBuilder("ws://").append(ip).append(':').append(port).append(upstreamPath);
        if (!isBlank(rawQuery)) {
            url.append('?').append(rawQuery);
        }
        return new UpstreamTarget(ip, port, url.toString());
    }

    /** 上游 WS 目标：ip/port 用于改写 Origin，url 为拼好的回连地址。 */
    private record UpstreamTarget(String ip, String port, String url) {
    }

    /**
     * 浏览器/WebSocket 关闭码合法范围为 1000-4999；非该范围（如 1006 异常关闭）回落到 1011。
     */
    private static int normalizeCloseCode(int code) {
        if (code >= 1000 && code <= 4999 && code != 1005 && code != 1006) {
            return code;
        }
        return 1011;
    }

    private void closeQuietly(WebSocketSession session, CloseStatus status) {
        try {
            if (session.isOpen()) {
                session.close(status);
            }
        }
        catch (IOException e) {
            log.debug("OpenClaw ws proxy closeQuietly failed: sessionId={}", session.getId(), e);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private static String maskToken(String url) {
        return url.replaceAll("token=[^&]+", "token=***");
    }
}
