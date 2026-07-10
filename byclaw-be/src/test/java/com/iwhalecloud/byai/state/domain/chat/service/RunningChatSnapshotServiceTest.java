package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.Date;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;

class RunningChatSnapshotServiceTest {

    private final RunningChatSnapshotService runningChatSnapshotService = new RunningChatSnapshotService();

    @Test
    void buildSnapshot_usesFirstResponseTimeAsCreateTimeWhenPresent() {
        Date firstResponseTime = new Date(1000L);
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.getAnswerText().append("answer");
        messageContext.markFirstResponseTimeIfAbsent(firstResponseTime);

        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setSessionId(3L);
        ctx.setTraceId("trace-1");
        ctx.setModelAnswerMessageId(21L);
        ctx.setMessageContext(messageContext);

        RunningChatSnapshotResponse snapshot = ReflectionTestUtils.invokeMethod(runningChatSnapshotService,
            "buildSnapshot", ctx);

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.getCreateTime()).isEqualTo(firstResponseTime);
    }

    @Test
    void buildSnapshot_usesLaneMessageContextAndLaneClientRequestId() {
        Date globalResponseTime = new Date(5000L);
        MessageContext globalMessageContext = new MessageContext();
        globalMessageContext.setMessageId(21L);
        globalMessageContext.markFirstResponseTimeIfAbsent(globalResponseTime);

        Date laneResponseTime = new Date(1000L);
        MessageContext laneMessageContext = new MessageContext();
        laneMessageContext.setMessageId(22L);
        laneMessageContext.getAnswerText().append("lane answer");
        laneMessageContext.markFirstResponseTimeIfAbsent(laneResponseTime);

        String traceId = "trace-lane";
        JSONObject laneMetadata = new JSONObject();
        laneMetadata.put("clientRequestId", "client-lane");

        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setSessionId(3L);
        ctx.setTraceId("trace-global");
        ctx.setClientRequestId("client-global");
        ctx.setModelAnswerMessageId(21L);
        ctx.setMessageContext(globalMessageContext);
        ctx.getMultiAgentLaneMetadataByTraceId().put(traceId, laneMetadata);

        RunningChatSnapshotResponse snapshot = ReflectionTestUtils.invokeMethod(runningChatSnapshotService,
            "buildSnapshot", ctx, traceId, laneMessageContext, 22L, "client-lane");

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.getTraceId()).isEqualTo(traceId);
        assertThat(snapshot.getClientRequestId()).isEqualTo("client-lane");
        assertThat(snapshot.getMessageId()).isEqualTo(22L);
        assertThat(snapshot.getCreateTime()).isEqualTo(laneResponseTime);
        assertThat(snapshot.getMessageContent()).isEqualTo("lane answer");
    }

    @Test
    void get_doesNotFallbackToArbitrarySessionSnapshotWhenTraceMisses() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get("byai:chat:running:snapshot:3:trace-missing")).thenReturn(null);
        when(redisTemplate.keys("byai:chat:running:snapshot:3:*"))
            .thenReturn(Collections.singleton("byai:chat:running:snapshot:3:trace-other"));

        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);

        RunningChatSnapshotResponse snapshot = service.get(3L, "trace-missing", null);

        assertThat(snapshot).isNull();
        verify(redisTemplate, never()).keys("byai:chat:running:snapshot:3:*");
    }
}
