package com.iwhalecloud.byai.gateway.voice;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.staticdata.StaticDataQueryApplicationService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import jakarta.annotation.PreDestroy;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.BinaryMessage;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.AbstractWebSocketHandler;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

@Component
final class VolcengineVoiceRelay extends AbstractWebSocketHandler {
    private static final int MAX_AUDIO_BYTES = 60 * 16000 * 2;
    private static final int MAX_FRAME_BYTES = 6400 + 8;
    private static final int MAX_AUTH_BYTES = 8192;
    private static final CloseStatus TIMEOUT = CloseStatus.POLICY_VIOLATION.withReason("Voice stream timed out");

    private final JwtService jwtService;
    private final StaticDataQueryApplicationService configs;
    private final ObjectMapper json;
    private final OkHttpClient upstream;
    private final ScheduledThreadPoolExecutor timers = new ScheduledThreadPoolExecutor(1, task -> {
        Thread thread = new Thread(task, "voice-stream-timeouts");
        thread.setDaemon(true);
        return thread;
    });
    private final Semaphore capacity = new Semaphore(128);
    private final Map<String, Stream> streams = new ConcurrentHashMap<>();

    @Autowired
    VolcengineVoiceRelay(JwtService jwtService, StaticDataQueryApplicationService configs, ObjectMapper json) {
        this(jwtService, configs, json, new OkHttpClient.Builder()
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .followRedirects(false)
            .followSslRedirects(false)
            .build());
    }

