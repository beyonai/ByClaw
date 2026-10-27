package com.iwhalecloud.byai.state.domain.ws.manager;

import com.iwhalecloud.byai.state.domain.chat.service.ChatChainLog;
import com.iwhalecloud.byai.state.domain.chat.service.ChatReplyLog;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import org.apache.commons.lang3.StringUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

public class NettyArrayOutputStream extends ByteArrayOutputStream {
    private final ChannelHandlerContext ctx;

    private final String clientRequestId;

    private final String wrapperType;
    private final String requestId;
    private final java.util.Map<String, JSONObject> replyIdentities = new java.util.concurrent.ConcurrentHashMap<>();

    public void registerReply(String traceId, String messageId, JSONObject envelope) {
        if (traceId != null && !traceId.isBlank() && (replyIdentities.size() < 256 || replyIdentities.containsKey("trace:" + traceId))) replyIdentities.put("trace:" + traceId, new JSONObject(envelope));
        if (messageId != null && !messageId.isBlank() && (replyIdentities.size() < 256 || replyIdentities.containsKey("message:" + messageId))) replyIdentities.put("message:" + messageId, new JSONObject(envelope));
    }

    public NettyArrayOutputStream(ChannelHandlerContext ctx) {
        this(ctx, null, null);
    }

    public NettyArrayOutputStream(ChannelHandlerContext ctx, String clientRequestId, String wrapperType) {
        this(ctx, clientRequestId, wrapperType, clientRequestId);
    }

    public NettyArrayOutputStream(ChannelHandlerContext ctx, String clientRequestId, String wrapperType, String requestId) {
        this.requestId = requestId;
        this.ctx = ctx;
        this.clientRequestId = clientRequestId;
        this.wrapperType = wrapperType;
    }

    @Override
    public void write(byte[] b, int off, int len) {
        super.write(b, off, len);
        // 获取新写入的数据
        byte[] newData = new byte[len];
        System.arraycopy(b, off, newData, 0, len);

        // 将数据转换为字符串
        String content = new String(newData, StandardCharsets.UTF_8);
        // 通过 WebSocket 发送数据
        String frameText = wrapContent(content);
        JSONObject terminal = ChatChainLog.terminalFrame(frameText);
        long started = System.nanoTime();
        if (ctx.channel().isActive()) {
            if (terminal != null && ChatReplyLog.envelope(terminal) != null) ChatReplyLog.log("be.ws_write", terminal, null, "running", "channelId", ctx.channel().id().asShortText());
            ChatChainLog.wsWritten(ctx.writeAndFlush(new TextWebSocketFrame(frameText)), terminal, started);
        } else {
            ChatChainLog.wsUnavailable(ctx.channel(), terminal);
        }
    }

    @Override
    public void flush() throws IOException {
        super.flush();
        // 发送完整消息时的处理（如果需要）
    }

    private String wrapContent(String content) {
        if (StringUtils.isBlank(clientRequestId) || StringUtils.isBlank(wrapperType)) {
            return content;
        }
        JSONObject wrapper = new JSONObject();
        wrapper.put("type", wrapperType);
        wrapper.put("clientRequestId", clientRequestId);
        wrapper.put("requestId", requestId);
        String enterpriseId = ctx.channel().attr(Constant.ATT_ENTERPRISE_ID).get();
        if (StringUtils.isNotBlank(enterpriseId)) {
            wrapper.put("enterpriseId", enterpriseId);
        }

        try {
            JSONObject payload = JSON.parseObject(content);
            String event = payload.getString("event");
            Object sessionId = payload.get("sessionId");
            if (StringUtils.isNotBlank(event)) {
                wrapper.put("event", event);
            }
            if (sessionId != null) {
                wrapper.put("sessionId", String.valueOf(sessionId));
            }
            wrapper.put("data", payload);
            JSONObject details = ChatReplyLog.object(payload.get("data"));
            String trace = payload.getString("traceId");
            if (trace == null && details != null) trace = details.getString("traceId");
            String messageId = payload.getString("messageId");
            if (messageId == null && details != null) messageId = details.getString("messageId");
            JSONObject chain = ChatReplyLog.envelope(payload);
            if (chain == null && messageId != null) chain = replyIdentities.get("message:" + messageId);
            if (chain == null && trace != null) chain = replyIdentities.get("trace:" + trace);
            if (chain == null && trace == null && messageId == null && !replyIdentities.isEmpty()) {
                JSONObject candidate = replyIdentities.values().iterator().next();
                boolean oneOwner = replyIdentities.values().stream().allMatch(value ->
                    java.util.Objects.equals(value.getString("targetTraceId"), candidate.getString("targetTraceId")));
                if (oneOwner) chain = candidate;
            }
            if (chain != null) {
                chain = new JSONObject(chain);
                chain.put("frameId", java.util.UUID.randomUUID().toString());
                chain.put("frameClientRequestId", clientRequestId);
                chain.put("targetTenantId", enterpriseId == null ? "" : enterpriseId);
                if (sessionId != null) chain.put("targetSessionId", String.valueOf(sessionId));
                if (messageId != null) chain.put("targetMessageId", messageId);
                if (trace != null) chain.put("targetTraceId", trace);
                wrapper.put("chatChain", chain);
            }
        }
        catch (Exception e) {
            wrapper.put("data", content);
        }
        return wrapper.toJSONString();
    }
}
