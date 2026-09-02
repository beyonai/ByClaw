package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.TimeUnit;

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
