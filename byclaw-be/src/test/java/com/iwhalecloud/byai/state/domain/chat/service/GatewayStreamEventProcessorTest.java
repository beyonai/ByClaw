package com.iwhalecloud.byai.state.domain.chat.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GatewayStreamEventProcessorTest {

    private final GatewayStreamEventProcessor processor = new GatewayStreamEventProcessor();

    @Test
    void normalizeEventType_preservesExplicitParentAssistantOutput() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setTargetAgentType("target-agent");

        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "parent");
        metadata.put("event_kind", "assistant.chunk");

        JSONObject dataJson = new JSONObject();
        dataJson.put("event_type", SseResponseEventEnum.answerDelta);
        dataJson.put("source_agent_type", "gateway-agent");
        dataJson.put("metadata", metadata);

        assertThat(processor.normalizeEventType(ctx, dataJson)).isEqualTo(SseResponseEventEnum.answerDelta);
    }

    @Test
    void normalizeEventType_preservesTeamScopeAnswerProjection() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setTargetAgentType("target-agent");

        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "team");
        metadata.put("event_kind", "activity.snapshot");

        JSONObject dataJson = new JSONObject();
        dataJson.put("event_type", SseResponseEventEnum.answerDelta);
        dataJson.put("source_agent_type", "gateway-agent");
        dataJson.put("metadata", metadata);

        assertThat(processor.normalizeEventType(ctx, dataJson)).isEqualTo(SseResponseEventEnum.answerDelta);
    }

    @Test
    void normalizeEventType_preservesAnyExplicitSemanticProjection() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setTargetAgentType("target-agent");

        JSONObject metadata = new JSONObject();
        metadata.put("session_scope", "parent");
        metadata.put("event_kind", "todo/write");

        JSONObject dataJson = new JSONObject();
        dataJson.put("event_type", SseResponseEventEnum.answerDelta);
        dataJson.put("source_agent_type", "external-agent");
        dataJson.put("metadata", metadata);

        assertThat(processor.normalizeEventType(ctx, dataJson)).isEqualTo(SseResponseEventEnum.answerDelta);
    }

    @Test
    void normalizeEventType_keepsLegacyNonTargetAnswerAsReasoningWithoutExplicitScope() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setTargetAgentType("target-agent");

        JSONObject dataJson = new JSONObject();
        dataJson.put("event_type", SseResponseEventEnum.answerDelta);
        dataJson.put("source_agent_type", "gateway-agent");

        assertThat(processor.normalizeEventType(ctx, dataJson)).isEqualTo(SseResponseEventEnum.reasoningLogDelta);
    }

    @Test
    void buildEventData_preservesLaneMetadataFromGatewayMetadata() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setSessionId(3L);
        ctx.setUserMessageId(11L);
        String traceId = TraceIdCodec.encode(11L, 21L);

        JSONObject laneMetadata = laneMetadata(traceId);
        JSONObject metadata = new JSONObject();
        metadata.put("multi_agent", laneMetadata);

        JSONObject dataJson = new JSONObject();
        dataJson.put("trace_id", traceId);
        dataJson.put("stream_id", "stream-1");
        dataJson.put("source_agent_type", "BYCLAW_EXE_u1");
        dataJson.put("data", answerDelta().toJSONString());

        String eventData = processor.buildEventData(ctx, dataJson, metadata);

        JSONObject payload = JSON.parseObject(eventData);
        assertThat(payload)
            .containsEntry("laneId", "lane-a")
            .containsEntry("turnId", "turn-1")
            .containsEntry("mode", "parallel")
            .containsEntry("clientRequestId", "client-a")
            .containsEntry("queryMessageId", "11")
            .containsEntry("answerMessageId", "21")
            .containsEntry("agentName", "Agent A")
            .containsEntry("traceId", traceId);

        AnswerDelta answerDelta = JSON.parseObject(eventData, AnswerDelta.class);
        JSONObject roundTripPayload = JSON.parseObject(JSON.toJSONString(answerDelta));
        assertThat(roundTripPayload)
            .containsEntry("laneId", "lane-a")
            .containsEntry("turnId", "turn-1")
            .containsEntry("clientRequestId", "client-a")
            .containsEntry("agentName", "Agent A");
    }

    @Test
    void buildEventData_preservesLaneMetadataFromGatewayPayload() {
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setSessionId(3L);
        ctx.setUserMessageId(11L);
        String traceId = TraceIdCodec.encode(11L, 21L);

        JSONObject answerDelta = answerDelta();
        answerDelta.put("multi_agent", laneMetadata(traceId));

        JSONObject dataJson = new JSONObject();
        dataJson.put("trace_id", traceId);
        dataJson.put("stream_id", "stream-1");
        dataJson.put("data", answerDelta.toJSONString());

        JSONObject payload = JSON.parseObject(processor.buildEventData(ctx, dataJson, null));

        assertThat(payload)
            .containsEntry("laneId", "lane-a")
            .containsEntry("turnId", "turn-1")
            .containsEntry("clientRequestId", "client-a")
            .containsEntry("agentName", "Agent A")
            .containsEntry("traceId", traceId);
    }

    private JSONObject answerDelta() {
        JSONObject answerDelta = new JSONObject();
        answerDelta.put("contentType", "1002");
        answerDelta.put("choices", JSON.parseArray("[]"));
        return answerDelta;
    }

    private JSONObject laneMetadata(String traceId) {
        JSONObject laneMetadata = new JSONObject();
        laneMetadata.put("turnId", "turn-1");
        laneMetadata.put("laneId", "lane-a");
        laneMetadata.put("mode", "parallel");
        laneMetadata.put("clientRequestId", "client-a");
        laneMetadata.put("queryMessageId", "11");
        laneMetadata.put("answerMessageId", "21");
        laneMetadata.put("agentId", 101L);
        laneMetadata.put("agentName", "Agent A");
        laneMetadata.put("traceId", traceId);
        return laneMetadata;
    }
}
