package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.List;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import org.mockito.ArgumentCaptor;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.route.RouteService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorAuthService;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.chat.model.ChatResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class ScriptExistingTurnTest {
    private ScriptService script;
    private RouteService route;
    private ScopedMessageWriteBehind writeBehind;
    private MultiDeviceBroadcastService broadcast;
    private AssistantChatDto dto;
    private ByaiMessageHotDtoDto existing;

    @BeforeEach
    void setUp() throws Exception {
        script = new ScriptService();
        route = mock(RouteService.class);
        writeBehind = mock(ScopedMessageWriteBehind.class);
        broadcast = mock(MultiDeviceBroadcastService.class);
        RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
        RunningChatInfo idle = new RunningChatInfo();
        idle.setRunning(false);
        when(running.getRunning(anyLong())).thenReturn(idle);
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(80L);
        ParamService params = mock(ParamService.class);
        when(params.getParams(any())).thenReturn(Map.of("worker_agent_type", "BYCLAW_EXE"));
        ReflectionTestUtils.setField(script, "routeService", route);
        ReflectionTestUtils.setField(script, "runningOutputStreamRegistry", running);
        ReflectionTestUtils.setField(script, "sequenceService", sequence);
        ReflectionTestUtils.setField(script, "paramService", params);
        ReflectionTestUtils.setField(script, "connectorAuthService", mock(ConnectorAuthService.class));
        ReflectionTestUtils.setField(script, "scopedMessageWriteBehind", writeBehind);
        ReflectionTestUtils.setField(script, "multiDeviceBroadcastService", broadcast);
        LoginInfo user = new LoginInfo();
        user.setUserId(30L);
        user.setUserCode("user30");
        CurrentUserHolder.setLoginInfo(user);
        dto = new AssistantChatDto();
        dto.setSessionId(60L);
        dto.setAgentId(40L);
        dto.setLlmMessageId(70L);
        dto.setChatContent("请生成报告");
        dto.setClientRequestId("61_70");
        existing = new ByaiMessageHotDtoDto();
        existing.setSessionId(60L);
        existing.setMessageId(61L);
        existing.setCreatorId(30L);
        existing.setMessageContent("请生成报告");
        doAnswer(invocation -> {
            ChatProcessContext ctx = invocation.getArgument(0);
            ctx.asyncResponse = true;
            return null;
        }).when(route).route(any());
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void existingMessageUsesOrdinaryPreparationAndWebsocketRouteWithoutDuplicateInsert() throws Exception {
        ChatProcessContext ctx = script.startExistingMessageTurn(dto, existing);
        assertThat(ctx.transport).isEqualTo(ChatTransport.WEBSOCKET);
        assertThat(ctx.userId).isEqualTo(30L);
        assertThat(ctx.senderChannel).isNull();
        assertThat(ctx.userMessageId).isEqualTo(61L);
        assertThat(ctx.modelAnswerMessageId).isEqualTo(70L);
        assertThat(ctx.traceId).isEqualTo(TraceIdCodec.encode(61L, 70L));
        assertThat(ctx.clientRequestId).isEqualTo("61_70");
        assertThat(ctx.askMsg).isSameAs(existing);
        assertThat(ctx.messageContext.getMessageId()).isEqualTo(70L);
        verify(route).route(ctx);
        verify(writeBehind, never()).enqueue(anyString(), anyLong(), any(), eq(true));
        verify(broadcast).broadcastToUserDevices(eq(30L), eq(60L), eq("initialization"), anyString(), isNull());
        assertThat(ctx.messagePersisted.get()).isFalse();
    }

    @Test
    void internalAssessmentKeepsNormalRuntimeAndRecoveryWithoutUserBroadcasts() throws Exception {
        ChatProcessContext live = script.startExistingMessageTurn(dto, existing, true);
        verify(route).route(live);
        verifyNoInteractions(broadcast);
        assertThat(live.transport).isEqualTo(ChatTransport.WEBSOCKET);
        ChatRuntimeStateService runtime = new ChatRuntimeStateService();
        ReflectionTestUtils.setField(runtime, "chatRuntimeInstance", mock(ChatRuntimeInstance.class));
        ChatRuntimeState saved = ReflectionTestUtils.invokeMethod(runtime, "buildState", live, "token");
        ChatRuntimeState reloaded = JSON.parseObject(JSON.toJSONString(saved), ChatRuntimeState.class);
        ChatProcessContext recovered = runtime.buildRecoveryContext(reloaded, mock(RunningChatSnapshotService.class));
        assertThat(recovered.suppressUserEvents).isTrue();
        assertThat(recovered.traceId).isEqualTo(live.traceId);
        assertThat(recovered.askMsg.getMessageId()).isEqualTo(existing.getMessageId());
    }

    @Test
    void preparationFailureIsDistinguishedFromUncertainGatewayDelivery() throws Exception {
        script = spy(script);
        doThrow(new IllegalStateException("local preparation failed")).when(script).prepareParams(any());
        doNothing().when(script).handleException(any());
        assertThatThrownBy(() -> script.startExistingMessageTurn(dto, existing))
            .isInstanceOf(ChatTurnPreparationException.class);
        verifyNoInteractions(route);
    }

    @Test
    void openingIndependentChildTurnsDoesNotShareTraceOrClientRequestId() throws Exception {
        ChatProcessContext first = script.startExistingMessageTurn(dto, existing);
        dto = new AssistantChatDto();
        dto.setSessionId(90L);
        dto.setAgentId(41L);
        dto.setLlmMessageId(92L);
        dto.setClientRequestId("91_92");
        existing = new ByaiMessageHotDtoDto();
        existing.setSessionId(90L);
        existing.setMessageId(91L);
        existing.setCreatorId(30L);
        ChatProcessContext second = script.startExistingMessageTurn(dto, existing);
        assertThat(second.sessionId).isNotEqualTo(first.sessionId);
        assertThat(second.traceId).isNotEqualTo(first.traceId);
        assertThat(second.clientRequestId).isNotEqualTo(first.clientRequestId);
        assertThat(second.messageContext).isNotSameAs(first.messageContext);
    }

    @Test
    void runtimeRecoveryRetainsTargetOnlyMembershipWithoutLosingMentionResources() throws Exception {
        ResourceVo target = new ResourceVo();
        target.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        target.setResourceId("40");
        ResourceVo other = new ResourceVo();
        other.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        other.setResourceId("41");
        dto.setResourceList(List.of(target, other));
        ChatProcessContext live = script.startExistingMessageTurn(dto, existing);
        ChatRuntimeStateService runtime = new ChatRuntimeStateService();
        ReflectionTestUtils.setField(runtime, "chatRuntimeInstance", mock(ChatRuntimeInstance.class));
        ChatRuntimeState saved = ReflectionTestUtils.invokeMethod(runtime, "buildState", live, "token");
        ChatRuntimeState reloaded = JSON.parseObject(JSON.toJSONString(saved), ChatRuntimeState.class);
        ChatProcessContext recovered = runtime.buildRecoveryContext(reloaded, mock(RunningChatSnapshotService.class));
        assertThat(recovered.sessionMemberAgentId).isEqualTo(40L);
        assertThat(recovered.assistantChatDto.getResourceList()).hasSize(2);
        recovered.agentIds.add(41L);
        SessionMemberService members = mock(SessionMemberService.class);
        ReflectionTestUtils.setField(script, "sessionMemberService", members);
        ReflectionTestUtils.invokeMethod(script, "increaseSessionMember", recovered);
        ArgumentCaptor<ByaiSessionMember> inserted = ArgumentCaptor.forClass(ByaiSessionMember.class);
        verify(members).save(inserted.capture());
        assertThat(inserted.getValue().getMemObjId()).isEqualTo(40L);
        verify(members, never()).findSessionMember(60L, "AGENT", 41L);
    }

    @Test
    void cannotReuseAnotherUsersMessage() {
        existing.setCreatorId(31L);
        assertThatThrownBy(() -> script.startExistingMessageTurn(dto, existing))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void projectionRetryDoesNotPersistTheAnswerTwice() {
        ScriptService service = spy(script);
        ChatProcessContext ctx = new ChatProcessContext(null, dto);
        ctx.sessionId = 60L;
        ctx.messageContext = new MessageContext(AgentTypeEnum.AGENT, 70L);
        ChatTurnPersistenceObserver observer = mock(ChatTurnPersistenceObserver.class);
        ObjectProvider<ChatTurnPersistenceObserver> provider = mock(ObjectProvider.class);
        when(provider.orderedStream()).thenAnswer(invocation -> Stream.of(observer));
        ReflectionTestUtils.setField(service, "turnPersistenceObservers", provider);
        doReturn(new ChatResponse()).when(service)
            .resolveMemory(ctx, dto, 60L, ctx.messageContext, ctx.resMsg);
        doThrow(new IllegalStateException("projection unavailable")).doNothing().when(observer).afterPersisted(ctx);
        assertThatThrownBy(() -> service.storeMessage(ctx)).isInstanceOf(IllegalStateException.class);
        service.storeMessage(ctx);
        verify(service, times(1)).resolveMemory(ctx, dto, 60L, ctx.messageContext, ctx.resMsg);
        verify(observer, times(2)).afterPersisted(ctx);
    }

    @Test
    void failedMessageWriteRemainsRetryableAndDoesNotPublish() {
        ScriptService service = spy(script);
        ChatProcessContext ctx = new ChatProcessContext(null, dto);
        ctx.sessionId = 60L;
        ChatTurnPersistenceObserver observer = mock(ChatTurnPersistenceObserver.class);
        ObjectProvider<ChatTurnPersistenceObserver> provider = mock(ObjectProvider.class);
        when(provider.orderedStream()).thenAnswer(invocation -> Stream.of(observer));
        ReflectionTestUtils.setField(service, "turnPersistenceObservers", provider);
        doThrow(new IllegalStateException("database unavailable")).when(service)
            .resolveMemory(ctx, dto, 60L, null, ctx.resMsg);
        assertThatThrownBy(() -> service.storeMessage(ctx)).isInstanceOf(IllegalStateException.class);
        assertThat(ctx.messagePersisted.get()).isFalse();
        verify(observer, never()).afterPersisted(any());
    }
}
