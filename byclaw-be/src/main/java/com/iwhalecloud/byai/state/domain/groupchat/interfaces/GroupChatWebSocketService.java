package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatActiveTaskException;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupMessagePayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import org.springframework.beans.factory.annotation.Autowired;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

/** 群聊 WebSocket 命令适配器；业务编排仍由应用服务负责。 */
@Service
public class GroupChatWebSocketService {
    private final GroupChatApplicationService applicationService;
    private final TenantNodeClient tenantNodeClient;
    private final ByaiGroupChatMentionMapper mentionMapper;

    @Autowired
    public GroupChatWebSocketService(GroupChatApplicationService applicationService, TenantNodeClient tenantNodeClient,
        ByaiGroupChatMentionMapper mentionMapper) {
        this.applicationService = applicationService;
        this.tenantNodeClient = tenantNodeClient;
        this.mentionMapper = mentionMapper;
    }

    public GroupChatWebSocketService(GroupChatApplicationService applicationService) {
        this.applicationService = applicationService;
        this.tenantNodeClient = null;
        this.mentionMapper = null;
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
        try {
            TenantRequestContext tenant = TenantRequestContextHolder.get();
            String messageId;
            if (tenant == null || mentionMapper != null && mentionMapper.isLegacyGroupMember(
                message.getSessionId(), tenant.userId(), tenant.enterpriseId())) {
                messageId = String.valueOf(applicationService.acceptUserMessage(message));
            }
            else {
                if (tenantNodeClient == null) throw new IllegalStateException("tenant Node client unavailable");
                CommandResult result = tenantNodeClient.command(tenant, "POST",
                    "/internal/v1/group-chats/" + message.getSessionId() + "/messages",
                    message.getSessionId().toString(), "SEND_GROUP_MESSAGE",
                    new GroupMessagePayload(message.getChatContent(), message.getResourceList(), message.getFiles(),
                        message.getReplyToMessageId() == null ? null : message.getReplyToMessageId().toString(),
                        message.getSenderName()), message.getClientRequestId());
                if (result == null || result.messageId() == null) {
                    throw new IllegalStateException("tenant group message was not committed");
                }
                messageId = result.messageId();
            }
            JSONObject ack = new JSONObject();
            ack.put("type", "GROUP_CHAT_ACCEPTED");
            ack.put("sessionId", String.valueOf(message.getSessionId()));
            ack.put("clientRequestId", message.getClientRequestId());
            ack.put("messageId", messageId);
            if (tenant != null) ack.put("enterpriseId", String.valueOf(tenant.enterpriseId()));
            context.writeAndFlush(new TextWebSocketFrame(JSON.toJSONString(ack)));
        }
        catch (GroupChatActiveTaskException rejection) {
            // The application transaction has rolled back before the rejected request is acknowledged.
            JSONObject event = new JSONObject();
            event.put("type", "GROUP_CHAT_REJECTED");
            event.put("sessionId", String.valueOf(message.getSessionId()));
            event.put("clientRequestId", message.getClientRequestId());
            event.put("code", GroupChatActiveTaskException.CODE);
            event.put("message", rejection.getMessage());
            event.put("taskId", String.valueOf(rejection.getTaskId()));
            event.put("agentId", String.valueOf(rejection.getAgentId()));
            context.writeAndFlush(new TextWebSocketFrame(JSON.toJSONString(event)));
        }
    }
}
