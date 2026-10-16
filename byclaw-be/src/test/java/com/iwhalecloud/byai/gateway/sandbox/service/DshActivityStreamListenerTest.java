package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.Executor;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.connection.stream.StreamRecords;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.test.util.ReflectionTestUtils;

class DshActivityStreamListenerTest {

    private static final String STREAM = DshActivityStreamListener.DEFAULT_STREAM_KEY;
    private static final String GROUP = DshActivityStreamListener.DEFAULT_CONSUMER_GROUP;

    private StreamOperations<String, Object, Object> streams;
    private DshActivityStateStore store;
    private DshActivityStreamListener listener;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        streams = mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(streams);
        store = mock(DshActivityStateStore.class);
        listener = new DshActivityStreamListener(mock(RedisConnectionFactory.class), redisTemplate, store,
            mock(Executor.class));
        ReflectionTestUtils.setField(listener, "enabled", true);
    }

    @Test
    void validEntryIsRecordedWithBackendReceiveTimeAndAcked() {
        when(store.record(anyString(), any(DshActivity.class))).thenReturn(true);
        long before = System.currentTimeMillis();

        listener.onMessage(message("1700000000000-2", entry("byclaw-dsh-user001", "user001", "releasable")));

        ArgumentCaptor<DshActivity> recorded = ArgumentCaptor.forClass(DshActivity.class);
        verify(store).record(org.mockito.ArgumentMatchers.eq("byclaw-dsh-user001"), recorded.capture());
        assertThat(recorded.getValue().userCode()).isEqualTo("user001");
        assertThat(recorded.getValue().state()).isEqualTo("releasable");
        assertThat(recorded.getValue().streamId()).isEqualTo("1700000000000-2");
        assertThat(recorded.getValue().receivedAt()).isBetween(before, System.currentTimeMillis());
        assertThat(recorded.getValue().at()).isEqualTo("2026-10-15T08:00:00.000Z");
        verify(streams).acknowledge(STREAM, GROUP, RecordId.of("1700000000000-2"));
    }

    @Test
    void malformedEntriesAreAckedButNeverRecorded() {
        listener.onMessage(message("1-1", entry("byclaw-dsh-user001", null, "busy")));
        listener.onMessage(message("1-2", entry("byclaw-dsh-user001", "", "busy")));
        listener.onMessage(message("1-3", entry(null, "user001", "busy")));
        listener.onMessage(message("1-4", entry("byclaw-dsh-user001", "user001", "idle")));

        verifyNoInteractions(store);
        verify(streams).acknowledge(STREAM, GROUP, RecordId.of("1-1"));
        verify(streams).acknowledge(STREAM, GROUP, RecordId.of("1-2"));
        verify(streams).acknowledge(STREAM, GROUP, RecordId.of("1-3"));
        verify(streams).acknowledge(STREAM, GROUP, RecordId.of("1-4"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void storeFailureLeavesTheEntryPendingAndClosesTheSilentGate() {
        when(store.record(anyString(), any(DshActivity.class))).thenThrow(new IllegalStateException("redis down"));
        long now = System.currentTimeMillis();
        ReflectionTestUtils.setField(listener, "container", mock(StreamMessageListenerContainer.class));
        ReflectionTestUtils.setField(listener, "consumingSince", now - 120_000L);
        assertThat(listener.isSilentCheckReady(now)).isTrue();

        listener.onMessage(message("1-1", entry("byclaw-dsh-user001", "user001", "busy")));

        verify(streams, never()).acknowledge(anyString(), anyString(), any(RecordId[].class));
        assertThat(listener.isSilentCheckReady(System.currentTimeMillis())).isFalse();
    }

    @Test
    void disabledListenerNeverTouchesRedis() {
        ReflectionTestUtils.setField(listener, "enabled", false);

        listener.start();

        verifyNoInteractions(streams);
        assertThat(listener.isSilentCheckReady(System.currentTimeMillis())).isFalse();
    }

    @Test
    void createsTheConsumerGroupOnTheConfiguredStream() {
        ReflectionTestUtils.invokeMethod(listener, "createConsumerGroupIfAbsent");

        verify(streams).createGroup(STREAM, ReadOffset.latest(), GROUP);
    }

    @Test
    @SuppressWarnings("unchecked")
    void silentCheckWaitsForSilentSecondsOfUninterruptedConsumption() {
        long now = System.currentTimeMillis();
        assertThat(listener.isSilentCheckReady(now)).isFalse();

        ReflectionTestUtils.setField(listener, "container", mock(StreamMessageListenerContainer.class));
        ReflectionTestUtils.setField(listener, "consumingSince", now - 89_000L);
        assertThat(listener.isSilentCheckReady(now)).isFalse();
        ReflectionTestUtils.setField(listener, "consumingSince", now - 90_000L);
        assertThat(listener.isSilentCheckReady(now)).isTrue();

        Thread.currentThread().interrupt();
        listener.handleReadError(new IllegalStateException("connection reset"));
        assertThat(Thread.interrupted()).isTrue();
        assertThat(listener.isSilentCheckReady(System.currentTimeMillis())).isFalse();
    }

    private static Map<String, String> entry(String sandboxId, String userCode, String state) {
        Map<String, String> values = new HashMap<>();
        if (sandboxId != null) {
            values.put("sandboxId", sandboxId);
        }
        if (userCode != null) {
            values.put("userCode", userCode);
        }
        values.put("state", state);
        values.put("at", "2026-10-15T08:00:00.000Z");
        values.put("lastActiveAt", "2026-10-15T07:30:00.000Z");
        return values;
    }

    private static MapRecord<String, String, String> message(String id, Map<String, String> values) {
        return StreamRecords.newRecord().in(STREAM).withId(RecordId.of(id)).ofMap(values);
    }
}
