package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
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

    private static final String SCOPED_DELTA_VERSION = "scoped-delta-version";

    private static final Set<String> SCOPED_STATUS_METADATA_FIELDS = Set.of(
        "session_scope", "external_session_id", "external_root_session_id", "external_parent_session_id",
        "child_name", "child_role", "session_status", "event_source", "child_run_id", "child_turn");

    private final ScopedProjectionDeltaCodec deltaCodec = new ScopedProjectionDeltaCodec();

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
        JSONObject data = message.getJSONObject("data");
        String text = message.toJSONString();
        String scopedSessionId = data == null ? null : data.getString("sessionId");
        ProjectionKey key = new ProjectionKey(contextKey, data == null ? null : data.getString("messageId"));
        ScopedFrame frame = new ScopedFrame(key, message, text, ByteBufUtil.utf8Bytes(text), terminal,
            true, null, null);
        ScopedFrame statusFrame = scopedSessionId == null ? null : statusFrame(scopedSessionId, message, terminal);
        for (Channel channel : channels) {
            if (!channel.isActive()) {
                continue;
            }
            ScopedOutboundState state = channel.attr(SCOPED_OUTBOUND).get();
            if (state == null) {
                ScopedOutboundState candidate = new ScopedOutboundState(channel, userId, supportsScopedDelta(channel));
                ScopedOutboundState existing = channel.attr(SCOPED_OUTBOUND).setIfAbsent(candidate);
                state = existing == null ? candidate : existing;
                if (existing == null) {
                    channel.closeFuture().addListener(ignored -> candidate.discard());
                }
            }
            String selectedSessionId = channel.attr(Constant.ATT_SCOPED_SESSION_ID).get();
            state.updateSubscription(selectedSessionId);
            if (state.deltaEnabled && scopedSessionId != null && !scopedSessionId.equals(selectedSessionId)) {
                state.enqueue(statusFrame);
            }
            else {
                state.enqueue(frame);
            }
        }
    }

    private ScopedFrame statusFrame(String scopedSessionId, JSONObject message, boolean terminal) {
        JSONObject source = message.getJSONObject("data");
        JSONObject statusData = new JSONObject();
        statusData.put("sessionId", scopedSessionId);
        statusData.put("messageId", source.getString("messageId"));
        statusData.put("running", source.getBoolean("running"));
        statusData.put("msgStatus", source.get("msgStatus"));
        statusData.put("terminal", terminal);

        JSONObject sourceMetadata = parseMetadata(source.get("metadata"));
        if (sourceMetadata != null) {
            JSONObject statusMetadata = new JSONObject();
            for (String field : SCOPED_STATUS_METADATA_FIELDS) {
                if (sourceMetadata.containsKey(field)) {
                    statusMetadata.put(field, sourceMetadata.get(field));
                }
            }
            statusData.put("metadata", statusMetadata.toJSONString());
        }

        JSONObject status = new JSONObject();
        status.put("type", "SCOPED_SESSION_STATUS");
        status.put("sessionId", scopedSessionId);
        status.put("streamId", message.getString("streamId"));
        status.put("data", statusData);
        String text = status.toJSONString();
        String signature = statusData.toJSONString();
        return new ScopedFrame(new ProjectionKey("status:" + scopedSessionId, null), status, text,
            ByteBufUtil.utf8Bytes(text), terminal, false, scopedSessionId, signature);
    }

    private JSONObject parseMetadata(Object value) {
        if (value instanceof JSONObject metadata) {
            return metadata;
        }
        if (value instanceof String text && !text.isBlank()) {
            try {
                return JSONObject.parseObject(text);
            }
            catch (RuntimeException ignored) {
                return null;
            }
        }
        return null;
    }

    private record ProjectionKey(String contextKey, String messageId) {
    }

    private record ScopedFrame(ProjectionKey key, JSONObject message, String text, long bytes, boolean terminal,
                               boolean contentProjection, String statusSessionId, String statusSignature) {
    }

    private record OutboundWrite(ScopedFrame frame, String text) {
    }

    private boolean supportsScopedDelta(Channel channel) {
        Map<String, String> headers = channel.attr(Constant.ATT_HEADER).get();
        return headers != null && "1".equals(headers.get(SCOPED_DELTA_VERSION));
    }

    /** One actual transport write per channel; pending values are complete, replaceable snapshots. */
    private final class ScopedOutboundState {
        private final Channel channel;
        private final Long userId;
        private final boolean deltaEnabled;
        private final Map<ProjectionKey, ScopedFrame> pending = new LinkedHashMap<>();
        private final Map<ProjectionKey, JSONObject> delivered = new LinkedHashMap<>();
        private final Map<String, String> deliveredStatuses = new LinkedHashMap<>();
        private long retainedBytes;
        private long inFlightBytes;
        private long generation;
        private boolean writing;
        private boolean closed;
        private ScheduledFuture<?> timeout;
        private String activeScopedSessionId;

        private ScopedOutboundState(Channel channel, Long userId, boolean deltaEnabled) {
            this.channel = channel;
            this.userId = userId;
            this.deltaEnabled = deltaEnabled;
        }

        void enqueue(ScopedFrame frame) {
            ScopedFrame next = null;
            String failure = null;
            synchronized (this) {
                if (closed || !channel.isActive()) {
                    return;
                }
                if (!frame.contentProjection()
                    && frame.statusSignature().equals(deliveredStatuses.get(frame.statusSessionId()))) {
                    return;
                }
                ScopedFrame previous = pending.get(frame.key());
                if (previous != null && !frame.contentProjection()
                    && frame.statusSignature().equals(previous.statusSignature())) {
                    return;
                }
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

        synchronized void updateSubscription(String scopedSessionId) {
            if (!deltaEnabled || Objects.equals(activeScopedSessionId, scopedSessionId)) {
                return;
            }
            activeScopedSessionId = scopedSessionId;
            delivered.clear();
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
            OutboundWrite outbound;
            synchronized (this) {
                if (closed) {
                    return;
                }
                writeGeneration = generation;
                outbound = prepare(frame);
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
                transportFrame = new TextWebSocketFrame(outbound.text());
                channel.writeAndFlush(transportFrame)
                    .addListener(result -> complete(writeGeneration, result.isSuccess(), outbound.frame()));
            }
            catch (Exception failure) {
                ReferenceCountUtil.safeRelease(transportFrame);
                complete(writeGeneration, false, outbound.frame());
            }
        }

        private OutboundWrite prepare(ScopedFrame frame) {
            if (!deltaEnabled || !frame.contentProjection()) {
                return new OutboundWrite(frame, frame.text());
            }
            JSONObject previous = delivered.get(frame.key());
            JSONObject delta = deltaCodec.createDelta(previous, frame.message(), frame.terminal());
            if (delta == null) {
                return new OutboundWrite(frame, frame.text());
            }
            String deltaText = delta.toJSONString();
            return ByteBufUtil.utf8Bytes(deltaText) < frame.bytes()
                ? new OutboundWrite(frame, deltaText)
                : new OutboundWrite(frame, frame.text());
        }

        private void complete(long writeGeneration, boolean success, ScopedFrame completed) {
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
                    if (deltaEnabled && completed.contentProjection()) {
                        if (completed.terminal()) delivered.remove(completed.key());
                        else delivered.put(completed.key(), completed.message());
                    }
                    else if (!completed.contentProjection()) {
                        deliveredStatuses.put(completed.statusSessionId(), completed.statusSignature());
                    }
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
            delivered.clear();
            deliveredStatuses.clear();
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
