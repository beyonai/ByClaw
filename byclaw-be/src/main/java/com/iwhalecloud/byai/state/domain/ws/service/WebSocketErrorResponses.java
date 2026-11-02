package com.iwhalecloud.byai.state.domain.ws.service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

/** Correlated chat errors use WebSocket frames after the HTTP upgrade. */
public final class WebSocketErrorResponses {
    private WebSocketErrorResponses() {
    }

    public static void send(ChannelHandlerContext ctx, ChatMessage request, String detail) {
        if (!ctx.channel().isActive()
            || com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation.isCancelled()) return;
        JSONObject response = new JSONObject();
        response.put("type", MessageType.ERROR.name());
        response.put("clientRequestId", request.getClientRequestId());
        response.put("enterpriseId", request.getEnterpriseId());
        response.put("sessionId", request.getSessionId() == null ? null : String.valueOf(request.getSessionId()));
        response.put("chatContent", detail);
        response.put("message", detail);
        ctx.writeAndFlush(new TextWebSocketFrame(response.toJSONString()));
    }
}
