package com.iwhalecloud.byai.state.infrastructure.utils;

import io.netty.buffer.ByteBuf;
import io.netty.buffer.Unpooled;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.DefaultFullHttpResponse;
import io.netty.handler.codec.http.FullHttpResponse;
import io.netty.handler.codec.http.HttpHeaderNames;
import io.netty.handler.codec.http.HttpResponseStatus;
import io.netty.handler.codec.http.HttpVersion;
import io.netty.util.CharsetUtil;

public class NettyResponse {
    public static void sendSuccessResponse(ChannelHandlerContext ctx) {
        String response = "{\"success\":true}";
        ByteBuf content = Unpooled.copiedBuffer(response, CharsetUtil.UTF_8);
        sendResponse(ctx, HttpResponseStatus.OK, content);
    }

    public static void sendErrorResponse(ChannelHandlerContext ctx, String message) {
        String response = "{\"success\":false,\"message\":\"" + message + "\"}";
        ByteBuf content = Unpooled.copiedBuffer(response, CharsetUtil.UTF_8);
        sendResponse(ctx, HttpResponseStatus.INTERNAL_SERVER_ERROR, content);
    }

    public static void sendNotFoundResponse(ChannelHandlerContext ctx) {
        sendResponse(ctx, HttpResponseStatus.NOT_FOUND, Unpooled.EMPTY_BUFFER);
    }

    public static void sendResponse(ChannelHandlerContext ctx, HttpResponseStatus status, ByteBuf content) {
        FullHttpResponse response = new DefaultFullHttpResponse(HttpVersion.HTTP_1_1, status, content);
        response.headers().set(HttpHeaderNames.CONTENT_TYPE, "application/json").set(HttpHeaderNames.CONTENT_LENGTH,
                content.readableBytes());

        PushUtil.sendMessageToChannel(ctx.channel(), response);
    }
}
