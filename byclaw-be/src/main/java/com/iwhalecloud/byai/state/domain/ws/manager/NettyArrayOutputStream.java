package com.iwhalecloud.byai.state.domain.ws.manager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

public class NettyArrayOutputStream extends ByteArrayOutputStream {
    private final ChannelHandlerContext ctx;
    public NettyArrayOutputStream(ChannelHandlerContext ctx) {
        this.ctx = ctx;
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
            ctx.writeAndFlush(new TextWebSocketFrame(content));
        }
    }

    @Override
    public void flush() throws IOException {
        super.flush();
        // 发送完整消息时的处理（如果需要）
    }
}
