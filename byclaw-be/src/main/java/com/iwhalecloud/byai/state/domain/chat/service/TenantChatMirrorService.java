package com.iwhalecloud.byai.state.domain.chat.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerMetadata;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorInputPayload;
import org.springframework.stereotype.Service;

/** Commits the existing chat pipeline's messages through the tenant Node REST boundary. */
@Service
public class TenantChatMirrorService {

    private final TenantNodeClient node;
    private final ObjectMapper objectMapper;

    public TenantChatMirrorService(TenantNodeClient node, ObjectMapper objectMapper) {
        this.node = node;
        this.objectMapper = objectMapper;
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
