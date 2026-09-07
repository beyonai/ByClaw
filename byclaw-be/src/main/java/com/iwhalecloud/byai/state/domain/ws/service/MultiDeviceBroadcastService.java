package com.iwhalecloud.byai.state.domain.ws.service;

import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.ChannelTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import lombok.extern.slf4j.Slf4j;

/**
 * 多端广播服务：将消息事件推送到同一用户的所有 WebSocket Channel（排除发送端）。
 * 本实例先完成本地推送，再通过 Redis Pub/Sub 通知其他后端实例完成各自的本地推送。
 */
@Slf4j
@Service
public class MultiDeviceBroadcastService implements MessageListener {

    static final String DEFAULT_PUBSUB_TOPIC = "byai:pub:websocket_user_broadcast";

    static final int ENVELOPE_SCHEMA_VERSION = 1;

    @Autowired
    private ChannelManager channelManager;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    @Qualifier("webSocketBroadcastListenerContainer")
    private RedisMessageListenerContainer listenerContainer;

    @Value("${byai.websocket.broadcast.pubsub-topic:" + DEFAULT_PUBSUB_TOPIC + "}")
    private String pubsubTopicName = DEFAULT_PUBSUB_TOPIC;

    private final String sourceInstanceId = UUID.randomUUID().toString();

    private ChannelTopic pubsubTopic;

    @PostConstruct
    public void subscribe() {
        pubsubTopicName = StringUtils.defaultIfBlank(pubsubTopicName, DEFAULT_PUBSUB_TOPIC);
        pubsubTopic = new ChannelTopic(pubsubTopicName);
        listenerContainer.addMessageListener(this, pubsubTopic);
        log.info("已订阅跨实例 WebSocket 广播 Redis topic: {}", pubsubTopicName);
    }

    @PreDestroy
    public void unsubscribe() {
        if (pubsubTopic != null) {
            listenerContainer.removeMessageListener(this, pubsubTopic);
        }
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        if (message == null || message.getBody() == null) {
            return;
        }
        handleRemoteBroadcast(new String(message.getBody(), StandardCharsets.UTF_8));
    }

    /**
     * 向用户的所有其他设备广播事件
     *
     * @param userId        用户ID
     * @param sessionId     会话ID
     * @param eventType     事件类型（如 initialization、answerDelta、appStreamResponse 等）
     * @param data          事件数据（JSON字符串）
     * @param senderChannel 发送端的 Channel（将被排除），HTTP SSE 场景传 null 则广播到所有 Channel
     */
    public void broadcastToUserDevices(Long userId, Long sessionId, String eventType,
                                       String data, Channel senderChannel) {
        broadcastToUserDevices(userId, sessionId, eventType, data, senderChannel, null);
    }

    public void broadcastToUserDevices(Long userId, Long sessionId, String eventType,
                                       String data, Channel senderChannel, String clientRequestId) {
        if (userId == null) {
            return;
        }

        JSONObject message = new JSONObject();
        message.put("type", "CHAT_STREAM");
        message.put("clientRequestId", clientRequestId);
        message.put("sessionId", String.valueOf(sessionId));
        message.put("event", eventType);
        message.put("data", data);

        broadcastFrame(userId, message.toJSONString(), senderChannel, eventType);
    }

    /**
     * 向用户的所有其他设备广播原始 JSON 事件（用于 Redis Stream 事件的透传）
     *
     * @param userId        用户ID
     * @param sessionId     会话ID
     * @param dataJson      原始事件 JSON
     * @param senderChannel 发送端的 Channel
     */
    public void broadcastRawEvent(Long userId, Long sessionId, JSONObject dataJson,
                                  Channel senderChannel) {
        broadcastRawEvent(userId, sessionId, dataJson, senderChannel, null);
    }

    public void broadcastRawEvent(Long userId, Long sessionId, JSONObject dataJson,
                                  Channel senderChannel, String clientRequestId) {
        if (userId == null || dataJson == null) {
            return;
        }

        String eventType = dataJson.getString("event_type");
        String eventData = dataJson.getString("data");

        JSONObject message = new JSONObject();
        message.put("type", "CHAT_STREAM");
        message.put("clientRequestId", clientRequestId);
        message.put("sessionId", String.valueOf(sessionId));
        message.put("event", eventType);
        message.put("data", eventData);
        message.put("traceId", dataJson.getString("trace_id"));
        message.put("streamId", dataJson.getString("stream_id"));

        JSONObject metadata = dataJson.getJSONObject("metadata");
        if (metadata != null) {
            message.put("metadata", metadata);
        }

        broadcastFrame(userId, message.toJSONString(), senderChannel, eventType);
    }

