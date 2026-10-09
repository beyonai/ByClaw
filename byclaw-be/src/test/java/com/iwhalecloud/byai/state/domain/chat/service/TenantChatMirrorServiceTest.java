package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import java.util.Map;
import java.util.List;
import com.alibaba.fastjson.JSONObject;

class TenantChatMirrorServiceTest {
    @Test
    void terminalCarriesRenderedHistoryAndResponder() {
        TenantNodeClient node = mock(TenantNodeClient.class);
        GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper(),
            events);
        AssistantChatDto dto = new AssistantChatDto();
        dto.getExtParams().put("tenantGroupTask", "12");
        doReturn(Map.of("publishMessageId", "99", "groupSessionId", "30", "sourceMessageId", "14",
            "targetAgentId", "42")).when(node).request(any(), eq("GET"),
                eq("/internal/v1/group-chat/tasks/12"), isNull(), any());
        MessageView stored = new MessageView();
        stored.setMessageId("99");
        stored.setTopicId("14");
        stored.setCreatorName("陈舵主的超级助手");
        doReturn(List.of(stored)).when(node).request(any(), eq("POST"),
            eq("/internal/v1/assiman/getMessageByIds"), any(), any());
        dto.setMetadata("{\"resourceName\":\"陈舵主的超级助手\",\"resourceType\":\"DIG_EMPLOYEE\","
            + "\"agentId\":\"42\",\"usedModel\":{\"id\":\"9\",\"name\":\"MiniMax-M3\"}}");
        ChatProcessContext context = new ChatProcessContext(null, dto);
        context.tenantContext = new TenantRequestContext(7L, 11L, "MEMBER");
        context.sessionId = 12L;
        context.taskId = 13L;
        context.userMessageId = 14L;
        context.modelAnswerMessageId = 15L;
        context.messageContext = new MessageContext();
        context.messageContext.getAnswerText().append("你好！");
        context.messageContext.getReasonMessageList().add(new com.iwhalecloud.byai.state.common.dto.AnswerDelta());
        context.messageContext.getAnswerMessageList().add(new com.iwhalecloud.byai.state.common.dto.AnswerDelta());

        service.terminal(context);

        ArgumentCaptor<MirrorEvent> captured = ArgumentCaptor.forClass(MirrorEvent.class);
        verify(node).mirror(any(), captured.capture());
        MirrorAnswerPayload payload = (MirrorAnswerPayload) captured.getValue().payload();
        assertThat(payload.creatorName()).isEqualTo("陈舵主的超级助手");
        assertThat(payload.metadata().usedModel().name()).isEqualTo("MiniMax-M3");
        assertThat(payload.messageStruct()).hasSize(1);
        assertThat(payload.inferLog()).hasSize(1);
        ArgumentCaptor<JSONObject> groupEvent = ArgumentCaptor.forClass(JSONObject.class);
        verify(events).publishTenant(eq(context.tenantContext), eq(30L), groupEvent.capture());
        assertThat(groupEvent.getValue().getString("messageId")).isEqualTo("99");
        assertThat(groupEvent.getValue().getString("content")).isEqualTo("你好！");
        assertThat(groupEvent.getValue().getString("topicId")).isEqualTo("14");
    }
}