    VolcengineVoiceRelay(JwtService jwtService, StaticDataQueryApplicationService configs, ObjectMapper json,
        OkHttpClient upstream) {
        this.jwtService = jwtService;
        this.configs = configs;
        this.json = json;
        this.upstream = upstream;
        timers.setRemoveOnCancelPolicy(true);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws IOException {
        session.setBinaryMessageSizeLimit(MAX_FRAME_BYTES);
        session.setTextMessageSizeLimit(MAX_AUTH_BYTES);
        Stream stream = new Stream(session);
        streams.put(session.getId(), stream);
        stream.scheduleTimeout(3);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Stream stream = streams.get(session.getId());
        if (stream != null) {
            stream.authenticate(message.getPayload());
        }
    }

    @Override
    protected void handleBinaryMessage(WebSocketSession session, BinaryMessage message) {
        Stream stream = streams.get(session.getId());
        if (stream != null) {
            stream.forward(message.getPayload());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        finish(session, CloseStatus.SERVER_ERROR);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        finish(session, status);
    }

    private void finish(WebSocketSession session, CloseStatus status) {
        Stream stream = streams.get(session.getId());
        if (stream != null) {
            stream.close(status);
        }
    }

    @PreDestroy
    void shutdown() {
        streams.values().forEach(stream -> stream.close(CloseStatus.GOING_AWAY));
        timers.shutdownNow();
        upstream.dispatcher().executorService().shutdown();
        upstream.connectionPool().evictAll();
    }

    private final class Stream extends WebSocketListener {
        private final WebSocketSession browser;
        private ScheduledFuture<?> timeout;
        private WebSocket provider;
        private boolean authenticated;
        private boolean ready;
        private boolean closed;
        private boolean ended;
        private int audioBytes;

        private Stream(WebSocketSession session) {
            browser = new ConcurrentWebSocketSessionDecorator(session, 5000, 512 * 1024);
        }

        private synchronized void scheduleTimeout(int seconds) {
            if (closed) {
                return;
            }
            if (timeout != null) {
                timeout.cancel(false);
            }
            timeout = timers.schedule(() -> close(TIMEOUT), seconds, TimeUnit.SECONDS);
        }

        private void authenticate(String message) {
            // Browser WebSocket cannot set auth headers. Read the token once in the first frame
            // and verify it before looking up configuration or opening a billable upstream stream.
            try {
                String token = json.readTree(message).path("token").asText();
                LoginInfo user = token.isBlank() ? null : jwtService.verifyJwt(token, LoginInfo.class);
                if (user == null || user.getUserId() == null) {
                    close(CloseStatus.POLICY_VIOLATION);
                    return;
                }
            } catch (Exception ignored) {
                close(CloseStatus.POLICY_VIOLATION);
                return;
            }
            if (!reserveProviderStream()) {
                return;
            }
            try {
                ByaiSystemConfig config = configs.getDcSystemConfig(VolcengineVoiceConfig.PARAM_CODE);
                if (config == null || config.getParamValue() == null) {
                    close(CloseStatus.SERVER_ERROR);
                    return;
                }
                Request request = VolcengineVoiceConfig.upstreamRequest(json.readTree(config.getParamValue()));
                openProvider(request);
            } catch (Exception ignored) {
                close(CloseStatus.SERVER_ERROR);
            }
        }

        private synchronized boolean reserveProviderStream() {
            if (closed) {
                return false;
            }
            if (authenticated) {
                close(CloseStatus.POLICY_VIOLATION);
                return false;
            }
            if (!capacity.tryAcquire()) {
                close(CloseStatus.SERVICE_OVERLOAD);
                return false;
            }
            authenticated = true;
            scheduleTimeout(10);
            return true;
        }

        private synchronized void openProvider(Request request) {
            if (!closed) {
                provider = upstream.newWebSocket(request, this);
            }
        }

        private synchronized void forward(ByteBuffer payload) {
            if (closed) {
                return;
            }
            ByteBuffer frame = payload.slice();
            if (!ready || ended || !acceptFrame(frame)) {
                close(CloseStatus.POLICY_VIOLATION);
            } else if (!provider.send(ByteString.of(frame))) {
                close(CloseStatus.SERVER_ERROR);
            } else if (ended) {
                scheduleTimeout(8);
            }
        }

        private boolean acceptFrame(ByteBuffer frame) {
            if (frame.remaining() < 8 || frame.remaining() > MAX_FRAME_BYTES || frame.get(0) != 0x11
                || frame.get(3) != 0 || frame.getInt(4) != frame.remaining() - 8) {
                return false;
            }
            int type = frame.get(1);
            int bodySize = frame.remaining() - 8;
            if (frame.get(2) != 0 || (type != 0x20 && type != 0x22) || bodySize % 2 != 0
                || (type == 0x20 && bodySize == 0)) {
                return false;
            }
            ended = type == 0x22;
            audioBytes += bodySize;
            return audioBytes <= MAX_AUDIO_BYTES;
        }

        @Override
        public synchronized void onOpen(WebSocket socket, Response response) {
            if (closed) {
                socket.cancel();
                return;
            }
            String requestId = socket.request().header("X-Api-Request-Id");
            if (!socket.send(VolcengineVoiceConfig.initialFrame(requestId))) {
                close(CloseStatus.SERVER_ERROR);
                return;
            }
            ready = true;
            scheduleTimeout(75);
            try {
                browser.sendMessage(new TextMessage("{\"ready\":true}"));
            } catch (IOException e) {
                close(CloseStatus.SERVER_ERROR);
            }
        }

        @Override
        public synchronized void onMessage(WebSocket socket, ByteString bytes) {
            if (closed) {
                return;
            }
            try {
                browser.sendMessage(new BinaryMessage(bytes.asByteBuffer()));
            } catch (IOException e) {
                close(CloseStatus.SERVER_ERROR);
            }
        }

        @Override
        public void onClosing(WebSocket socket, int code, String reason) {
            close(CloseStatus.NORMAL);
        }

        @Override
        public void onFailure(WebSocket socket, Throwable error, Response response) {
            if (response != null && response.body() != null) {
                response.close();
            }
            close(CloseStatus.SERVER_ERROR);
        }

        private synchronized void close(CloseStatus status) {
            if (closed) {
                return;
            }
            closed = true;
            streams.remove(browser.getId(), this);
            if (authenticated) {
                capacity.release();
            }
            if (timeout != null) {
                timeout.cancel(false);
            }
            if (provider != null) {
                provider.cancel();
            }
            try {
                if (browser.isOpen()) {
                    browser.close(status);
                }
            } catch (IOException ignored) {
                // The transport may already have closed.
            }
        }
    }
}
