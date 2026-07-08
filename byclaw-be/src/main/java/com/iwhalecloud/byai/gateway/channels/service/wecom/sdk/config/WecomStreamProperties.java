package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * WeCom long-connection stream config. Mirrors {@code dingtalk.stream} but adds
 * connection tuning knobs the local {@code WecomWsClient} needs (DingTalk hides
 * these inside the official SDK).
 *
 * <p>Disabled by default (plan §10 migration): set {@code channel.stream.enabled=true}.
 */
@ConfigurationProperties(prefix = "channel.stream")
@Data
public class WecomStreamProperties {

    /** Master switch; off by default until a dev env validates one bot. */
    private boolean enabled;

    /** WebSocket endpoint; defaults to the official long-connection URL. */
    private String wsUrl = "wss://openws.work.weixin.qq.com";

    /** App-level {@code ping} heartbeat interval (ms). */
    private long heartbeatIntervalMs = 30_000L;

    /** Network reconnect cap; -1 = unlimited. */
    private int maxReconnectAttempts = 10;

    /** Whether WeCom stream replies should show reasoningLog* content before the answer. */
    private boolean showReasoning;

    /** Auth-failure reconnect cap; -1 = unlimited. */
    private int maxAuthFailureAttempts = 5;

    /** Exponential backoff base delay (ms); capped at 30s inside the client. */
    private long reconnectBaseDelayMs = 1_000L;

    /** WeCom contact API settings used for user-detail lookup and auto-binding. */
    private Contact contact = new Contact();

    @Data
    public static class Contact {

        /** Enterprise CorpID for WeCom REST APIs. */
        private String corpId;

        /** Contact/self-built-app secret used to fetch REST access_token. */
        private String corpSecret;

        /** Token endpoint; configurable for tests or gateways. */
        private String tokenUrl = "https://qyapi.weixin.qq.com/cgi-bin/gettoken";

        /** Read-member endpoint; configurable for tests or gateways. */
        private String userGetUrl = "https://qyapi.weixin.qq.com/cgi-bin/user/get";

    }
}
