package com.iwhalecloud.byai.gateway.sandbox.service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Component;

/**
 * Maps each runtime family's busy snapshots to activity on that exact sandbox type.
 */
@Component
@ConditionalOnProperty(prefix = "sandbox.running-state", name = "enabled", havingValue = "true",
    matchIfMissing = true)
public class RunningStateRedisSubscriber implements MessageListener {

    private static final Logger LOGGER = LoggerFactory.getLogger(RunningStateRedisSubscriber.class);
    static final String DEFAULT_TOPIC = "byai_gateway:registry:worker:stats:openclaw";
    static final String DEFAULT_DSH_TOPIC = "byai_gateway:registry:worker:stats:dsh";

    private static final String SCHEMA = "openclaw.busy_state.redis_stats";
    private static final String DSH_SCHEMA = "byclaw_dsh.busy_state.redis_stats";
    private static final int SCHEMA_VERSION = 1;
    private static final String PAYLOAD_MARKER = "openclaw-busy-state";
    private static final String DSH_PAYLOAD_MARKER = "byclaw-dsh-busy-state";
    private static final int PAYLOAD_VERSION = 1;
    private static final String SNAPSHOT_EVENT = "snapshot";

    private final RedisMessageListenerContainer listenerContainer;
    private final SandboxService sandboxService;
    private final ObjectMapper objectMapper;
    private final String topicName;
    private ChannelTopic topic;
    private ChannelTopic dshTopic;

    @Value("${sandbox.running-state.dsh-topic:" + DEFAULT_DSH_TOPIC + "}")
    private String dshTopicName = DEFAULT_DSH_TOPIC;

    /** Four missed 30-second snapshots expire a DSH busy signal; delayed messages must not keep an idle sandbox alive. */
    @Value("${sandbox.running-state.dsh-max-age-seconds:120}")
    private long dshMaxAgeSeconds = 120L;

    public RunningStateRedisSubscriber(RedisMessageListenerContainer listenerContainer,
                                       SandboxService sandboxService,
                                       ObjectMapper objectMapper,
                                       @Value("${sandbox.running-state.topic:" + DEFAULT_TOPIC + "}")
                                       String topicName) {
        this.listenerContainer = listenerContainer;
        this.sandboxService = sandboxService;
        this.objectMapper = objectMapper;
        this.topicName = StringUtils.defaultIfBlank(topicName, DEFAULT_TOPIC);
    }

    @PostConstruct
    public void start() {
        if (dshMaxAgeSeconds <= 0) {
            throw new IllegalArgumentException("sandbox.running-state.dsh-max-age-seconds must be greater than zero");
        }
        topic = new ChannelTopic(topicName);
        listenerContainer.addMessageListener(this, topic);
        LOGGER.info("已订阅 running-state Redis topic：{}", topicName);
        String resolvedDshTopic = StringUtils.defaultIfBlank(dshTopicName, DEFAULT_DSH_TOPIC);
        if (!topicName.equals(resolvedDshTopic)) {
            dshTopic = new ChannelTopic(resolvedDshTopic);
            listenerContainer.addMessageListener(this, dshTopic);
            LOGGER.info("已订阅 DSH running-state Redis topic：{}", resolvedDshTopic);
        }
    }

    @PreDestroy
    public void stop() {
        if (topic != null) {
            listenerContainer.removeMessageListener(this, topic);
        }
        if (dshTopic != null) {
            listenerContainer.removeMessageListener(this, dshTopic);
        }
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        if (message == null || message.getBody() == null) {
            return;
        }
        handleMessage(new String(message.getBody(), StandardCharsets.UTF_8));
    }

    boolean handleMessage(String rawMessage) {
        if (StringUtils.isBlank(rawMessage)) {
            return false;
        }
        try {
            JsonNode root = objectMapper.readTree(rawMessage);
            if (!isSupportedEnvelope(root)) {
                return false;
            }
            boolean dsh = DSH_SCHEMA.equals(text(root, "schema"));
            JsonNode payload = root.path("payload");
            if (!isSupportedPayload(payload, dsh) || !payload.path("busy").asBoolean(false)) {
                return false;
            }

            String agentType = text(root, "agentType");
            WorkerAgentType expectedAgent = dsh ? WorkerAgentType.BYCLAW_DSH : WorkerAgentType.BYCLAW_EXE;
            if (!isAgentType(agentType, expectedAgent)) {
                return false;
            }
            if (dsh && (!payload.path("busy").isBoolean() || !isFreshDshSnapshot(root, payload))) {
                return false;
            }
            String userCode = text(root, "userCode");
            if (StringUtils.isBlank(userCode)) {
                LOGGER.warn("running-state 心跳忽略：userCode 为空，agentType={}", agentType);
                return false;
            }
            boolean updated = dsh ? sandboxService.heartbeatDshSandbox(userCode)
                : sandboxService.heartbeatOpenclawSandbox(userCode);
            if (!updated) {
                LOGGER.warn("running-state busy 心跳未刷新到对应类型沙箱，userCode={}，agentType={}",
                    userCode, agentType);
            }
            return updated;
        }
        catch (Exception e) {
            LOGGER.warn("running-state Redis 消息解析失败：{}", e.getMessage());
            return false;
        }
    }

    private boolean isSupportedEnvelope(JsonNode root) {
        return root != null
            && (SCHEMA.equals(text(root, "schema")) || DSH_SCHEMA.equals(text(root, "schema")))
            && root.path("schemaVersion").asInt(-1) == SCHEMA_VERSION;
    }

    private boolean isSupportedPayload(JsonNode payload, boolean dsh) {
        return payload != null
            && (dsh ? DSH_PAYLOAD_MARKER : PAYLOAD_MARKER).equals(text(payload, "marker"))
            && payload.path("version").asInt(-1) == PAYLOAD_VERSION
            && SNAPSHOT_EVENT.equals(text(payload, "event"));
    }

    private boolean isAgentType(String agentType, WorkerAgentType expectedAgent) {
        String code = expectedAgent.getCode();
        return code.equals(agentType) || StringUtils.startsWith(agentType, code + "_");
    }

    private boolean isFreshDshSnapshot(JsonNode root, JsonNode payload) {
        String emittedAt = text(root, "emittedAt");
        String generatedAt = text(payload, "generatedAt");
        if (emittedAt == null || generatedAt == null) {
            return false;
        }
        Instant now = Instant.now();
        Instant oldest = now.minusSeconds(dshMaxAgeSeconds);
        Instant newest = now.plusSeconds(30);
        Instant emitted = Instant.parse(emittedAt);
        Instant generated = Instant.parse(generatedAt);
        return !emitted.isBefore(oldest) && !generated.isBefore(oldest)
            && !emitted.isAfter(newest) && !generated.isAfter(newest);
    }

    private String text(JsonNode node, String fieldName) {
        JsonNode value = node != null ? node.get(fieldName) : null;
        if (value == null || value.isNull()) {
            return null;
        }
        return StringUtils.trimToNull(value.asText());
    }
}
