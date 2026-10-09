package com.iwhalecloud.byai.state.domain.groupchat.interfaces;

import org.springframework.beans.factory.annotation.Autowired;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.application.TenantGroupAgentDispatcher;
import org.springframework.dao.DataAccessException;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandResult;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupMessagePayload;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatActiveTaskException;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;

import io.netty.channel.ChannelHandlerContext;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import lombok.extern.slf4j.Slf4j;

/** 群聊 WebSocket 命令适配器；业务编排仍由应用服务负责。 */
@Slf4j
@Service
public class GroupChatWebSocketService {
    @Autowired
    private com.iwhalecloud.byai.manager.domain.tenant.TenantGroupCoordinationService tenantCoordination;
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
        JSONObject response;
        if (message.getSessionId() == null || (message.getChatContent() == null
            && (message.getFiles() == null || message.getFiles().isEmpty()))) {
            // 缺少群 ID 时，FE 只能通过 ERROR 的 clientRequestId 结束该请求的等待。
            response = failure(message, message.getSessionId() == null ? "ERROR" : "GROUP_CHAT_REJECTED",
                "INVALID_GROUP_MESSAGE", "Group chat session and content are required");
        }
        else {
            // 纯附件请求允许省略正文，统一为空字符串以保持持久化与广播的正文结构一致。
            if (message.getChatContent() == null) {
                message.setChatContent("");
            }
            response = accept(message);
        }
        // 写回发生在业务异常边界之外，避免把 ACK 写入失败误报成消息拒绝。
        context.writeAndFlush(new TextWebSocketFrame(JSON.toJSONString(response)));
    }

    private JSONObject accept(ChatMessage message) {
        try {
            TenantRequestContext tenant = TenantRequestContextHolder.get();
            if (tenant != null) return acceptTenant(tenant, message);
            Long messageId = applicationService.acceptUserMessage(message);
            JSONObject ack = event(message, "GROUP_CHAT_ACCEPTED");
            ack.put("messageId", messageId);
            Object scope = applicationService.coordinationForMessage(messageId);
            if (scope != null) ack.put("groupCoordination", scope);
            return ack;
        }
        catch (GroupChatActiveTaskException rejection) {
            // 事务已回滚，保留活动任务入口信息和原有错误码。
            JSONObject response = failure(message, "GROUP_CHAT_REJECTED",
                GroupChatActiveTaskException.CODE, rejection.getMessage());
            response.put("taskId", String.valueOf(rejection.getTaskId()));
            response.put("agentId", String.valueOf(rejection.getAgentId()));
            return response;
        }
        catch (GroupChatMessageRejectedException rejection) {
            return failure(message, "GROUP_CHAT_REJECTED", "GROUP_CHAT_VALIDATION_FAILED", rejection.getMessage());
        }
        catch (Exception error) {
            // 提交结果或提交后广播可能不确定；ERROR 允许原请求重试和迟到的 ACK 校正。
            log.error("Group message processing failed, sessionId={}, clientRequestId={}",
                message.getSessionId(), message.getClientRequestId(), error);
            boolean storageFailure = error instanceof DataAccessException;
            return failure(message, "ERROR", storageFailure ? "GROUP_CHAT_STORAGE_ERROR" : "GROUP_CHAT_INTERNAL_ERROR",
                storageFailure ? "数据库处理失败，消息发送结果暂未确认，请稍后重试"
                    : "服务处理异常，消息发送结果暂未确认，请稍后重试");
        }
    }

    private JSONObject acceptTenant(TenantRequestContext tenant, ChatMessage message) {
        if (tenantNodeClient == null) throw new IllegalStateException("tenant Node client unavailable");
        java.util.Map<String, Object> coordinator = message.getResourceList() != null
            && message.getResourceList().stream().anyMatch(resource ->
                com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum.DIG_EMPLOYEE.equals(resource.getResourceType()))
            ? tenantCoordination.coordinator(tenant, message.getSessionId()) : java.util.Map.of();
        CommandResult result = tenantNodeClient.command(tenant, "POST",
            "/internal/v1/group-chats/" + message.getSessionId() + "/messages",
            message.getSessionId().toString(), "SEND_GROUP_MESSAGE",
            new GroupMessagePayload(message.getChatContent(), message.getResourceList() == null ? java.util.List.of() : message.getResourceList(), message.getFiles(),
                message.getReplyToMessageId() == null ? null : message.getReplyToMessageId().toString(),
                message.getSenderName(), (String) coordinator.get("coordinatorAgentId"),
                (String) coordinator.get("coordinatorName"), (Boolean) coordinator.get("coordinatorAuthorized")), message.getClientRequestId());
        if (result == null || result.messageId() == null) {
            throw new IllegalStateException("tenant group message was not committed");
        }
        String messageId = result.messageId();
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
        java.util.Map<String, Object> scope = result.dispatches() == null ? null : result.dispatches().stream()
            .map(com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.GroupDispatch::groupCoordination)
            .filter(java.util.Objects::nonNull).filter(value -> "COORDINATED".equals(value.get("mode")))
            .findFirst().orElse(null);
        if (scope != null) event.put("groupCoordination", scope);
        try {
            eventPublisher.publishTenant(tenant, message.getSessionId(), event);
            if (scope != null) {
                JSONObject created = new JSONObject();
                created.put("type", "GROUP_CHAT_EVENT");
                created.put("event", "TASK_CREATED");
                created.put("sessionId", message.getSessionId().toString());
                created.put("taskId", scope.get("taskSessionId"));
                created.put("taskName", message.getChatContent());
                created.put("targetAgentId", scope.get("coordinatorAgentId"));
                created.put("sourceMessageId", messageId);
                created.put("initiatorUserId", tenant.userId());
                created.put("status", "ACTIVE");
                created.put("turnStatus", "QUEUED");
                created.put("groupCoordination", scope);
                eventPublisher.publishTenant(tenant, message.getSessionId(), created);
            }
        }
        catch (RuntimeException error) {
            log.warn("租户工作组消息已提交，但广播失败, sessionId={}, messageId={}",
                message.getSessionId(), messageId, error);
        }
        if (tenantDispatcher != null) tenantDispatcher.dispatch(tenant, message.getSessionId(), messageId,
            message.getChatContent(), result.dispatches());
        JSONObject ack = event(message, "GROUP_CHAT_ACCEPTED");
        ack.put("messageId", messageId);
        ack.put("enterpriseId", Long.toString(tenant.enterpriseId()));
        if (scope != null) {
            ack.put("groupCoordination", scope);
            ack.put("taskId", scope.get("taskSessionId"));
            ack.put("targetAgentId", scope.get("coordinatorAgentId"));
        }
        return ack;
    }

    private JSONObject event(ChatMessage message, String type) {
        JSONObject response = new JSONObject();
        response.put("type", type);
        if (message.getSessionId() != null) {
            response.put("sessionId", String.valueOf(message.getSessionId()));
        }
        response.put("clientRequestId", message.getClientRequestId());
        return response;
    }

    private JSONObject failure(ChatMessage message, String type, String code, String reason) {
        JSONObject response = event(message, type);
        response.put("code", code);
        response.put("message", reason == null || reason.isBlank() ? "消息发送被拒绝" : reason);
        return response;
    }
}