    /**
     * 向指定用户的所有在线 WebSocket 通道推送原始 JSON 消息。
     *
     * @param userId 用户ID
     * @param message 原始消息
     * @return 当前实例成功写入的通道数量（远端实例通过 Redis 异步发送，不计入返回值）
     */
    public int broadcastRawToUser(Long userId, JSONObject message) {
        return broadcastRawToUser(userId, message, null);
    }

    /**
     * 向指定用户的所有在线 WebSocket 通道推送原始 JSON 消息，并排除发送端。
     */
    public int broadcastRawToUser(Long userId, JSONObject message, Channel senderChannel) {
        if (userId == null || message == null) {
            return 0;
        }
        String frameText = message.toJSONString();
        String messageType = message.getString("type");
        int sentCount = broadcastLocally(userId, frameText, senderChannel, messageType);
        publish(userId, frameText, messageType);
        return sentCount;
    }

    /**
     * Redis 订阅回调的可测试入口。远端消息只能本地发送，不能再次发布，避免广播环路。
     */
    int handleRemoteBroadcast(String rawEnvelope) {
        if (StringUtils.isBlank(rawEnvelope)) {
            return 0;
        }
        try {
            JSONObject envelope = JSONObject.parseObject(rawEnvelope);
            if (envelope == null
                || envelope.getIntValue("schemaVersion") != ENVELOPE_SCHEMA_VERSION
                || StringUtils.isBlank(envelope.getString("sourceInstanceId"))) {
                return 0;
            }
            if (Objects.equals(sourceInstanceId, envelope.getString("sourceInstanceId"))) {
                return 0;
            }

            Long userId = envelope.getLong("userId");
            String frameText = envelope.getString("frameText");
            if (userId == null || StringUtils.isBlank(frameText)) {
                return 0;
            }
            return broadcastLocally(userId, frameText, null, envelope.getString("messageType"));
        }
        catch (Exception e) {
            log.warn("忽略无效的跨实例 WebSocket 广播消息: {}", e.getMessage());
            return 0;
        }
    }

    private void broadcastFrame(Long userId, String frameText, Channel senderChannel, String messageType) {
        broadcastLocally(userId, frameText, senderChannel, messageType);
        publish(userId, frameText, messageType);
    }

    private int broadcastLocally(Long userId, String frameText, Channel senderChannel, String messageType) {
        Set<Channel> channels = channelManager.getChannels(userId);
        int sentCount = 0;
        for (Channel channel : channels) {
            if (channel.equals(senderChannel)) {
                continue;
            }
            if (!channel.isActive()) {
                continue;
            }
            try {
                channel.writeAndFlush(new TextWebSocketFrame(frameText));
                sentCount++;
            }
            catch (Exception e) {
                log.warn("原始 WebSocket 消息推送失败, userId: {}, messageType: {}",
                    userId, messageType, e);
            }
        }
        return sentCount;
    }

    private void publish(Long userId, String frameText, String messageType) {
        JSONObject envelope = new JSONObject();
        envelope.put("schemaVersion", ENVELOPE_SCHEMA_VERSION);
        envelope.put("sourceInstanceId", sourceInstanceId);
        envelope.put("userId", userId);
        envelope.put("messageType", messageType);
        envelope.put("frameText", frameText);
        try {
            stringRedisTemplate.convertAndSend(pubsubTopicName, envelope.toJSONString());
        }
        catch (Exception e) {
            // 本机推送已经完成；Redis 暂时不可用不应反向影响当前实例上的客户端。
            log.warn("跨实例 WebSocket 广播发布失败, userId: {}, messageType: {}, error: {}",
                userId, messageType, e.getMessage());
        }
    }

    /**
     * 向指定用户的所有在线 WebSocket 通道推送消息，可按 session 限定。
     */
    public int broadcastRawToUser(Long userId, Long sessionId, JSONObject message) {
        if (message != null && sessionId != null) {
            message.put("sessionId", String.valueOf(sessionId));
        }
        return broadcastRawToUser(userId, message);
    }
}
