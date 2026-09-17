package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.any;

import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.SessionCallback;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.enums.MsgStatus;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import org.mockito.ArgumentCaptor;

class RunningChatSnapshotServiceTest {

    private final RunningChatSnapshotService runningChatSnapshotService = new RunningChatSnapshotService();

    @Test
    void missingExternalChildSnapshotDoesNotSearchTheRedisKeyspace() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> values = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(values);
        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);

        assertThat(service.getExternalChildSnapshot(20L, 21L)).isNull();

        verify(values).get("byai:chat:running:snapshot:20:external-child-20");
        verify(redisTemplate, never()).keys(anyString());
    }

    @Test
    void missingExternalChildContextDoesNotSearchTheRedisKeyspaceDuringFirstEventRecovery() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> values = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(values);
        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(20L);
        state.setTraceId("external-child-20");
        state.setModelAnswerMessageId(21L);

        assertThat(service.hydrateMessageContext(state, new String[1])).isNull();

        verify(values).get("byai:chat:running:snapshot:20:external-child-20");
        verify(redisTemplate, never()).keys(anyString());
    }

    @Test
    void historicalMissAndMessageLookupNeverSearchRedisKeyspace() {
        RedisTemplate<String, Object> redis = mock(RedisTemplate.class);
        ValueOperations<String, Object> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        ReflectionTestUtils.setField(runningChatSnapshotService, "redisTemplate", redis);
        assertThat(runningChatSnapshotService.get(3L, "expired-history", 21L)).isNull();
        assertThat(runningChatSnapshotService.findByMessageId(21L)).isNull();
        assertThat(runningChatSnapshotService.get(3L, null, null)).isNull();
        runningChatSnapshotService.delete(3L, 21L);
        verify(redis, never()).keys(anyString());
    }

    @Test
    void staleMessagePointerCannotReturnAnotherMessageAfterTraceKeyReuse() {
        RedisTemplate<String, Object> redis = mock(RedisTemplate.class);
        ValueOperations<String, Object> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get("byai:chat:running:message:21")).thenReturn("byai:chat:running:snapshot:3:trace-reused");
        RunningChatSnapshotResponse replacement = new RunningChatSnapshotResponse();
        replacement.setSessionId(3L);
        replacement.setModelAnswerMessageId(22L);
        when(values.get("byai:chat:running:snapshot:3:trace-reused"))
            .thenReturn(JSONObject.toJSONString(replacement));
        ReflectionTestUtils.setField(runningChatSnapshotService, "redisTemplate", redis);
        assertThat(runningChatSnapshotService.findByMessageId(21L)).isNull();
        assertThat(runningChatSnapshotService.get(3L, "trace-reused", 21L)).isNull();
    }

    @Test
    void saveMakesSnapshotDiscoverableByMessageWithoutKeyspaceSearch() {
        RedisTemplate<String, Object> redis = mock(RedisTemplate.class);
        ValueOperations<String, Object> values = mock(ValueOperations.class);
        java.util.Map<String, Object> stored = new java.util.HashMap<>();
        when(redis.opsForValue()).thenReturn(values);
        org.mockito.Mockito.doAnswer(call -> {
            stored.put(call.getArgument(0), call.getArgument(1));
            return null;
        }).when(values).set(anyString(), any(), org.mockito.ArgumentMatchers.anyLong(), any(TimeUnit.class));
        when(values.get(anyString())).thenAnswer(call -> stored.get(call.getArgument(0)));
        ReflectionTestUtils.setField(runningChatSnapshotService, "redisTemplate", redis);
        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.sessionId = 3L;
        ctx.traceId = "trace-indexed";
        ctx.modelAnswerMessageId = 21L;
        ctx.messageContext = new MessageContext();
        ctx.messageContext.setMessageId(21L);
        ctx.messageContext.getAnswerText().append("indexed answer");
        runningChatSnapshotService.save(ctx);
        assertThat(runningChatSnapshotService.findByMessageId(21L)).isNotNull()
            .extracting(RunningChatSnapshotResponse::getMessageContent).isEqualTo("indexed answer");
        verify(redis, never()).keys(anyString());
    }

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
    void buildSnapshotMarksCompletedMessageAsTerminal() {
        MessageContext messageContext = new MessageContext();
        messageContext.setMessageId(21L);
        messageContext.setComplete(true);

        ChatProcessContext ctx = new ChatProcessContext(null, new AssistantChatDto());
        ctx.setSessionId(3L);
        ctx.setTraceId("trace-1");
        ctx.setModelAnswerMessageId(21L);
        ctx.setMessageContext(messageContext);

        RunningChatSnapshotResponse snapshot = ReflectionTestUtils.invokeMethod(runningChatSnapshotService,
            "buildSnapshot", ctx);

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.getRunning()).isFalse();
        assertThat(snapshot.getMsgStatus()).isEqualTo(MsgStatus.FINISH.getCode());
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

    @Test
    void saveExternalChildPublishesReconnectSnapshotBeforeAsyncDatabaseFlush() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(redisTemplate.executePipelined(any(SessionCallback.class))).thenAnswer(invocation -> {
            invocation.getArgument(0, SessionCallback.class).execute(redisTemplate);
            return List.of(1L, true);
        });
        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
        message.setSessionId(20L);
        message.setMessageId(21L);
        message.setMessageContent("latest child output");
        message.setMetadata("{\"child_run_id\":\"worker-child-1:2\",\"child_turn\":2}");

        assertThat(service.saveExternalChild(message, "123-4", false)).isTrue();

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq("byai:chat:running:snapshot:20:external-child-20"), json.capture(),
            eq(1800L), eq(TimeUnit.SECONDS));
        RunningChatSnapshotResponse snapshot = JSONObject.parseObject(json.getValue(), RunningChatSnapshotResponse.class);
        assertThat(snapshot.getMessageContent()).isEqualTo("latest child output");
        assertThat(snapshot.getSnapshotStreamId()).isEqualTo("123-4");
        assertThat(snapshot.getRunning()).isTrue();
        assertThat(snapshot.getMsgStatus()).isEqualTo(MsgStatus.APPEND.getCode());
        assertThat(snapshot.getChildRunId()).isEqualTo("worker-child-1:2");
        assertThat(snapshot.getChildTurn()).isEqualTo(2L);
    }

    @Test
    void hydrateMessageContextRestoresTerminalStateFromExternalChildSnapshot() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);

        RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
        snapshot.setSessionId(20L);
        snapshot.setMessageId(21L);
        snapshot.setModelAnswerMessageId(21L);
        snapshot.setRunning(false);
        snapshot.setMsgStatus(MsgStatus.FINISH.getCode());
        when(valueOperations.get("byai:chat:running:snapshot:20:external-child-20"))
            .thenReturn(JSONObject.toJSONString(snapshot));

        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(20L);
        state.setTraceId("external-child-20");
        state.setModelAnswerMessageId(21L);

        MessageContext restored = service.hydrateMessageContext(state);

        assertThat(restored).isNotNull();
        assertThat(restored.getComplete()).isTrue();
    }

    @Test
    void markExternalChildPersistedStoresTheDurableStreamWatermark() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        ValueOperations<String, Object> valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
        message.setSessionId(20L);
        message.setMessageId(21L);
        message.setMetadata("{\"event_stream_id\":\"123-4\"}");

        service.markExternalChildPersisted(message);

        verify(valueOperations).set("byai:chat:scoped:persisted:20:21", "123-4", 1800L, TimeUnit.SECONDS);
    }
}
