package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
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
 * 验证 recoveryOnly 续聚合的水位线去重逻辑：
 * stream_id &lt;= hydratedStreamId 的事件已计入快照，应跳过 accumulate；&gt; 水位线的事件才追加。
 */
class SessionStreamEventRouterRecoveryTest {

    private OutputStreamManager outputStreamManager;
    private PythonSseService pythonSseService;
    private GatewayStreamEventProcessor gatewayStreamEventProcessor;
    private SessionStreamEventRouter router;

    @BeforeEach
    void setUp() {
        router = new SessionStreamEventRouter();
        outputStreamManager = mockField("outputStreamManager", OutputStreamManager.class);
        pythonSseService = mockField("pythonSseService", PythonSseService.class);
        gatewayStreamEventProcessor = mockField("gatewayStreamEventProcessor", GatewayStreamEventProcessor.class);
        mockField("runningChatSnapshotWriteBehind", RunningChatSnapshotWriteBehind.class);
        mockField("multiDeviceBroadcastService",
            com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        mockField("chatContextRecoveryService", ChatContextRecoveryService.class);
        mockField("cronService", CronService.class);

        // 让事件顺利走到 recoveryOnly 分支：非历史、非忽略、事件类型为 answerDelta。
        when(gatewayStreamEventProcessor.handleHistoryEventIfNecessary(any(), any())).thenReturn(false);
        when(gatewayStreamEventProcessor.normalizeEventType(any(), any())).thenReturn(SseResponseEventEnum.answerDelta);
        when(gatewayStreamEventProcessor.shouldIgnoreEvent(any(), anyString(), any())).thenReturn(false);
        when(gatewayStreamEventProcessor.buildEventData(any(), any(), any())).thenReturn("{\"text\":\"x\"}");
    }

    private <T> T mockField(String name, Class<T> type) {
        T mock = Mockito.mock(type);
        ReflectionTestUtils.setField(router, name, mock);
        return mock;
    }

    private ChatProcessContext recoveryCtx(String hydratedStreamId) {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.traceId = "trace-1";
        ctx.transport = ChatTransport.WEBSOCKET;
        ctx.recoveryOnly = true;
        ctx.hydratedStreamId = hydratedStreamId;
        ctx.runningOutputStreamToken = "token";
        ctx.messageContext = new MessageContext(AgentTypeEnum.AGENT, 1L, 1L);
        when(outputStreamManager.getContext("10")).thenReturn(ctx);
        return ctx;
    }

    private JSONObject event(String streamId) {
        JSONObject json = new JSONObject();
        json.put("session_id", "10");
        json.put("trace_id", "trace-1");
        json.put("event_type", "answerDelta");
        json.put("stream_id", streamId);
        return json;
    }

    @Test
    void skipsEventAtOrBelowWatermark() {
        recoveryCtx("100-0");
        // stream_id == 水位线 → 已计入快照，应跳过。
        router.dispatch(event("100-0"));
        // stream_id < 水位线 → 同样跳过。
        router.dispatch(event("50-0"));
        verify(pythonSseService, never()).accumulateEvent(anyString(), any());
    }

    @Test
    void accumulatesEventAboveWatermark() {
        recoveryCtx("100-0");
        router.dispatch(event("101-0"));
        verify(pythonSseService, times(1)).accumulateEvent(anyString(), any());
    }

    @Test
    void accumulatesWhenNoWatermark() {
        recoveryCtx(null);
        router.dispatch(event("1-0"));
        verify(pythonSseService, times(1)).accumulateEvent(anyString(), any());
    }

    @Test
    void watermarkDoesNotRegressWhenSkippingOldEvent() {
        ChatProcessContext ctx = recoveryCtx("100-0");
        // 重新投递的旧 pending：跳过聚合，但内存水位线不应被拉低到 50-0（#3）。
        router.dispatch(event("50-0"));
        verify(pythonSseService, never()).accumulateEvent(anyString(), any());
        org.junit.jupiter.api.Assertions.assertEquals("100-0", ctx.hydratedStreamId);
    }

    @Test
    void watermarkAdvancesAfterNewEvent() {
        ChatProcessContext ctx = recoveryCtx("100-0");
        router.dispatch(event("105-0"));
        verify(pythonSseService, times(1)).accumulateEvent(anyString(), any());
        org.junit.jupiter.api.Assertions.assertEquals("105-0", ctx.hydratedStreamId);
    }

    @Test
    void skipsLiveEventAlreadyIncludedInSnapshotWatermark() {
        ChatProcessContext ctx = recoveryCtx("100-0");
        ctx.recoveryOnly = false;
        router.dispatch(event("50-0"));
        verify(pythonSseService, never()).getContentFromPythonStreamV3(anyString(), any(), any(), any(), any());
    }
}
