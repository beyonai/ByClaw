package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config.WecomStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomRobotChannelConfig;
import jakarta.annotation.PreDestroy;
import okhttp3.OkHttpClient;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/**
 * Builds {@link WecomWsClient} instances for a robot config. Owns a shared
 * OkHttpClient tuned for long-lived WebSocket connections (no read timeout so
 * an idle-but-alive socket is not torn down; the app-level heartbeat detects
 * dead peers instead).
 */
@Component
public class WecomWsClientFactory {

    private final WecomStreamProperties properties;
    private final ObjectMapper objectMapper;
    private final OkHttpClient wsHttpClient;

    public WecomWsClientFactory(WecomStreamProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
        this.wsHttpClient = new OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                // No read timeout: the WeCom long connection is idle between
                // pushes; liveness is enforced by the app-level ping heartbeat,
                // not by socket read timeout. pingInterval is intentionally NOT
                // set here — WeCom's heartbeat is a JSON {"cmd":"ping"} frame,
                // not an OkHttp control-frame ping.
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .build();
    }

    public WecomWsClient create(WecomRobotChannelConfig config, WecomWsClientListener listener) {
        return new WecomWsClient(
                config.getBotId(),
                config.getSecret(),
                properties.getWsUrl(),
                properties.getHeartbeatIntervalMs(),
                properties.getMaxReconnectAttempts(),
                properties.getMaxAuthFailureAttempts(),
                properties.getReconnectBaseDelayMs(),
                wsHttpClient,
                objectMapper,
                listener);
    }

    /** Release the shared OkHttp dispatcher/pool on shutdown. */
    @PreDestroy
    public void shutdown() {
        wsHttpClient.dispatcher().executorService().shutdown();
        wsHttpClient.connectionPool().evictAll();
    }
}
