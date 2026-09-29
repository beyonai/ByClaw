package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorAnswerPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class TenantChatMirrorServiceTest {
    @Test
    void terminalCarriesRenderedHistoryAndResponder() {
        TenantNodeClient node = mock(TenantNodeClient.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper());
        AssistantChatDto dto = new AssistantChatDto();
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
    }
}
