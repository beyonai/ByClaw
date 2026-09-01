package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.eq;

import java.util.Collections;
import java.util.Date;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
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
        RunningChatSnapshotService service = new RunningChatSnapshotService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
        ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
        message.setSessionId(20L);
        message.setMessageId(21L);
        message.setMessageContent("latest child output");

        service.saveExternalChild(message, "123-4", false);

        ArgumentCaptor<String> json = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq("byai:chat:running:snapshot:20:external-child-20"), json.capture(),
            eq(1800L), eq(TimeUnit.SECONDS));
        RunningChatSnapshotResponse snapshot = JSONObject.parseObject(json.getValue(), RunningChatSnapshotResponse.class);
        assertThat(snapshot.getMessageContent()).isEqualTo("latest child output");
        assertThat(snapshot.getSnapshotStreamId()).isEqualTo("123-4");
        assertThat(snapshot.getRunning()).isTrue();
        assertThat(snapshot.getMsgStatus()).isEqualTo(MsgStatus.APPEND.getCode());
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
