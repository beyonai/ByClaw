package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.chat.service.StreamAckFailureRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.StreamDispatchResult;
import com.iwhalecloud.byai.state.domain.chat.service.StreamRecordProcessor;

class RedisStreamMessageListenerTest {

    private RedisStreamMessageListener listener;
    private RedisTemplate<String, Object> redisTemplate;
    private StreamOperations<String, Object, Object> streamOperations;
    private StreamRecordProcessor processor;
    private StreamAckFailureRegistry ackFailureRegistry;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        listener = new RedisStreamMessageListener();
        redisTemplate = mock(RedisTemplate.class);
        streamOperations = mock(StreamOperations.class);
        processor = mock(StreamRecordProcessor.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOperations);
        ackFailureRegistry = new StreamAckFailureRegistry();
        ReflectionTestUtils.setField(listener, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(listener, "streamRecordProcessor", processor);
        ReflectionTestUtils.setField(listener, "streamAckFailureRegistry", ackFailureRegistry);
    }

    @Test
    void acknowledgesBeforeSchedulingTerminalCleanup() {
        MapRecord<String, String, String> record = record();
        StreamDispatchResult result = StreamDispatchResult.terminalHandled(null);
        when(processor.process(record)).thenReturn(result);
        when(streamOperations.acknowledge(any(), any(), any(RecordId.class))).thenReturn(1L);

        listener.onMessage(record);

        verify(streamOperations).acknowledge("stream-10", "byai_conversation_service_group", record.getId());
        verify(processor).afterAcknowledge(result);
    }

    /**
     * ACK 成功后应清除该消息的失败登记，避免 recovery 重复 claim 已确认的消息。
     */
    @Test
    void clearsAckFailureRegistrationOnSuccessfulAck() {
        MapRecord<String, String, String> record = record();
        ackFailureRegistry.record("stream-10", "1-0");
        when(processor.process(record)).thenReturn(StreamDispatchResult.HANDLED);
        when(streamOperations.acknowledge(any(), any(), any(RecordId.class))).thenReturn(1L);

        listener.onMessage(record);

        org.assertj.core.api.Assertions.assertThat(ackFailureRegistry.hasFailures("stream-10")).isFalse();
    }

    /**
     * 终止事件收尾不得在 ACK 失败时执行，否则 listener 会在消息仍未确认时被停止。
     */
    @Test
    void skipsCleanupWhenAckFails() {
        MapRecord<String, String, String> record = record();
        StreamDispatchResult result = StreamDispatchResult.terminalHandled(null);
        when(processor.process(record)).thenReturn(result);
        when(streamOperations.acknowledge(any(), any(), any(RecordId.class)))
            .thenThrow(new IllegalStateException("redis down"));

        listener.onMessage(record);

        verify(processor, never()).afterAcknowledge(any());
    }

    @Test
    void keepsMessagePendingWhenDispatchFails() {
        MapRecord<String, String, String> record = record();
        doThrow(new IllegalStateException("dispatch failed")).when(processor).process(record);

        listener.onMessage(record);

        verify(streamOperations, never()).acknowledge(any(), any(), any(RecordId.class));
    }

    @SuppressWarnings("unchecked")
    private MapRecord<String, String, String> record() {
        MapRecord<String, String, String> record = mock(MapRecord.class);
        when(record.getValue()).thenReturn(Map.of("data", "{\"session_id\":\"10\"}"));
        when(record.getStream()).thenReturn("stream-10");
        when(record.getId()).thenReturn(RecordId.of("1-0"));
        return record;
    }
}
