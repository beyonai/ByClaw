package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

class SessionStreamRenderVersionTest {
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void headlessLiveAndRecoveredTurnsBroadcastV2AndTheActualPersistedSegmentSequence(boolean recovery) {
        SessionStreamEventRouter router = new SessionStreamEventRouter();
        OutputStreamManager contexts = mock(OutputStreamManager.class);
        MultiDeviceBroadcastService broadcast = mock(MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(router, "outputStreamManager", contexts);
        ReflectionTestUtils.setField(router, "multiDeviceBroadcastService", broadcast);
        // 使用真实事件归一化与聚合器，避免 mock 掩盖广播从原始事件重建导致的字段丢失。
        ReflectionTestUtils.setField(router, "gatewayStreamEventProcessor", new GatewayStreamEventProcessor());
        ReflectionTestUtils.setField(router, "pythonSseService", new PythonSseService());
        ReflectionTestUtils.setField(router, "runningChatSnapshotWriteBehind", mock(RunningChatSnapshotWriteBehind.class));
        ReflectionTestUtils.setField(router, "cronService", mock(CronService.class));
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 20071499L;
        ctx.userId = 10000029L;
        ctx.userMessageId = 20071503L;
        ctx.modelAnswerMessageId = 20071505L;
        ctx.traceId = "task-trace";
        ctx.clientRequestId = "20071503_20071505";
        ctx.targetAgentType = "target";
        ctx.transport = ChatTransport.WEBSOCKET;
        ctx.recoveryOnly = recovery;
        ctx.messageContext = new MessageContext(AgentTypeEnum.AGENT, ctx.modelAnswerMessageId, 1L);
        when(contexts.getContext("20071499", "task-trace")).thenReturn(ctx);

        router.dispatch(event("reasoningLogDelta", "查找新闻", "100-0"));
        router.dispatch(event("answerDelta", "新闻", "101-0"));
        router.dispatch(event("answerDelta", "摘要", "102-0"));

        ArgumentCaptor<JSONObject> events = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcast, times(3)).broadcastRawEvent(eq(ctx.userId), eq(ctx.sessionId), events.capture(),
            isNull(), eq(ctx.clientRequestId));
        List<JSONObject> payloads = events.getAllValues().stream()
            .map(event -> JSON.parseObject(event.getString("data"))).toList();
        assertThat(payloads).allSatisfy(payload -> assertThat(payload.getString("messageRenderVersion")).isEqualTo("v2"));
        assertThat(payloads.get(0).getLong("seq")).isEqualTo(ctx.messageContext.getReasonMessageList().get(0).getSeq());
        assertThat(payloads.get(1).getLong("seq")).isEqualTo(ctx.messageContext.getAnswerMessageList().get(0).getSeq());
        assertThat(payloads.get(2).getLong("seq")).isEqualTo(payloads.get(1).getLong("seq"));
        assertThat(payloads.get(2).getJSONArray("choices").getJSONObject(0).getJSONObject("delta").getString("content"))
            .isEqualTo("摘要");
        assertThat(events.getAllValues().get(2).getString("stream_id")).isEqualTo("102-0");
        assertThat(ctx.messageContext.getAnswerMessageList()).hasSize(1);
        assertThat(ctx.messageContext.getAnswerMessageList().get(0).getChoices().get(0).getDelta().getContent())
            .isEqualTo("新闻摘要");
    }

    private JSONObject event(String type, String content, String streamId) {
        JSONObject event = new JSONObject();
        event.put("session_id", "20071499");
        event.put("trace_id", "task-trace");
        event.put("source_agent_type", "target");
        event.put("stream_id", streamId);
        event.put("event_type", type);
        JSONObject payload = new JSONObject();
        payload.put("contentType", "1002");
        JSONObject delta = new JSONObject();
        delta.put("content", content);
        JSONObject choice = new JSONObject();
        choice.put("delta", delta);
        payload.put("choices", List.of(choice));
        event.put("data", payload.toJSONString());
        return event;
    }
}
