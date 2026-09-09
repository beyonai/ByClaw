package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.Channel;
import io.netty.buffer.ByteBufUtil;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.util.AttributeKey;
import io.netty.util.ReferenceCountUtil;
import lombok.extern.slf4j.Slf4j;

/**
 * 多端广播服务：将消息事件推送到同一用户的所有 WebSocket Channel（排除发送端）。
 * 用于实现多设备同时在线时的消息实时同步。
 */
@Slf4j
@Service
public class MultiDeviceBroadcastService {

    private static final AttributeKey<ScopedOutboundState> SCOPED_OUTBOUND =
        AttributeKey.valueOf(MultiDeviceBroadcastService.class, "scoped-outbound");

    @Autowired
    private ChannelManager channelManager;

    @Value("${byclaw.scoped-message.websocket-max-pending-contexts:64}")
    private int scopedMaxPendingContexts = 64;

    @Value("${byclaw.scoped-message.websocket-max-retained-bytes:67108864}")
    private long scopedMaxRetainedBytes = 64L * 1024 * 1024;

    @Value("${byclaw.scoped-message.websocket-max-frame-bytes:8388608}")
    private long scopedMaxFrameBytes = 8L * 1024 * 1024;

    @Value("${byclaw.scoped-message.websocket-write-timeout-millis:5000}")
    private long scopedWriteTimeoutMillis = 5000;

    public void broadcastScopedProjection(Long userId, String contextKey, JSONObject message, boolean terminal) {
        if (userId == null || contextKey == null || message == null) {
            return;
        }
        Set<Channel> channels = channelManager.getChannels(userId);
        if (channels.isEmpty()) {
            return;
        }
        String text = message.toJSONString();
        JSONObject data = message.getJSONObject("data");
        ProjectionKey key = new ProjectionKey(contextKey, data == null ? null : data.getString("messageId"));
        ScopedFrame frame = new ScopedFrame(key, text, ByteBufUtil.utf8Bytes(text), terminal);
        for (Channel channel : channels) {
            if (!channel.isActive()) {
                continue;
            }
            ScopedOutboundState state = channel.attr(SCOPED_OUTBOUND).get();
            if (state == null) {
                ScopedOutboundState candidate = new ScopedOutboundState(channel, userId);
                ScopedOutboundState existing = channel.attr(SCOPED_OUTBOUND).setIfAbsent(candidate);
                state = existing == null ? candidate : existing;
                if (existing == null) {
                    channel.closeFuture().addListener(ignored -> candidate.discard());
                }
            }
            state.enqueue(frame);
        }
    }

    private record ProjectionKey(String contextKey, String messageId) {
    }

    private record ScopedFrame(ProjectionKey key, String text, long bytes, boolean terminal) {
    }

    /** One actual transport write per channel; pending values are complete, replaceable snapshots. */
    private final class ScopedOutboundState {
        private final Channel channel;
        private final Long userId;
        private final Map<ProjectionKey, ScopedFrame> pending = new LinkedHashMap<>();
        private long retainedBytes;
        private long inFlightBytes;
        private long generation;
        private boolean writing;
        private boolean closed;
        private ScheduledFuture<?> timeout;

        private ScopedOutboundState(Channel channel, Long userId) {
            this.channel = channel;
            this.userId = userId;
        }

        void enqueue(ScopedFrame frame) {
            ScopedFrame next = null;
            String failure = null;
            synchronized (this) {
                if (closed || !channel.isActive()) {
                    return;
                }
                ScopedFrame previous = pending.get(frame.key());
                if (previous != null && previous.terminal() && !frame.terminal()) {
                    return;
                }
                long bytes = retainedBytes - (previous == null ? 0 : previous.bytes()) + frame.bytes();
                if (frame.bytes() > scopedMaxFrameBytes || bytes > scopedMaxRetainedBytes
                    || (writing && previous == null && pending.size() >= scopedMaxPendingContexts)) {
                    failure = "outbound snapshot limit";
                    discard();
                }
                else {
                    pending.put(frame.key(), frame);
                    retainedBytes = bytes;
                    if (!writing) {
                        next = takeNext();
                    }
                }
            }
            if (failure != null) {
                disconnect(failure);
            }
            else if (next != null) {
                write(next);
            }
        }

        private ScopedFrame takeNext() {
            var iterator = pending.values().iterator();
            if (!iterator.hasNext()) {
                return null;
            }
            ScopedFrame next = iterator.next();
            iterator.remove();
            writing = true;
            inFlightBytes = next.bytes();
            generation++;
            return next;
        }

        private void write(ScopedFrame frame) {
            long writeGeneration;
            synchronized (this) {
                if (closed) {
                    return;
                }
                writeGeneration = generation;
            }
            TextWebSocketFrame transportFrame = null;
            try {
                synchronized (this) {
                    if (closed) {
                        return;
                    }
                    timeout = channel.eventLoop().schedule(() -> expire(writeGeneration),
                        Math.max(1, scopedWriteTimeoutMillis), TimeUnit.MILLISECONDS);
                }
                transportFrame = new TextWebSocketFrame(frame.text());
                channel.writeAndFlush(transportFrame).addListener(result -> complete(writeGeneration, result.isSuccess()));
            }
            catch (Exception failure) {
                ReferenceCountUtil.safeRelease(transportFrame);
                complete(writeGeneration, false);
            }
        }

        private void complete(long writeGeneration, boolean success) {
            ScopedFrame next = null;
            synchronized (this) {
                if (closed || generation != writeGeneration) {
                    return;
                }
                if (timeout != null) {
                    timeout.cancel(false);
                    timeout = null;
                }
                retainedBytes -= inFlightBytes;
                inFlightBytes = 0;
                writing = false;
                if (success) {
                    next = takeNext();
                }
                else {
                    discard();
                }
            }
            if (!success) {
                disconnect("outbound write failed");
            }
            else if (next != null) {
                write(next);
            }
        }

        private void expire(long writeGeneration) {
            synchronized (this) {
                if (closed || generation != writeGeneration || !writing) {
                    return;
                }
                discard();
            }
            disconnect("outbound write timed out");
        }

        private synchronized void discard() {
            closed = true;
            pending.clear();
            retainedBytes = 0;
            inFlightBytes = 0;
            if (timeout != null) {
                timeout.cancel(false);
                timeout = null;
            }
        }

        private void disconnect(String reason) {
            // A failed/slow connection must reconnect and recover durable snapshots; never report a terminal as sent.
            log.warn("Closing scoped projection WebSocket; reconnect and restore session snapshots, userId: {}, channel: {}, reason: {}",
                userId, channel.id(), reason);
            channel.close();
        }
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
     * 用于服务端主动下发会话事件，普通聊天端收到未知 type 后会自然忽略。
     *
     * @param userId 用户ID
     * @param message 原始消息
     * @return 成功写入的通道数量
     */
    public int broadcastRawToUser(Long userId, JSONObject message, Channel senderChannel) {
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
                    userId, message.getString("type"), e);
            }
        }
        return sentCount;
    }
}
