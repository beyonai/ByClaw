package com.iwhalecloud.byai.state.domain.ws.manager;

import com.iwhalecloud.byai.state.domain.chat.service.ChatChainLog;

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
        }
        catch (Exception e) {
            wrapper.put("data", content);
        }
        return wrapper.toJSONString();
    }
}
