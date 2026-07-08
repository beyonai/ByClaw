package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * WeCom long-connection WebSocket client, ported from the reference SDK
 * {@code src/ws.ts}. OkHttp provides the transport ONLY — the heartbeat is an
 * application-level JSON {@code {"cmd":"ping"}} frame (NOT OkHttp's native
 * pingInterval, which is a control-frame ping WeCom does not treat as the
 * app-level heartbeat).
 *
 * <p>Responsibilities (plan §6):
 * <ul>
 *   <li>Connect to {@code wss://openws.work.weixin.qq.com}, send
 *       {@code aibot_subscribe} on open.</li>
 *   <li>Start heartbeat + reset both reconnect counters only after subscribe ACK
 *       {@code errcode == 0}.</li>
 *   <li>Check-before-send heartbeat: if two consecutive ACKs are missed, close
 *       and reconnect.</li>
 *   <li>Two independent counters (auth-failure vs network) with exponential
 *       backoff capped at 30s.</li>
 *   <li>{@code disconnected_event}: stop heartbeat, mark manual-close, do NOT
 *       reconnect (connection-level teardown lives here, not in the listener).</li>
 * </ul>
 *
 * <p>ACK / reply-receipt frames are surfaced to {@link WecomWsClientListener#onReplyAck}
 * so Task 4's reply queue can resolve pending sends. Subscribe/heartbeat frames
 * are handled internally and never leak to the listener.
 */
public class WecomWsClient {

    private static final Logger logger = LoggerFactory.getLogger(WecomWsClient.class);

    static final String DEFAULT_WS_URL = "wss://openws.work.weixin.qq.com";
    private static final int MAX_MISSED_PONG = 2;
    private static final long RECONNECT_MAX_DELAY_MS = 30_000L;

    private final String botId;
    private final String secret;
    private final String wsUrl;
    private final long heartbeatIntervalMs;
    private final int maxReconnectAttempts;
    private final int maxAuthFailureAttempts;
    private final long reconnectBaseDelayMs;

    private final OkHttpClient httpClient;
    private final ObjectMapper objectMapper;
    private final WecomWsClientListener listener;
    private final ScheduledExecutorService scheduler;

    private volatile WebSocket webSocket;
    private volatile ScheduledFuture<?> heartbeatFuture;
    private volatile ScheduledFuture<?> reconnectFuture;

    private final AtomicBoolean started = new AtomicBoolean(false);
    private volatile boolean manualClose = false;
    private volatile boolean lastCloseWasAuthFailure = false;

    private final AtomicInteger reconnectAttempts = new AtomicInteger(0);
    private final AtomicInteger authFailureAttempts = new AtomicInteger(0);
    private final AtomicInteger missedPongCount = new AtomicInteger(0);

    public WecomWsClient(
            String botId,
            String secret,
            String wsUrl,
            long heartbeatIntervalMs,
            int maxReconnectAttempts,
            int maxAuthFailureAttempts,
            long reconnectBaseDelayMs,
            OkHttpClient httpClient,
            ObjectMapper objectMapper,
            WecomWsClientListener listener) {
        this.botId = botId;
        this.secret = secret;
        this.wsUrl = (wsUrl == null || wsUrl.isBlank()) ? DEFAULT_WS_URL : wsUrl;
        this.heartbeatIntervalMs = heartbeatIntervalMs <= 0 ? 30_000L : heartbeatIntervalMs;
        this.maxReconnectAttempts = maxReconnectAttempts;
        this.maxAuthFailureAttempts = maxAuthFailureAttempts;
        this.reconnectBaseDelayMs = reconnectBaseDelayMs <= 0 ? 1_000L : reconnectBaseDelayMs;
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
        this.listener = listener;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(new SchedulerThreadFactory(botId));
    }

    /** Establish the connection. Idempotent while already started. */
    public synchronized void connect() {
        if (started.get()) {
            logger.warn("WecomWsClient already started. botId={}", maskBotId());
            return;
        }
        started.set(true);
        manualClose = false;
        doConnect();
    }

    private void doConnect() {
        cancelReconnect();
        closeSocketQuietly();
        logger.info("Connecting WeCom WebSocket. url={}, botId={}", wsUrl, maskBotId());
        Request request = new Request.Builder().url(wsUrl).build();
        this.webSocket = httpClient.newWebSocket(request, new Listener());
    }

    /** Manually disconnect and stop reconnecting. */
    public synchronized void disconnect() {
        manualClose = true;
        started.set(false);
        stopHeartbeat();
        cancelReconnect();
        closeSocketQuietly();
        scheduler.shutdownNow();
        logger.info("WecomWsClient manually closed. botId={}", maskBotId());
    }

    public boolean isConnected() {
        return webSocket != null;
    }

    /** Send a frame on the socket. Returns false if the socket is not open. */
    public boolean sendFrame(WecomWsFrame frame) {
        WebSocket ws = this.webSocket;
        if (ws == null) {
            return false;
        }
        try {
            return ws.send(objectMapper.writeValueAsString(frame));
        } catch (Exception e) {
            logger.error("Failed to send WeCom frame. botId={}", maskBotId(), e);
            return false;
        }
    }

    /** Send a raw JSON string on the socket (used by the reply queue). */
    public boolean sendRaw(String json) {
        WebSocket ws = this.webSocket;
        return ws != null && ws.send(json);
    }

    // ---- auth / heartbeat --------------------------------------------------

    private void sendSubscribe() {
        ObjectNode frame = objectMapper.createObjectNode();
        frame.put("cmd", WecomWsCmd.SUBSCRIBE);
        frame.putObject("headers").put("req_id", generateReqId(WecomWsCmd.SUBSCRIBE));
        ObjectNode body = frame.putObject("body");
        body.put("bot_id", botId);
        body.put("secret", secret);
        sendJson(frame);
        logger.info("Sent aibot_subscribe. botId={}", maskBotId());
    }

    private void startHeartbeat() {
        stopHeartbeat();
        missedPongCount.set(0);
        heartbeatFuture = scheduler.scheduleAtFixedRate(
                this::heartbeatTick, heartbeatIntervalMs, heartbeatIntervalMs, TimeUnit.MILLISECONDS);
    }

    private void stopHeartbeat() {
        ScheduledFuture<?> f = heartbeatFuture;
        if (f != null) {
            f.cancel(false);
            heartbeatFuture = null;
        }
    }

    /**
     * Check-before-send (mirrors {@code ws.ts:344-367}): if we already missed
     * {@code MAX_MISSED_PONG} consecutive ACKs, treat the connection as dead;
     * else increment and send the next ping.
     */
    private void heartbeatTick() {
        if (missedPongCount.get() >= MAX_MISSED_PONG) {
            logger.warn("Heartbeat ack missed {}x, connection dead. botId={}", missedPongCount.get(), maskBotId());
            stopHeartbeat();
            // closeSocketQuietly() nulls webSocket, so the socket's own
            // onClosed/onFailure is now a stale no-op (guarded by webSocket!=ws).
            // Trigger reconnect explicitly for this intentional close.
            closeSocketQuietly();
            listener.onDisconnected("heartbeat timeout");
            scheduleReconnect();
            return;
        }
        missedPongCount.incrementAndGet();
        ObjectNode frame = objectMapper.createObjectNode();
        frame.put("cmd", WecomWsCmd.HEARTBEAT);
        frame.putObject("headers").put("req_id", generateReqId(WecomWsCmd.HEARTBEAT));
        sendJson(frame);
    }

    // ---- frame handling ----------------------------------------------------

    private void handleFrame(String text) {
        WecomWsFrame frame;
        try {
            frame = objectMapper.readValue(text, WecomWsFrame.class);
        } catch (Exception e) {
            logger.warn("Failed to parse WeCom frame. botId={}", maskBotId(), e);
            return;
        }

        String cmd = frame.getCmd();

        // Command callbacks: message / event.
        if (WecomWsCmd.CALLBACK.equals(cmd)) {
            listener.onCallback(frame);
            return;
        }
        if (WecomWsCmd.EVENT_CALLBACK.equals(cmd)) {
            if (isDisconnectedEvent(frame.getBody())) {
                handleDisconnectedEvent();
                return;
            }
            listener.onCallback(frame);
            return;
        }

        // No cmd -> ACK / heartbeat / subscribe response, routed by req_id prefix.
        String reqId = frame.reqId();
        if (reqId == null) {
            logger.warn("Ignoring unknown WeCom frame with no cmd/req_id. botId={}", maskBotId());
            return;
        }

        if (reqId.startsWith(WecomWsCmd.SUBSCRIBE)) {
            handleSubscribeAck(frame);
            return;
        }
        if (reqId.startsWith(WecomWsCmd.HEARTBEAT)) {
            if (frame.isSuccess()) {
                missedPongCount.set(0);
            } else {
                logger.warn("Heartbeat ack error. botId={}, errcode={}", maskBotId(), frame.getErrcode());
            }
            return;
        }

        // Reply-receipt ACK -> hand to the reply queue (Task 4).
        listener.onReplyAck(frame);
    }

    private void handleSubscribeAck(WecomWsFrame frame) {
        if (!frame.isSuccess()) {
            logger.error("WeCom subscribe failed. botId={}, errcode={}, errmsg={}",
                    maskBotId(), frame.getErrcode(), frame.getErrmsg());
            lastCloseWasAuthFailure = true;
            listener.onError(new IllegalStateException(
                    "aibot_subscribe failed: errcode=" + frame.getErrcode()));
            // closeSocketQuietly() nulls webSocket, so the socket's own
            // onClosed/onFailure is a stale no-op now. Reconnect explicitly
            // via the auth-failure counter.
            closeSocketQuietly();
            listener.onDisconnected("subscribe failed");
            scheduleReconnect();
            return;
        }
        logger.info("WeCom subscribe ok. botId={}", maskBotId());
        reconnectAttempts.set(0);
        authFailureAttempts.set(0);
        startHeartbeat();
        listener.onAuthenticated();
    }

    private boolean isDisconnectedEvent(JsonNode body) {
        return body != null
                && WecomWsCmd.DISCONNECTED_EVENT.equals(body.path("event").path("eventtype").asText(null));
    }

    private void handleDisconnectedEvent() {
        logger.warn("Received disconnected_event: connection taken over. botId={}", maskBotId());
        manualClose = true;
        stopHeartbeat();
        closeSocketQuietly();
        listener.onServerTakeover("New connection established, server disconnected this connection");
    }

    // ---- reconnect ---------------------------------------------------------

    private void scheduleReconnect() {
        if (manualClose || !started.get()) {
            return;
        }
        boolean authFailure = lastCloseWasAuthFailure;
        AtomicInteger counter = authFailure ? authFailureAttempts : reconnectAttempts;
        int max = authFailure ? maxAuthFailureAttempts : maxReconnectAttempts;

        if (max != -1 && counter.get() >= max) {
            logger.error("Max {} attempts reached ({}), giving up. botId={}",
                    authFailure ? "auth" : "reconnect", max, maskBotId());
            String reason = (authFailure ? "auth" : "reconnect") + " attempts exhausted";
            listener.onError(new IllegalStateException(reason));
            // Terminal: this client will not reconnect. Tell the registry so it
            // stops the connection and releases the Redis lock for takeover.
            started.set(false);
            listener.onExhausted(reason);
            return;
        }
        int attempt = counter.incrementAndGet();
        long delay = Math.min(reconnectBaseDelayMs * (1L << (attempt - 1)), RECONNECT_MAX_DELAY_MS);
        logger.info("Reconnecting in {}ms ({} attempt {}/{}). botId={}",
                delay, authFailure ? "auth" : "network", attempt, max, maskBotId());
        listener.onReconnecting(attempt);
        reconnectFuture = scheduler.schedule(() -> {
            if (manualClose || !started.get()) {
                return;
            }
            // Ownership gate: re-validate the Redis single-active lock (CAS) before
            // reconnecting. If this instance lost the lock while it was down (its
            // TTL expired and another instance took the bot over), reconnecting here
            // would kick the new owner via WeCom takeover. Stop instead and let the
            // registry release local state.
            if (!listener.canReconnect()) {
                logger.warn("Skipping reconnect: no longer own the bot lock. botId={}", maskBotId());
                started.set(false);
                listener.onExhausted("lock ownership lost, not reconnecting");
                return;
            }
            doConnect();
        }, delay, TimeUnit.MILLISECONDS);
    }

    private void cancelReconnect() {
        ScheduledFuture<?> f = reconnectFuture;
        if (f != null) {
            f.cancel(false);
            reconnectFuture = null;
        }
    }

    // ---- helpers -----------------------------------------------------------

    private void sendJson(JsonNode frame) {
        WebSocket ws = this.webSocket;
        if (ws == null) {
            logger.warn("Cannot send, socket not open. botId={}", maskBotId());
            return;
        }
        ws.send(frame.toString());
    }

    private void closeSocketQuietly() {
        WebSocket ws = this.webSocket;
        if (ws != null) {
            try {
                ws.cancel();
            } catch (Exception ignored) {
                // best effort
            }
            this.webSocket = null;
        }
    }

    public static String generateReqId(String prefix) {
        return prefix + "_" + System.nanoTime() + "_" + Integer.toHexString((int) (Math.random() * 0xFFFF));
    }

    private String maskBotId() {
        if (botId == null || botId.length() <= 4) {
            return "***";
        }
        return "***" + botId.substring(botId.length() - 4);
    }

    private final class Listener extends WebSocketListener {
        @Override
        public void onOpen(WebSocket ws, Response response) {
            // Ignore a stale socket's onOpen: after a reconnect installed a new
            // socket, an old socket completing its upgrade must not send auth or
            // reset counters against the live connection's state.
            if (WecomWsClient.this.webSocket != ws) {
                return;
            }
            logger.info("WeCom WebSocket open, sending auth. botId={}", maskBotId());
            missedPongCount.set(0);
            lastCloseWasAuthFailure = false;
            sendSubscribe();
            listener.onConnected();
        }

        @Override
        public void onMessage(WebSocket ws, String text) {
            // Ignore frames from a superseded socket. Critically, an old socket
            // receiving disconnected_event must not tear down the live socket.
            if (WecomWsClient.this.webSocket != ws) {
                return;
            }
            try {
                handleFrame(text);
            } catch (Exception e) {
                logger.error("Error handling WeCom frame. botId={}", maskBotId(), e);
            }
        }

        @Override
        public void onClosing(WebSocket ws, int code, String reason) {
            ws.close(code, reason);
        }

        @Override
        public void onClosed(WebSocket ws, int code, String reason) {
            // Ignore stale callbacks: an old socket's onClosed can arrive after
            // doConnect() installed a new socket. Acting on it would null the
            // live socket and fail the new connection's reply queue.
            if (WecomWsClient.this.webSocket != ws) {
                return;
            }
            logger.warn("WeCom WebSocket closed. code={}, botId={}", code, maskBotId());
            stopHeartbeat();
            WecomWsClient.this.webSocket = null;
            listener.onDisconnected(reason == null ? ("code:" + code) : reason);
            if (!manualClose) {
                scheduleReconnect();
            }
        }

        @Override
        public void onFailure(WebSocket ws, Throwable t, Response response) {
            // Ignore stale callbacks from a superseded socket (see onClosed).
            if (WecomWsClient.this.webSocket != ws) {
                return;
            }
            logger.error("WeCom WebSocket failure. botId={}", maskBotId(), t);
            stopHeartbeat();
            WecomWsClient.this.webSocket = null;
            listener.onError(t);
            listener.onDisconnected(t.getMessage());
            if (!manualClose) {
                scheduleReconnect();
            }
        }
    }

    private static final class SchedulerThreadFactory implements ThreadFactory {
        private final String botIdSuffix;
        private final AtomicInteger counter = new AtomicInteger(1);

        private SchedulerThreadFactory(String botId) {
            this.botIdSuffix = botId == null || botId.length() <= 4
                    ? "bot" : botId.substring(botId.length() - 4);
        }

        @Override
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "wecom-ws-" + botIdSuffix + "-" + counter.getAndIncrement());
            t.setDaemon(true);
            return t;
        }
    }
}
