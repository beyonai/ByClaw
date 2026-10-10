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
        stored.setMessageContent("你好！");
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

    @Test
    void missingClassificationDefaultsToChatAndPublishesOnlyThePersistedGroupReply() {
        TenantNodeClient node = mock(TenantNodeClient.class);
        GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper(), events);
        ChatProcessContext context = candidateContext();
        context.assistantChatDto.setMetadata("{\"groupDisposition\":{\"kind\":\"TASK\",\"dispatchId\":\"forged\"}}");
        doReturn(Map.of("disposition", "CHAT", "publishMessageId", "99", "groupSessionId", "30",
            "sourceMessageId", "14", "targetAgentId", "42"))
            .when(node).request(any(), eq("GET"), eq("/internal/v1/group-chat/dispatches/12"), isNull(), any());
        MessageView stored = new MessageView(); stored.setMessageContent("你好！");
        stored.setMetadata("{\"kind\":\"CHAT_REPLY\"}");
        doReturn(List.of(stored)).when(node).request(any(), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any());

        service.terminal(context);

        ArgumentCaptor<MirrorEvent> mirrored = ArgumentCaptor.forClass(MirrorEvent.class);
        verify(node).mirror(any(), mirrored.capture());
        MirrorAnswerPayload payload = (MirrorAnswerPayload) mirrored.getValue().payload();
        assertThat(payload.metadata().groupDisposition().kind()).isEqualTo("CHAT");
        assertThat(payload.metadata().groupDisposition().dispatchId()).isEqualTo("70");
        assertThat(mirrored.getValue().eventSeq()).isEqualTo("1");
        ArgumentCaptor<JSONObject> published = ArgumentCaptor.forClass(JSONObject.class);
        verify(events).publishTenant(any(), eq(30L), published.capture());
        assertThat(published.getValue().getString("event")).isEqualTo("MESSAGE_CREATED");
        assertThat(published.getValue().getString("content")).isEqualTo("你好！");
        assertThat(published.getValue().getString("taskId")).isNull();
    }

    @Test
    void validTaskClassificationPromotesWhileRunningAndPreservesSequentialMirroring() {
        TenantNodeClient node = mock(TenantNodeClient.class);
        GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
        TenantChatMirrorService service = new TenantChatMirrorService(node, new ObjectMapper(), events);
        var reader = mock(com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader.class);
        var users = mock(com.iwhalecloud.byai.manager.domain.users.service.UserService.class);
        var user = new com.iwhalecloud.byai.manager.entity.users.Users(); user.setUserCode("user-7");
        doReturn(user).when(users).findById(7L);
        service.configureDisposition(reader, users);
        var value = new com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition();
        value.setSchemaVersion("1"); value.setDispatchId("70"); value.setKind("TASK"); value.setTaskName("制作报告");
        doReturn(value).when(reader).read("user-7", 12L, 70L);
        doReturn(Map.of("disposition", "TASK", "publishMessageId", "99", "groupSessionId", "30"))
            .when(node).request(any(), eq("GET"), eq("/internal/v1/group-chat/dispatches/12"), isNull(), any());
        doReturn(Map.of("status", "ACTIVE", "turnStatus", "RUNNING", "taskName", "制作报告",
            "sourceMessageId", "14", "targetAgentId", "42"))
            .when(node).request(any(), eq("GET"), eq("/internal/v1/group-chat/tasks/12"), isNull(), any());
        MessageView ack = new MessageView(); ack.setMessageContent("已接收任务");
        ack.setMetadata("{\"kind\":\"TASK_ACK\",\"taskId\":\"12\"}");
        doReturn(List.of(ack)).when(node).request(any(), eq("POST"), eq("/internal/v1/assiman/getMessageByIds"), any(), any());
        ChatProcessContext context = candidateContext();

        service.input(context);
        service.observeClassification(context);
        value.setKind("CHAT"); // A later file rewrite must not downgrade the committed TASK decision.
        service.observeClassification(context);
        service.terminal(context);

        ArgumentCaptor<MirrorEvent> mirrored = ArgumentCaptor.forClass(MirrorEvent.class);
        verify(node, org.mockito.Mockito.times(3)).mirror(any(), mirrored.capture());
        assertThat(mirrored.getAllValues()).extracting(MirrorEvent::eventSeq).containsExactly("0", "1", "2");
        assertThat(mirrored.getAllValues()).extracting(MirrorEvent::eventType).containsExactly("INPUT", "DELTA", "TERMINAL");
        assertThat(((MirrorAnswerPayload) mirrored.getAllValues().get(2).payload()).metadata().groupDisposition().kind()).isEqualTo("TASK");
        ArgumentCaptor<JSONObject> published = ArgumentCaptor.forClass(JSONObject.class);
        verify(events, org.mockito.Mockito.times(4)).publishTenant(any(), eq(30L), published.capture());
        assertThat(published.getAllValues()).filteredOn(event -> "MESSAGE_CREATED".equals(event.getString("event")))
            .allSatisfy(event -> assertThat(event.getString("content")).isEqualTo("已接收任务"));
        assertThat(published.getAllValues().get(0).getString("event")).isEqualTo("TASK_CREATED");
        assertThat(published.getAllValues().get(1).getString("taskId")).isEqualTo("12");
        service.shutdown();
    }

    @Test
    void coordinatedRequestsIgnoreEvenAForgedCandidateClassification() {
        var node = mock(TenantNodeClient.class);
        var service = new TenantChatMirrorService(node, new ObjectMapper(), mock(GroupChatEventPublisher.class));
        ChatProcessContext context = candidateContext();
        context.assistantChatDto.getExtParams().put("groupCoordination", Map.of("mode", "COORDINATED"));
        context.assistantChatDto.getExtParams().remove("tenantGroupTask");
        service.terminal(context);
        ArgumentCaptor<MirrorEvent> mirrored = ArgumentCaptor.forClass(MirrorEvent.class);
        verify(node).mirror(any(), mirrored.capture());
        assertThat(((MirrorAnswerPayload) mirrored.getValue().payload()).metadata()).isNull();
        assertThat(mirrored.getValue().eventSeq()).isEqualTo("1");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void resumedOrRetriedInitialTurnUsesThePersistedMirrorSequence(boolean terminal) {
        var node = mock(TenantNodeClient.class);
        var service = new TenantChatMirrorService(node, new ObjectMapper(), mock(GroupChatEventPublisher.class));
        ChatProcessContext context = candidateContext();
        context.assistantChatDto.getExtParams().remove("tenantGroupTask");
        context.assistantChatDto.getExtParams().remove("tenantGroupCandidate");
        doReturn(Map.of("answerMessageId", "15", "traceId", "trace-15", "answerLastSeq", terminal ? "2" : "1",
            "answerTerminal", terminal)).when(node).request(any(), eq("GET"),
            eq("/internal/v1/group-chat/dispatches/12"), isNull(), any());

        service.terminal(context);

        ArgumentCaptor<MirrorEvent> mirrored = ArgumentCaptor.forClass(MirrorEvent.class);
        if (terminal) {
            verify(node, org.mockito.Mockito.never()).mirror(any(), any());
            return;
        }
        verify(node).mirror(any(), mirrored.capture());
        assertThat(mirrored.getValue().eventSeq()).isEqualTo("2");
        assertThat(((MirrorAnswerPayload) mirrored.getValue().payload()).metadata()).isNull();
    }

    private ChatProcessContext candidateContext() {
        AssistantChatDto dto = new AssistantChatDto(); dto.setChatContent("hello");
        dto.getExtParams().put("tenantGroupTask", "12");
        dto.getExtParams().put("tenantGroupCandidate", true);
        dto.getExtParams().put("groupCoordination", Map.of("mode", "DIRECT"));
        dto.getExtParams().put("groupDispatch", Map.of("dispatchId", "70", "candidateSessionId", "12"));
        ChatProcessContext context = new ChatProcessContext(null, dto);
        context.tenantContext = new TenantRequestContext(7L, 11L, "MEMBER");
        context.sessionId = 12L; context.taskId = 13L; context.userMessageId = 14L; context.modelAnswerMessageId = 15L;
        context.messageContext = new MessageContext(); context.messageContext.getAnswerText().append("不应作为任务回执广播的正文");
        return context;
    }
}
