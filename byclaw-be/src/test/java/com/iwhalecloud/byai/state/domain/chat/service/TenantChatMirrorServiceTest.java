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
    void groupReplyExcludesStructuredEventsAndKeepsVisibleText() {
        TenantNodeClient node = mock(TenantNodeClient.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper(),
            mock(GroupChatEventPublisher.class));
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.tenantContext = new TenantRequestContext(7L, 11L, "MEMBER");
        context.sessionId = 12L; context.taskId = 13L; context.userMessageId = 14L;
        context.modelAnswerMessageId = 15L;
        context.messageContext = new MessageContext();
        context.messageContext.getAnswerText().append("{plan}成果已完成{files}");
        context.messageContext.getAnswerMessageList().addAll(com.alibaba.fastjson.JSON.parseArray(
            "[{\"contentType\":\"2008\",\"choices\":[{\"delta\":{\"content\":\"{plan}\"}}]},"
                + "{\"contentType\":\"1002\",\"choices\":[{\"delta\":{\"content\":\"成果已完成\"}}]},"
                + "{\"contentType\":\"3016\",\"choices\":[{\"delta\":{\"content\":\"{files}\"}}]}]",
            com.iwhalecloud.byai.state.common.dto.AnswerDelta.class));

        service.terminal(context);

        ArgumentCaptor<MirrorEvent> captured = ArgumentCaptor.forClass(MirrorEvent.class);
        verify(node).mirror(any(), captured.capture());
        MirrorAnswerPayload payload = (MirrorAnswerPayload) captured.getValue().payload();
        assertThat(payload.messageContent()).isEqualTo("成果已完成");
        assertThat(payload.messageStruct()).hasSize(3);
    }

    @Test
    void terminalHistoryCarriesTheOrderedRendererVersion() {
        var node = mock(TenantNodeClient.class);
        var mapper = new ObjectMapper();
        var service = new TenantChatMirrorService(node, mapper, mock(GroupChatEventPublisher.class));
        var context = new ChatProcessContext(null, new AssistantChatDto());
        context.tenantContext = new TenantRequestContext(7L, 11L, "MEMBER");
        context.sessionId = 12L; context.taskId = 13L; context.userMessageId = 14L;
        context.modelAnswerMessageId = 15L; context.messageContext = new MessageContext();
        context.messageContext.recordAnswerStruct("{\"contentType\":\"1002\",\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}");
        service.terminal(context);
        ArgumentCaptor<MirrorEvent> captured = ArgumentCaptor.forClass(MirrorEvent.class);
        verify(node).mirror(any(), captured.capture());
        var payload = (MirrorAnswerPayload) captured.getValue().payload();
        assertThat(mapper.valueToTree(payload.metadata()).path("messageRenderVersion").asText()).isEqualTo("v2");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void directTaskBroadcastsTerminalStatusEvenWithoutAGroupReply(boolean failed) {
        TenantNodeClient node = mock(TenantNodeClient.class);
        GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper(), events);
        AssistantChatDto dto = new AssistantChatDto();
        dto.getExtParams().put("tenantGroupTask", "12");
        dto.getExtParams().put("groupCoordination", Map.of("mode", "DIRECT"));
        ChatProcessContext context = new ChatProcessContext(null, dto);
        context.tenantContext = new TenantRequestContext(7L, 11L, "MEMBER");
        context.sessionId = 12L; context.taskId = 13L; context.userMessageId = 14L;
        context.modelAnswerMessageId = 15L; context.messageContext = new MessageContext();
        context.gatewayError = failed;
        doReturn(Map.of("groupSessionId", "30", "status", "ACTIVE",
            "turnStatus", failed ? "FAILED" : "WAITING_USER"))
            .when(node).request(any(), eq("GET"), eq("/internal/v1/group-chat/tasks/12"), isNull(), any());
        service.terminal(context);
        ArgumentCaptor<JSONObject> captured = ArgumentCaptor.forClass(JSONObject.class);
        verify(events).publishTenant(eq(context.tenantContext), eq(30L), captured.capture());
        assertThat(captured.getValue().getString("event")).isEqualTo("TASK_STATUS_CHANGED");
        assertThat(captured.getValue().getString("turnStatus")).isEqualTo(failed ? "FAILED" : "WAITING_USER");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void coordinatedTaskStatusIsBroadcastAfterTerminalMirror(boolean failed) {
        TenantNodeClient node = mock(TenantNodeClient.class);
        GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper(), events);
        AssistantChatDto dto = new AssistantChatDto();
        dto.getExtParams().put("tenantGroupTask", "12");
        dto.getExtParams().put("groupCoordination", Map.of("mode", "COORDINATED"));
        ChatProcessContext context = new ChatProcessContext(null, dto);
        context.tenantContext = new TenantRequestContext(7L, 11L, "MEMBER");
        context.sessionId = 12L;
        context.taskId = 13L;
        context.userMessageId = 14L;
        context.modelAnswerMessageId = 15L;
        context.messageContext = new MessageContext();
        context.gatewayError = failed;
        doReturn(Map.of("groupSessionId", "30", "sourceMessageId", "14", "targetAgentId", "42",
            "status", "ACTIVE", "turnStatus", failed ? "FAILED" : "WAITING_USER"))
            .when(node).request(any(), eq("GET"), eq("/internal/v1/group-chat/tasks/12"), isNull(), any());

        service.terminal(context);

        ArgumentCaptor<JSONObject> event = ArgumentCaptor.forClass(JSONObject.class);
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(node, events);
        order.verify(node).mirror(eq(context.tenantContext), any());
        order.verify(node).request(any(), eq("GET"), eq("/internal/v1/group-chat/tasks/12"), isNull(), any());
        order.verify(events).publishTenant(eq(context.tenantContext), eq(30L), event.capture());
        assertThat(event.getValue().getString("event")).isEqualTo("TASK_STATUS_CHANGED");
        assertThat(event.getValue().getString("turnStatus")).isEqualTo(failed ? "FAILED" : "WAITING_USER");
        assertThat(event.getValue().getString("taskId")).isEqualTo("12");
    }

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
        context.messageContext.getAnswerMessageList().add(com.alibaba.fastjson.JSON.parseObject(
            "{\"contentType\":\"1002\",\"choices\":[{\"delta\":{\"content\":\"你好！\"}}]}",
            com.iwhalecloud.byai.state.common.dto.AnswerDelta.class));

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
