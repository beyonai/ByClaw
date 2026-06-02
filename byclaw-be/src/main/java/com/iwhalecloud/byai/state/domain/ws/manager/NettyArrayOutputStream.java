package com.iwhalecloud.byai.state.domain.ws.manager;

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

    public NettyArrayOutputStream(ChannelHandlerContext ctx) {
        this(ctx, null, null);
    }

    public NettyArrayOutputStream(ChannelHandlerContext ctx, String clientRequestId, String wrapperType) {
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
        if (ctx.channel().isActive()) {
            ctx.writeAndFlush(new TextWebSocketFrame(wrapContent(content)));
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
