package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatActiveTaskException;
import com.iwhalecloud.byai.state.domain.groupchat.application.TenantGroupAgentDispatcher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** 群聊 WebSocket 命令适配器；业务编排仍由应用服务负责。 */
@Service
public class GroupChatWebSocketService {
    private static final Logger log = LoggerFactory.getLogger(GroupChatWebSocketService.class);
    private final GroupChatApplicationService applicationService;
    private final TenantNodeClient tenantNodeClient;
    private final ByaiGroupChatMentionMapper mentionMapper;
    private final GroupChatEventPublisher eventPublisher;
    private final TenantGroupAgentDispatcher tenantDispatcher;

    @Autowired
    public GroupChatWebSocketService(GroupChatApplicationService applicationService, TenantNodeClient tenantNodeClient,
        ByaiGroupChatMentionMapper mentionMapper, GroupChatEventPublisher eventPublisher,
        TenantGroupAgentDispatcher tenantDispatcher) {
        this.applicationService = applicationService;
        this.tenantNodeClient = tenantNodeClient;
        this.mentionMapper = mentionMapper;
        this.eventPublisher = eventPublisher;
        this.tenantDispatcher = tenantDispatcher;
    }

    public GroupChatWebSocketService(GroupChatApplicationService applicationService) {
        this.applicationService = applicationService;
        this.tenantNodeClient = null;
        this.mentionMapper = null;
        this.eventPublisher = null;
        this.tenantDispatcher = null;
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
            CommandResult result = null;
            boolean legacy = tenant == null || mentionMapper != null && mentionMapper.isLegacyGroupMember(
                message.getSessionId(), tenant.userId(), tenant.enterpriseId());
            if (legacy) {
                messageId = String.valueOf(applicationService.acceptUserMessage(message));
            }
            else {
                if (tenantNodeClient == null) throw new IllegalStateException("tenant Node client unavailable");
                result = tenantNodeClient.command(tenant, "POST",
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
            if (!legacy && eventPublisher != null) {
                JSONObject event = new JSONObject();
                event.put("type", "GROUP_CHAT_EVENT");
                event.put("event", "MESSAGE_CREATED");
                event.put("sessionId", String.valueOf(message.getSessionId()));
                event.put("messageId", messageId);
                event.put("clientRequestId", message.getClientRequestId());
                event.put("content", message.getChatContent());
                event.put("creatorId", tenant.userId());
                event.put("creatorName", message.getSenderName());
                event.put("resourceList", message.getResourceList());
                event.put("files", message.getFiles());
                event.put("replyToMessageId", message.getReplyToMessageId());
                event.put("speaker", java.util.Map.of("type", "USER",
                    "displayName", message.getSenderName() == null ? "" : message.getSenderName()));
                try {
                    eventPublisher.publishTenant(tenant, message.getSessionId(), event);
                }
                catch (RuntimeException error) {
                    log.warn("租户工作组消息已提交，但广播失败, sessionId={}, messageId={}",
                        message.getSessionId(), messageId, error);
                }
            }
            if (!legacy && tenantDispatcher != null && result != null) {
                tenantDispatcher.dispatch(tenant, message.getSessionId(), messageId,
                    message.getChatContent(), result.dispatches());
            }
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
