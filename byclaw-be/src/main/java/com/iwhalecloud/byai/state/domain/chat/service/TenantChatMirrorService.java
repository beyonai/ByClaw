package com.iwhalecloud.byai.state.domain.chat.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerMetadata;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorInputPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import java.util.Map;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** Commits the existing chat pipeline's messages through the tenant Node REST boundary. */
@Service
public class TenantChatMirrorService {
    private static final Logger log = LoggerFactory.getLogger(TenantChatMirrorService.class);

    private final TenantNodeClient node;
    private final ObjectMapper objectMapper;
    private final GroupChatEventPublisher groupEvents;

    public TenantChatMirrorService(TenantNodeClient node, ObjectMapper objectMapper,
        GroupChatEventPublisher groupEvents) {
        this.node = node;
        this.objectMapper = objectMapper;
        this.groupEvents = groupEvents;
    }

    public void input(ChatProcessContext context) {
        String userMessageId = context.userMessageId.toString();
        node.mirror(context.tenantContext, event(context, "INPUT", "0", "input-" + userMessageId,
            new MirrorInputPayload(userMessageId, Long.toString(context.tenantContext.userId()), null,
                context.assistantChatDto.getChatContent())));
    }

    public void terminal(ChatProcessContext context) {
        String answerMessageId = context.modelAnswerMessageId.toString();
        String content = context.messageContext.getExplicitFinalAnswer();
        if (content == null) content = context.messageContext.getAnswerText().toString();
        MirrorAnswerMetadata metadata = metadata(context.assistantChatDto.getMetadata());
        node.mirror(context.tenantContext, event(context, context.gatewayError ? "ERROR" : "TERMINAL",
            "1", "terminal-" + answerMessageId,
            new MirrorAnswerPayload(answerMessageId, context.taskId.toString(), content, content,
                metadata == null ? null : metadata.resourceName(), metadata,
                context.messageContext.getAnswerMessageList(),
                context.messageContext.getReasonMessageList())));
        notifyGroupReply(context, content);
    }

    private void notifyGroupReply(ChatProcessContext context, String content) {
        Map<String, Object> params = context.assistantChatDto.getExtParams();
        Object taskId = params == null ? null : params.get("tenantGroupTask");
        if (taskId == null) return;
        try {
            Map<String, Object> task = node.request(context.tenantContext, "GET",
                "/internal/v1/group-chat/tasks/" + taskId, null,
                new TypeReference<Map<String, Object>>() { });
            Object messageId = task.get("publishMessageId");
            Object groupId = task.get("groupSessionId");
            if (groupId == null) return;
            Object coordination = params.get("groupCoordination");
            if (coordination instanceof Map<?, ?> scope && "COORDINATED".equals(scope.get("mode"))) {
                JSONObject status = new JSONObject();
                status.put("type", "GROUP_CHAT_EVENT");
                status.put("event", "TASK_STATUS_CHANGED");
                status.put("sessionId", groupId.toString());
                status.put("taskId", taskId.toString());
                status.put("sourceMessageId", task.get("sourceMessageId"));
                status.put("targetAgentId", task.get("targetAgentId"));
                status.put("status", task.get("status"));
                status.put("turnStatus", task.get("turnStatus"));
                status.put("groupCoordination", coordination);
                groupEvents.publishTenant(context.tenantContext, Long.valueOf(groupId.toString()), status);
                return;
            }
            if (context.gatewayError || messageId == null) return;
            List<MessageView> committed = node.request(context.tenantContext, "POST",
                "/internal/v1/assiman/getMessageByIds", Map.of("messageIds", List.of(messageId.toString())),
                new TypeReference<List<MessageView>>() { });
            if (committed == null || committed.size() != 1) return;
            MessageView stored = committed.get(0);
            JSONObject event = new JSONObject();
            event.put("type", "GROUP_CHAT_EVENT");
            event.put("event", "MESSAGE_CREATED");
            event.put("sessionId", groupId.toString());
            event.put("messageId", messageId.toString());
            event.put("messageRef", task.get("sourceMessageId"));
            event.put("topicId", stored.getTopicId());
            event.put("creatorId", task.get("targetAgentId"));
            event.put("creatorName", stored.getCreatorName());
            event.put("content", content);
            event.put("speaker", Map.of("type", "AGENT", "agentId", task.get("targetAgentId"),
                "displayName", stored.getCreatorName() == null ? "" : stored.getCreatorName()));
            groupEvents.publishTenant(context.tenantContext, Long.valueOf(groupId.toString()), event);
        }
        catch (RuntimeException error) {
            log.warn("租户群回复已提交但广播失败, taskId={}", taskId, error);
        }
    }

    private MirrorAnswerMetadata metadata(String value) {
        if (value == null || value.isBlank()) return null;
        try {
            return objectMapper.readValue(value, MirrorAnswerMetadata.class);
        } catch (JsonProcessingException error) {
            throw new IllegalArgumentException("tenant answer metadata is invalid", error);
        }
    }

    private MirrorEvent event(ChatProcessContext context, String eventType, String sequence,
                              String eventId, com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorPayload payload) {
        String traceId = context.traceId == null ? "trace-" + context.modelAnswerMessageId : context.traceId;
        String clientRequestId = context.clientRequestId == null || context.clientRequestId.isBlank()
            ? "turn-" + context.userMessageId : context.clientRequestId;
        return new MirrorEvent(context.sessionId.toString(), clientRequestId, traceId, traceId,
            context.userMessageId.toString(), context.modelAnswerMessageId.toString(), eventId,
            null, 0, sequence, eventType, payload);
    }
}
