package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.SessionRuntimeState;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

class SessionRuntimeStateServiceTest {

    private RedisTemplate<String, Object> redisTemplate;
    private ValueOperations<String, Object> valueOperations;
    private SessionRuntimeStateService service;

    @BeforeEach
    void setUp() {
        redisTemplate = mock(RedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        service = new SessionRuntimeStateService();
        ReflectionTestUtils.setField(service, "redisTemplate", redisTemplate);
    }

    @Test
    void appliesNewerRuntimeRevisionAndPersistsTheAuthoritativeSnapshot() {
        JSONObject event = runtimeEvent("integration-a", "trace-1", "running", 3L, 2L, 1L, 0L, 1000L);
        event.getJSONObject("metadata").put("root_active", false);
        event.getJSONObject("metadata").put("accepting_input", true);
        SessionRuntimeState state = service.applyEvent(10L, event);
        assertThat(state).isNotNull();
        assertThat(state.getSource()).isEqualTo("integration-a");
        assertThat(state.getActiveAgentCount()).isEqualTo(2L);
        assertThat(state.getRootActive()).isFalse();
        assertThat(state.getAcceptingInput()).isTrue();
        assertThat(state.isActive()).isTrue();
        verify(valueOperations).set(eq("byai:chat:session-runtime:10"), anyString(), eq(24L * 60L * 60L),
            eq(TimeUnit.SECONDS));
    }

    @Test
    void ignoresAnOlderRevisionFromTheSameSourceAndTrace() {
        SessionRuntimeState current = state("integration-a", "trace-1", "running", 7L, 2000L);
        when(valueOperations.get("byai:chat:session-runtime:10")).thenReturn(JSON.toJSONString(current));
        SessionRuntimeState applied = service.applyEvent(10L,
            runtimeEvent("integration-a", "trace-1", "idle", 6L, 0L, 0L, 0L, 3000L));
        assertThat(applied).isNull();
        verify(valueOperations, never()).set(eq("byai:chat:session-runtime:10"), anyString(),
            eq(24L * 60L * 60L), eq(TimeUnit.SECONDS));
    }

    @Test
    void ignoresAnOlderTurnSnapshotEvenWhenItClaimsTheSessionIsIdle() {
        SessionRuntimeState current = state("integration-a", "trace-new", "running", 2L, 4000L);
        when(valueOperations.get("byai:chat:session-runtime:10")).thenReturn(JSON.toJSONString(current));
        SessionRuntimeState applied = service.applyEvent(10L,
            runtimeEvent("integration-a", "trace-old", "idle", 99L, 0L, 0L, 0L, 3000L));
        assertThat(applied).isNull();
    }

    @Test
    void recognizesRuntimeEventsFromAnyIntegrationButOnlyAtParentScope() {
        assertThat(service.isRuntimeEvent(runtimeEvent("integration-b", "trace-1", "running",
            1L, 1L, 0L, 0L, 1L))).isTrue();
        JSONObject child = runtimeEvent("integration-b", "trace-1", "running", 1L, 1L, 0L, 0L, 1L);
        child.getJSONObject("metadata").put("session_scope", "child");
        assertThat(service.isRuntimeEvent(child)).isFalse();
    }

    @Test
    void leavesParentReadinessNullForLegacyRuntimeEvents() {
        SessionRuntimeState state = service.applyEvent(10L,
            runtimeEvent("openclaw", "trace-legacy", "running", 1L, 1L, 0L, 0L, 100L));

        assertThat(state.getRootActive()).isNull();
        assertThat(state.getAcceptingInput()).isNull();
    }

    @Test
    void cancelledTraceCannotBecomeRunningAgainButANewTraceCanStart() {
        SessionRuntimeState cancelled = state("test-engine", "trace-1", "cancelled", 3L, 2000L);
        when(valueOperations.get("byai:chat:session-runtime:10")).thenReturn(JSON.toJSONString(cancelled));
        assertThat(service.applyEvent(10L,
            runtimeEvent("test-engine", "trace-1", "running", 99L, 5L, 4L, 0L, 3000L))).isNull();
        assertThat(service.applyEvent(10L,
            runtimeEvent("test-engine", "trace-2", "running", 1L, 1L, 0L, 0L, 4000L))).isNotNull();
    }

    @Test
    void blockedRedisWriteDoesNotDelayAnotherSessionsApplyOrCancel() throws Exception {
        Map<String, String> storage = new ConcurrentHashMap<>();
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(valueOperations.get(anyString())).thenAnswer(invocation -> storage.get(invocation.getArgument(0)));
        doAnswer(invocation -> {
            String key = invocation.getArgument(0);
            if (key.equals("byai:chat:session-runtime:10")) {
                writing.countDown();
                assertTrue(release.await(3, TimeUnit.SECONDS));
            }
            storage.put(key, invocation.getArgument(1));
            return null;
        }).when(valueOperations).set(anyString(), any(), eq(24L * 60L * 60L), eq(TimeUnit.SECONDS));

        try (ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var first = workers.submit(() -> service.applyEvent(10L,
                    runtimeEvent("dsh", "trace-a", "running", 1L, 1L, 0L, 0L, 1000L)));
                assertTrue(writing.await(1, TimeUnit.SECONDS));
                assertThat(workers.submit(() -> service.applyEvent(20L,
                    runtimeEvent("dsh", "trace-b", "running", 1L, 1L, 0L, 0L, 1000L)))
                    .get(1, TimeUnit.SECONDS)).isNotNull();
                assertThat(workers.submit(() -> service.cancel(20L)).get(1, TimeUnit.SECONDS).getStatus())
                    .isEqualTo("cancelled");
                release.countDown();
                assertThat(first.get(1, TimeUnit.SECONDS)).isNotNull();
            }
            finally {
                release.countDown();
            }
        }
    }

