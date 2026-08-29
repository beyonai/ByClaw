package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;

/**
 * 验证 live 链路的 Stream ID 幂等：
 * 增量事件重投不得重复推送 WebSocket；terminal 事件重投必须仍被识别为 terminal，
 * 否则消息会被 ACK 移出 PEL 而永不落库。
 */
class SessionStreamEventRouterLiveDedupTest {

    private OutputStreamManager outputStreamManager;
    private PythonSseService pythonSseService;
    private GatewayStreamEventProcessor gatewayStreamEventProcessor;
    private RunningChatSnapshotWriteBehind runningChatSnapshotWriteBehind;
    private TerminalPersistMarkerService terminalPersistMarkerService;
    private SessionStreamEventRouter router;

    @BeforeEach
    void setUp() {
        router = new SessionStreamEventRouter();
        outputStreamManager = mockField("outputStreamManager", OutputStreamManager.class);
        pythonSseService = mockField("pythonSseService", PythonSseService.class);
        gatewayStreamEventProcessor = mockField("gatewayStreamEventProcessor", GatewayStreamEventProcessor.class);
        runningChatSnapshotWriteBehind = mockField("runningChatSnapshotWriteBehind",
            RunningChatSnapshotWriteBehind.class);
        mockField("multiDeviceBroadcastService",
            com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        mockField("chatContextRecoveryService", ChatContextRecoveryService.class);
        mockField("cronService", CronService.class);
        terminalPersistMarkerService = mockField("terminalPersistMarkerService", TerminalPersistMarkerService.class);

        when(gatewayStreamEventProcessor.handleHistoryEventIfNecessary(any(), any())).thenReturn(false);
        when(gatewayStreamEventProcessor.shouldIgnoreEvent(any(), anyString(), any())).thenReturn(false);
        when(gatewayStreamEventProcessor.buildEventData(any(), any(), any())).thenReturn("{\"text\":\"x\"}");
    }

    private <T> T mockField(String name, Class<T> type) {
        T mock = Mockito.mock(type);
        ReflectionTestUtils.setField(router, name, mock);
        return mock;
    }

    private ChatProcessContext liveCtx(String hydratedStreamId) {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.traceId = "trace-1";
        ctx.transport = ChatTransport.WEBSOCKET;
        ctx.recoveryOnly = false;
        ctx.hydratedStreamId = hydratedStreamId;
        ctx.messageContext = new MessageContext(AgentTypeEnum.AGENT, 1L, 1L);
        when(outputStreamManager.getContext("10")).thenReturn(ctx);
        return ctx;
    }

    private JSONObject event(String streamId, String eventType) {
        JSONObject dataJson = new JSONObject();
        dataJson.put("session_id", "10");
        dataJson.put("event_type", eventType);
        dataJson.put("trace_id", "trace-1");
        dataJson.put("stream_id", streamId);
        return dataJson;
    }

    @Test
    void liveIncrementalReplayIsNotPushedTwice() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.answerDelta);
        liveCtx("100-0");

        StreamDispatchResult result = router.dispatch(event("100-0", SseResponseEventEnum.answerDelta));

        verify(pythonSseService, never()).getContentFromPythonStreamV3(anyString(), any(), any(), any(), any());
        assertThat(result.shouldAcknowledge()).isTrue();
        assertThat(result.isTerminal()).isFalse();
    }

    @Test
    void liveIncrementalBeyondWatermarkIsPushed() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.answerDelta);
        liveCtx("100-0");

        router.dispatch(event("101-0", SseResponseEventEnum.answerDelta));

        verify(pythonSseService).getContentFromPythonStreamV3(anyString(), any(), any(), any(), any());
    }

    /**
     * ACK 失败后同一进程内重投：terminalStreamId 仍在内存中，应识别为 terminal 且不重复推送。
     */
    @Test
    void liveTerminalReplayInSameProcessStaysTerminal() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.appStreamResponse);
        ChatProcessContext ctx = liveCtx(null);

        StreamDispatchResult first = router.dispatch(event("100-0", SseResponseEventEnum.appStreamResponse));
        assertThat(first.isTerminal()).isTrue();
        assertThat(ctx.terminalStreamId).isEqualTo("100-0");

        StreamDispatchResult replay = router.dispatch(event("100-0", SseResponseEventEnum.appStreamResponse));

        assertThat(replay.isTerminal()).as("同进程 terminal 重投应仍为 terminal").isTrue();
        assertThat(replay.getContext()).isNotNull();
    }

    @Test
    void terminalSnapshotIsSavedAfterMessageContextBecomesComplete() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.appStreamResponse);
        liveCtx(null);
        doAnswer(invocation -> {
            MessageContext snapshotContext = invocation.getArgument(3);
            assertThat(snapshotContext.getComplete()).isTrue();
            return null;
        }).when(runningChatSnapshotWriteBehind).flushNow(anyString(), any(), anyString(), any());

        router.dispatch(event("100-0", SseResponseEventEnum.appStreamResponse));

        verify(runningChatSnapshotWriteBehind).flushNow(anyString(), any(), anyString(), any());
    }

    /**
     * 重启恢复后的 terminal 重投：hydratedStreamId 从快照恢复并已覆盖该事件，
     * 但 terminalStreamId 是内存字段，重启后为 null。此时若返回非 terminal，
     * 消息会被 ACK 移出 PEL，而落库从未发生，回答永久丢失。
     */
    @Test
    void terminalReplayAfterRestartStaysTerminal() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.appStreamResponse);
        ChatProcessContext ctx = liveCtx("100-0");
        ctx.terminalStreamId = null;

        StreamDispatchResult result = router.dispatch(event("100-0", SseResponseEventEnum.appStreamResponse));

        assertThat(result.isTerminal())
            .as("重启后 terminal 重投必须仍被识别为 terminal，否则消息被 ACK 且永不落库")
            .isTrue();
        assertThat(result.getContext()).isNotNull();
    }

    /**
     * 落库已完成、仅 ACK 失败后重启重投：应识别为 terminal 但标记为已落库，
     * 由 processor 跳过重复落库，只补 ACK 与收尾。
     */
    @Test
    void terminalReplayAfterRestartSkipsDuplicatePersistWhenMarked() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.appStreamResponse);
        ChatProcessContext ctx = liveCtx("100-0");
        ctx.terminalStreamId = null;
        when(terminalPersistMarkerService.isPersisted(10L, "100-0")).thenReturn(true);

        StreamDispatchResult result = router.dispatch(event("100-0", SseResponseEventEnum.appStreamResponse));

        assertThat(result.isTerminal()).isTrue();
        assertThat(result.isAlreadyPersisted())
            .as("已落库的 terminal 重投不应再次落库")
            .isTrue();
    }

    /**
     * 最终 error 事件在重启后重投，同样必须触发收尾。
     */
    @Test
    void terminalErrorReplayAfterRestartStaysTerminal() {
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any()))
            .thenReturn(SseResponseEventEnum.error);
        ChatProcessContext ctx = liveCtx("100-0");
        ctx.terminalStreamId = null;

        StreamDispatchResult result = router.dispatch(event("100-0", SseResponseEventEnum.error));

        assertThat(result.isTerminal())
            .as("重启后最终 error 重投必须仍被识别为 terminal")
            .isTrue();
    }
}
