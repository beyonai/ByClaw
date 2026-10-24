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
import org.springframework.context.ApplicationContext;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.Consumer;
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
        ReflectionTestUtils.setField(listener, "silentSeconds", 90L);
    }

    @Test
    void validEntryIsRecordedWithTheStreamEntryTimeAndAcked() {
        when(store.record(anyString(), any(DshActivity.class))).thenReturn(true);

        listener.onMessage(message("1700000000000-2", entry("byclaw-dsh-user001", "user001", "releasable")));

        ArgumentCaptor<DshActivity> recorded = ArgumentCaptor.forClass(DshActivity.class);
        verify(store).record(org.mockito.ArgumentMatchers.eq("byclaw-dsh-user001"), recorded.capture());
        assertThat(recorded.getValue().userCode()).isEqualTo("user001");
        assertThat(recorded.getValue().state()).isEqualTo("releasable");
        assertThat(recorded.getValue().streamId()).isEqualTo("1700000000000-2");
        // the entry time comes from the Redis server clock embedded in the stream id, not from this instance
        assertThat(recorded.getValue().receivedAt()).isEqualTo(1_700_000_000_000L);
        assertThat(recorded.getValue().at()).isEqualTo("2026-10-15T08:00:00.000Z");
        verify(streams).acknowledge(STREAM, GROUP, RecordId.of("1700000000000-2"));
    }

    @Test
    void toolEnvironmentEntriesKeepTheirTypeAndKind() {
        Map<String, String> values = entry("byclaw-sandbox--tools-1", "user001", "busy");
        values.put("sandboxType", " byclaw-dsh-tools-media ");
        values.put("kind", "tool-env");
        values.put("environment", "media");

        assertThat(listener.handle(values, "1700000000000-5", 0L)).isFalse();

        ArgumentCaptor<DshActivity> recorded = ArgumentCaptor.forClass(DshActivity.class);
        verify(store).record(org.mockito.ArgumentMatchers.eq("byclaw-sandbox--tools-1"), recorded.capture());
        assertThat(recorded.getValue().sandboxType()).isEqualTo("byclaw-dsh-tools-media");
        assertThat(recorded.getValue().isToolEnvironment()).isTrue();
        // A sandbox's own entry carries neither.
        listener.handle(entry("byclaw-dsh-user001", "user001", "busy"), "1700000000000-6", 0L);
        verify(store).record(org.mockito.ArgumentMatchers.eq("byclaw-dsh-user001"), recorded.capture());
        assertThat(recorded.getValue().sandboxType()).isNull();
        assertThat(recorded.getValue().isToolEnvironment()).isFalse();
    }

    @Test
    void unparsableStreamIdFallsBackToTheBackendReceiveTime() {
        long before = System.currentTimeMillis();

        assertThat(listener.handle(entry("byclaw-dsh-user001", "user001", "busy"), "garbage", before)).isFalse();

        ArgumentCaptor<DshActivity> recorded = ArgumentCaptor.forClass(DshActivity.class);
        verify(store).record(org.mockito.ArgumentMatchers.eq("byclaw-dsh-user001"), recorded.capture());
        assertThat(recorded.getValue().receivedAt()).isEqualTo(before);
    }

    @Test
    @SuppressWarnings("unchecked")
    void stoppingDeletesThisStartsConsumerFromTheGroup() {
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> container =
            mock(StreamMessageListenerContainer.class);
        ReflectionTestUtils.setField(listener, "container", container);
        ReflectionTestUtils.setField(listener, "consumerName", "byclaw-dsh-activity:host:abc");

        listener.onApplicationEvent(new ContextClosedEvent(mock(ApplicationContext.class)));

        verify(container).stop();
        verify(streams).deleteConsumer(STREAM, Consumer.from(GROUP, "byclaw-dsh-activity:host:abc"));
        assertThat(listener.isSilentCheckReady(System.currentTimeMillis())).isFalse();
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
