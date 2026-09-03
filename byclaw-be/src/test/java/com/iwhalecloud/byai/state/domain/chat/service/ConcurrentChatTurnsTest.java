package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;

class ConcurrentChatTurnsTest {
    private final OutputStreamManager outputs = new OutputStreamManager();
    private final ChatRuntimeStateService states = mock(ChatRuntimeStateService.class);
    private final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
    private SessionStreamManager streams;
    private ChatProcessContext background;
    private ChatProcessContext followup;

    @BeforeEach
    void setUp() {
        streams = spy(new SessionStreamManager());
        ApplicationContext beans = mock(ApplicationContext.class);
        when(beans.getBean(RunningOutputStreamRegistry.class)).thenReturn(running);
        ReflectionTestUtils.setField(streams, "applicationContext", beans);
        ReflectionTestUtils.setField(streams, "outputStreamManager", outputs);
        ReflectionTestUtils.setField(streams, "chatRuntimeStateService", states);
        when(states.getSessionTurns(10L)).thenReturn(List.of());
        doNothing().when(streams).stopSessionListener(anyString());
        doReturn(true).when(streams).isSessionListenerActive("10");
        background = context("background", false);
        followup = context("followup", true);
        outputs.putContext("10", background);
    }

    @Test
    void foregroundCompletionKeepsBackgroundOutputAndListener() {
        outputs.putContext("10", followup);
        assertThat(streams.completeSessionTurn(followup)).isFalse();
        assertThat(outputs.getContext("10", "background")).isSameAs(background);
        assertThat(outputs.getContext("10", "followup")).isNull();
        verify(streams, never()).stopSessionListener(anyString());
        verify(running, never()).markRunning(any());
        verify(states).delete(followup);
        assertThat(streams.completeSessionTurn(background)).isTrue();
        verify(streams).stopSessionListener("10");
    }

    @Test
    void backgroundCompletionPromotesForegroundAndLateCleanupCannotRemoveIt() {
        outputs.putContext("10", followup);
        assertThat(streams.completeSessionTurn(background)).isFalse();
        verify(running).markRunning(followup);
        assertThat(streams.completeSessionTurn(background)).isFalse();
        assertThat(outputs.getContext("10", "followup")).isSameAs(followup);
        verify(streams, never()).stopSessionListener(anyString());
        assertThat(streams.completeSessionTurn(followup)).isTrue();
    }

    @Test
    void delayedContextRemovalDoesNotDeleteAReplacementWithTheSameTrace() {
        outputs.putContext("10", followup);
        ChatProcessContext recovered = context("followup", true);
        outputs.putContext("10", recovered);
        outputs.removeContext("10", followup);
        assertThat(outputs.getContext("10", "followup")).isSameAs(recovered);
        assertThat(outputs.getContext("10")).isSameAs(background);
    }

    @Test
    void idleRootFollowupRegistersItsOwnDurableContextBeforeDispatch() {
        ChatStreamRuntimeCoordinator coordinator = coordinator(true);
        assertThat(coordinator.startIfNecessary(followup)).isTrue();
        assertThat(followup.sendByFrameworkMsgOnly).isFalse();
        assertThat(outputs.getContext("10", "background")).isSameAs(background);
        assertThat(outputs.getContext("10", "followup")).isSameAs(followup);
        verify(states).saveConcurrent(followup);
        verify(streams, never()).startSessionListener(anyString(), any());
        verify(running, never()).markRunning(any());
    }

    @Test
    void remoteListenerUsesDurableTraceRegistrationWithoutASecondLocalConsumer() {
        ChatStreamRuntimeCoordinator coordinator = coordinator(false);
        assertThat(coordinator.startIfNecessary(followup)).isTrue();
        verify(states).saveConcurrent(followup);
        assertThat(outputs.getContext("10", "followup")).isNull();
        assertThat(followup.sendByFrameworkMsgOnly).isFalse();
    }

    @Test
    void failedRemoteSendCleansOnlyItsTraceWithoutTakingListenerOwnership() {
        outputs.removeContext("10");
        doReturn(false).when(streams).isSessionListenerActive("10");
        assertThat(streams.completeSessionTurn(followup)).isFalse();
        verify(states).delete(followup);
        verify(states, never()).getSessionTurns(any());
        verify(running, never()).markRunning(any());
        verify(streams, never()).stopSessionListener(anyString());
        assertThat(outputs.getContexts("10")).isEmpty();
    }

    @Test
    void remoteHttpFollowupFailsBeforeDispatchInsteadOfWaitingOnAnOrphanQueue() {
        ChatStreamRuntimeCoordinator coordinator = coordinator(false);
        followup.transport = ChatTransport.HTTP_SSE;
        ReflectionTestUtils.setField(coordinator, "gatewayEventQueueCapacity", 4);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> coordinator.startIfNecessary(followup))
            .hasMessageContaining("请重新连接后再试");
        verify(states, never()).saveConcurrent(any());
    }

    @Test
    void interleavedEventsReachTheirOwnTurnQueues() {
        SessionStreamEventRouter router = new SessionStreamEventRouter();
        ReflectionTestUtils.setField(router, "outputStreamManager", outputs);
        ReflectionTestUtils.setField(router, "cronService", mock(CronService.class));
        ReflectionTestUtils.setField(router, "gatewayStreamEventProcessor", mock(GatewayStreamEventProcessor.class));
        ReflectionTestUtils.setField(router, "chatContextRecoveryService", mock(ChatContextRecoveryService.class));
        ReflectionTestUtils.setField(router, "multiDeviceBroadcastService",
            mock(com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class));
        for (ChatProcessContext ctx : List.of(background, followup)) {
            ctx.transport = ChatTransport.HTTP_SSE;
            ctx.gatewayEventQueue = new java.util.concurrent.ArrayBlockingQueue<>(4);
        }
        outputs.putContext("10", followup);
        JSONObject first = event("background", "answerDelta");
        JSONObject second = event("followup", "appStreamResponse");
        JSONObject third = event("background", "answerDelta");
        router.dispatch(first);
        router.dispatch(second);
        router.dispatch(third);
        assertThat(background.gatewayEventQueue).containsExactly(first, third);
        assertThat(followup.gatewayEventQueue).containsExactly(second);
    }

    private ChatStreamRuntimeCoordinator coordinator(boolean localListener) {
        ChatStreamRuntimeCoordinator coordinator = new ChatStreamRuntimeCoordinator();
        ReflectionTestUtils.setField(coordinator, "outputStreamManager", outputs);
        ReflectionTestUtils.setField(coordinator, "sessionStreamManager", streams);
        ReflectionTestUtils.setField(coordinator, "runningOutputStreamRegistry", running);
        ReflectionTestUtils.setField(coordinator, "chatRuntimeStateService", states);
        RunningChatInfo status = new RunningChatInfo();
        status.setRunning(true);
        when(running.getRunning(10L)).thenReturn(status);
        doReturn(localListener).when(streams).isSessionListenerActive("10");
        return coordinator;
    }

    private ChatProcessContext context(String trace, boolean concurrent) {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.traceId = trace;
        ctx.concurrentGatewayTurn = concurrent;
        ctx.transport = ChatTransport.WEBSOCKET;
        return ctx;
    }

    private JSONObject event(String trace, String type) {
        JSONObject event = new JSONObject();
        event.put("session_id", "10");
        event.put("trace_id", trace);
        event.put("event_type", type);
        return event;
    }
}