    @Test
    void cancellationWaitsForSameSessionsInflightWriteAndCannotBeOverwrittenByQueuedRuntime() throws Exception {
        Map<String, String> storage = new ConcurrentHashMap<>();
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(valueOperations.get(anyString())).thenAnswer(invocation -> storage.get(invocation.getArgument(0)));
        doAnswer(invocation -> {
            String value = invocation.getArgument(1);
            if (JSON.parseObject(value).getString("status").equals("running")) {
                writing.countDown();
                assertTrue(release.await(3, TimeUnit.SECONDS));
            }
            storage.put(invocation.getArgument(0), value);
            return null;
        }).when(valueOperations).set(anyString(), any(), eq(24L * 60L * 60L), eq(TimeUnit.SECONDS));

        try (ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var apply = workers.submit(() -> service.applyEvent(10L,
                    runtimeEvent("dsh", "trace-a", "running", 1L, 1L, 0L, 0L, 1000L)));
                assertTrue(writing.await(1, TimeUnit.SECONDS));
                var cancel = workers.submit(() -> service.cancel(10L));
                assertThrows(TimeoutException.class, () -> cancel.get(100, TimeUnit.MILLISECONDS));
                release.countDown();
                assertThat(apply.get(1, TimeUnit.SECONDS)).isNotNull();
                SessionRuntimeState cancelled = cancel.get(1, TimeUnit.SECONDS);
                assertThat(cancelled.getStatus()).isEqualTo("cancelled");
                assertThat(cancelled.getRevision()).isEqualTo(2L);
                assertThat(service.applyEvent(10L,
                    runtimeEvent("dsh", "trace-a", "running", 99L, 1L, 0L, 0L, 2000L))).isNull();
                assertThat(service.get(10L).getStatus()).isEqualTo("cancelled");
            }
            finally {
                release.countDown();
            }
        }
    }

    @Test
    void failedCancellationPreservesExceptionAndReleasesItsSessionLock() throws Exception {
        SessionRuntimeState current = state("dsh", "trace-a", "running", 1L, 1000L);
        when(valueOperations.get("byai:chat:session-runtime:10")).thenReturn(JSON.toJSONString(current));
        org.mockito.Mockito.doThrow(new IllegalStateException("Redis unavailable")).doNothing()
            .when(valueOperations).set(anyString(), any(), eq(24L * 60L * 60L), eq(TimeUnit.SECONDS));

        assertThrows(IllegalStateException.class, () -> service.cancel(10L));
        try (ExecutorService workers = Executors.newVirtualThreadPerTaskExecutor()) {
            assertThat(workers.submit(() -> service.cancel(10L)).get(1, TimeUnit.SECONDS).getStatus())
                .isEqualTo("cancelled");
        }
    }

    private SessionRuntimeState state(String source, String traceId, String status, Long revision, Long changedAt) {
        SessionRuntimeState state = new SessionRuntimeState();
        state.setSessionId(10L);
        state.setSource(source);
        state.setTraceId(traceId);
        state.setStatus(status);
        state.setRevision(revision);
        state.setChangedAt(changedAt);
        return state;
    }

    private JSONObject runtimeEvent(String source, String traceId, String status, Long revision, Long activeAgents,
                                    Long activeChildren, Long waitingInteractions, Long changedAt) {
        JSONObject event = new JSONObject();
        event.put("session_id", "10");
        event.put("trace_id", traceId);
        JSONObject metadata = new JSONObject();
        metadata.put("event_source", source);
        metadata.put("event_kind", "session.runtime");
        metadata.put("session_scope", "parent");
        metadata.put("session_status", status);
        metadata.put("runtime_revision", revision);
        metadata.put("active_agent_count", activeAgents);
        metadata.put("active_child_count", activeChildren);
        metadata.put("waiting_interaction_count", waitingInteractions);
        metadata.put("runtime_changed_at", changedAt);
        event.put("metadata", metadata);
        return event;
    }
}
