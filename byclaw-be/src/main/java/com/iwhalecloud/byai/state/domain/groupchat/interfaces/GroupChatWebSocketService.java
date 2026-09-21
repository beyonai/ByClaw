package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

/** 群聊 WebSocket 命令适配器；业务编排仍由应用服务负责。 */
@Service
public class GroupChatWebSocketService {
    private final GroupChatApplicationService applicationService;

    public GroupChatWebSocketService(GroupChatApplicationService applicationService) {
        this.applicationService = applicationService;
    }

    public void send(ChannelHandlerContext context, ChatMessage message) {
        if (message.getSessionId() == null || (message.getChatContent() == null
            && (message.getFiles() == null || message.getFiles().isEmpty()))) {
            throw new IllegalArgumentException("Group chat session and content are required");
        }
        // 纯附件请求允许省略正文，统一为空字符串以保持持久化与广播的正文结构一致。
        if (message.getChatContent() == null) {
            message.setChatContent("");
        }
        JSONObject ack = new JSONObject();
        ack.put("type", "GROUP_CHAT_ACCEPTED");
        ack.put("sessionId", String.valueOf(message.getSessionId()));
        ack.put("clientRequestId", message.getClientRequestId());
        ack.put("messageId", applicationService.acceptUserMessage(message));
        context.writeAndFlush(new TextWebSocketFrame(JSON.toJSONString(ack)));
    }
}
