package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.springframework.test.util.ReflectionTestUtils;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import org.junit.jupiter.api.Test;

class FinalAnswerPersistenceTest {
    private final PythonSseService service = new PythonSseService();
    private final GatewayStreamEventProcessor processor = new GatewayStreamEventProcessor();

    @Test
    void historicalFinalStaysInItsOwnBatchAndWaitsForTerminalPersistence() {
        ReflectionTestUtils.setField(processor, "pythonSseService", service);
        ReflectionTestUtils.setField(processor, "sequenceService", mock(SequenceService.class));
        ReflectionTestUtils.setField(processor, "byaiMessageHotService", mock(ByaiMessageHotService.class));
        ReflectionTestUtils.setField(processor, "runningChatSnapshotService", mock(RunningChatSnapshotService.class));
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = 10L;
        ctx.traceId = TraceIdCodec.encode(30L, 31L);
        ctx.targetAgentType = "target";
        ctx.messageContext = new MessageContext();
        ctx.messageContext.getAnswerText().append("current");
        String historyTrace = TraceIdCodec.encode(11L, 12L);
        JSONObject event = new JSONObject();
        event.put("trace_id", historyTrace);
        event.put("source_agent_type", "target");
        event.put("event_type", "finalAnswer");
        event.put("final_content", "historical result");
        assertThat(processor.handleHistoryEventIfNecessary(ctx, event)).isTrue();
        Map<?, ?> batches = (Map<?, ?>) ReflectionTestUtils.getField(processor, "historyBatchMap");
        MessageContext historical = (MessageContext) ReflectionTestUtils.getField(
            batches.get("10:" + historyTrace), "messageContext");
        assertThat(historical.persistenceContent()).isEqualTo("historical result");
        assertThat(historical.getComplete()).isNotEqualTo(true);
        assertThat(ctx.messageContext.persistenceContent()).isEqualTo("current");
    }

    @Test
    void websocketLiveAndRecoveryReplayDoNotCompleteOnFinalAnswer() {
        for (boolean recovery : new boolean[] {false, true}) {
            SessionStreamEventRouter router = new SessionStreamEventRouter();
            OutputStreamManager contexts = mock(OutputStreamManager.class);
            ReflectionTestUtils.setField(router, "outputStreamManager", contexts);
            ReflectionTestUtils.setField(router, "multiDeviceBroadcastService", mock(MultiDeviceBroadcastService.class));
            ReflectionTestUtils.setField(router, "gatewayStreamEventProcessor", processor);
            ReflectionTestUtils.setField(router, "pythonSseService", service);
            ReflectionTestUtils.setField(router, "runningChatSnapshotWriteBehind", mock(RunningChatSnapshotWriteBehind.class));
            ReflectionTestUtils.setField(router, "cronService", mock(CronService.class));
            ChatProcessContext ctx = new ChatProcessContext(null, null);
            ctx.sessionId = 10L;
            ctx.userId = 1L;
            ctx.userMessageId = 11L;
            ctx.modelAnswerMessageId = 12L;
            ctx.traceId = "turn";
            ctx.targetAgentType = "target";
            ctx.transport = ChatTransport.WEBSOCKET;
            ctx.recoveryOnly = recovery;
            ctx.messageContext = new MessageContext();
            ctx.messageContext.getAnswerText().append("intermediate");
            when(contexts.getContext("10", "turn")).thenReturn(ctx);
            JSONObject event = JSON.parseObject("{\"session_id\":\"10\",\"trace_id\":\"turn\","
                + "\"source_agent_type\":\"target\",\"stream_id\":\"100-0\",\"event_type\":\"finalAnswer\","
                + "\"final_content\":\"final\"}");
            router.dispatch(event);
            router.dispatch(event);
            assertThat(ctx.messageContext.persistenceContent()).isEqualTo("final");
            assertThat(ctx.messageContext.returnAnswerText()).isEqualTo("intermediate");
            assertThat(ctx.messageContext.getComplete()).isNotEqualTo(true);
            assertThat(ctx.terminalStreamId).isNull();
        }
    }

    @Test
    void liveAndHistoryPreferExplicitFinalWithoutLosingStreamOrFinishingTurn() {
        for (boolean live : new boolean[] {true, false}) {
            MessageContext context = new MessageContext();
            String delta = "{\"event\":\"answerDelta\",\"data\":{\"contentType\":\"1001\",\"choices\":[{\"delta\":{\"content\":\"intermediate\"}}]}}";
            service.accumulateEvent(delta, context);
            int segments = context.getAnswerMessageList().size();
            String finalEvent = "{\"event\":\"finalAnswer\",\"data\":{\"content\":\"final body\"}}";
            if (live) {
                service.getContentFromPythonStreamV3(finalEvent, null, context, null, null);
            }
            else {
                service.accumulateEvent(finalEvent, context);
            }
            service.accumulateEvent(finalEvent, context);
            assertThat(context.persistenceContent()).isEqualTo("final body");
            assertThat(context.returnAnswerText()).isEqualTo("intermediate");
            assertThat(context.getAnswerMessageList()).hasSize(segments);
            assertThat(context.getComplete()).isNotEqualTo(true);
        }
    }

    @Test
    void invalidFinalBodiesKeepAccumulatedFallbackAndDoNotStringifyCards() {
        for (String data : new String[] {"{}", "{\"content\":\" \"}",
            "{\"content\":\"[DONE]\"}", "{\"content\":{\"title\":\"card\"}}"}) {
            MessageContext context = new MessageContext();
            context.getAnswerText().append("accumulated");
            service.accumulateEvent("{\"event\":\"final_answer\",\"data\":" + data + "}", context);
            assertThat(context.persistenceContent()).isEqualTo("accumulated");
            assertThat(context.getExplicitFinalAnswer()).isNull();
        }
    }

    @Test
    void gatewayPreservesTopLevelFinalAndNestedStringData() {
        for (String body : new String[] {"{\"final_content\":\"result\"}",
            "{\"data\":{\"choices\":[{\"delta\":{\"content\":\"result\"}}]}}",
            "{\"data\":\"{\\\"content\\\":\\\"result\\\"}\"}"}) {
            JSONObject event = JSON.parseObject(body);
            event.put("event_type", "final_answer");
            String normalized = processor.buildEventData(null, event, null);
            JSONObject line = new JSONObject();
            line.put("event", "final_answer");
            line.put("data", normalized);
            MessageContext context = new MessageContext();
            service.accumulateEvent(line.toJSONString(), context);
            assertThat(context.persistenceContent()).isEqualTo("result");
            assertThat(context.hasPersistableContent()).isTrue();
        }
    }

    @Test
    void nonTargetFinalAndWrongTraceCannotOverrideCurrentFinal() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setTraceId("current");
        ctx.setTargetAgentType("target");
        JSONObject gatewayEvent = JSON.parseObject("{\"source_agent_type\":\"delegate\"}");
        assertThat(processor.shouldIgnoreEvent(ctx, "finalAnswer", gatewayEvent)).isTrue();
        MessageContext context = new MessageContext();
        context.setExplicitFinalAnswer("owned");
        service.getContentFromPythonStreamV3(
            "{\"event\":\"finalAnswer\",\"trace_id\":\"old\",\"data\":{\"content\":\"foreign\"}}",
            null, context, null, ctx);
        assertThat(context.persistenceContent()).isEqualTo("owned");
    }
}
