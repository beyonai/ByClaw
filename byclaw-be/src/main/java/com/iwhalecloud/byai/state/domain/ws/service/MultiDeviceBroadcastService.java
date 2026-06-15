package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.Set;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.Channel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import lombok.extern.slf4j.Slf4j;

/**
 * 多端广播服务：将消息事件推送到同一用户的所有 WebSocket Channel（排除发送端）。
 * 用于实现多设备同时在线时的消息实时同步。
 */
@Slf4j
@Service
public class MultiDeviceBroadcastService {

    @Autowired
    private ChannelManager channelManager;

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
        if (userId == null) {
            return;
        }

        Set<Channel> channels = channelManager.getChannels(userId);
        if (channels.isEmpty()) {
            return;
        }

        JSONObject message = new JSONObject();
        message.put("type", "SESSION_EVENT");
        message.put("sessionId", String.valueOf(sessionId));
        message.put("event", eventType);
        message.put("data", data);

        String frameText = message.toJSONString();

        for (Channel channel : channels) {
            if (channel.equals(senderChannel)) {
                continue;
            }
            if (!channel.isActive()) {
                log.debug("跳过非活跃 Channel, userId: {}", userId);
                continue;
            }
            try {
                channel.writeAndFlush(new TextWebSocketFrame(frameText));
            } catch (Exception e) {
                log.warn("多端广播写入失败, userId: {}, sessionId: {}, eventType: {}",
                    userId, sessionId, eventType, e);
            }
        }
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
        if (userId == null) {
            return;
        }

        Set<Channel> channels = channelManager.getChannels(userId);
        if (channels.isEmpty()) {
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

        String frameText = message.toJSONString();

        for (Channel channel : channels) {
            if (channel.equals(senderChannel)) {
                continue;
            }
            if (!channel.isActive()) {
                continue;
            }
            try {
                channel.writeAndFlush(new TextWebSocketFrame(frameText));
            } catch (Exception e) {
                log.warn("多端广播原始事件写入失败, userId: {}, sessionId: {}, eventType: {}",
                    userId, sessionId, eventType, e);
            }
        }
    }

    /**
     * 向指定用户的所有在线 WebSocket 通道推送原始 JSON 消息。
     * 用于生态采集 Browser Bridge 任务下发，普通聊天端收到未知 type 后会自然忽略。
     *
     * @param userId 用户ID
     * @param message 原始消息
     * @return 成功写入的通道数量
     */
    public int broadcastRawToUser(Long userId, JSONObject message) {
        if (userId == null || message == null) {
            return 0;
        }

        Set<Channel> channels = channelManager.getChannels(userId);
        if (channels.isEmpty()) {
            return 0;
        }

        String frameText = message.toJSONString();
        int sentCount = 0;
        for (Channel channel : channels) {
            if (!channel.isActive()) {
                continue;
            }
            try {
                channel.writeAndFlush(new TextWebSocketFrame(frameText));
                sentCount++;
            }
            catch (Exception e) {
                log.warn("原始 WebSocket 消息推送失败, userId: {}, messageType: {}",
                    userId, message.getString("type"), e);
            }
        }
        return sentCount;
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
