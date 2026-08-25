package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Set;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.StreamInfo.XInfoGroup;
import org.springframework.data.redis.connection.stream.StreamInfo.XInfoGroups;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;

class SessionStreamPendingMetricsTest {

    private SessionStreamManager sessionStreamManager;
    private RedisTemplate<String, Object> redisTemplate;
    private StreamOperations<String, Object, Object> streamOperations;
    private SessionStreamMetrics sessionStreamMetrics;
    private SessionStreamPendingMetrics pendingMetrics;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        sessionStreamManager = mock(SessionStreamManager.class);
        redisTemplate = mock(RedisTemplate.class);
        streamOperations = mock(StreamOperations.class);
        sessionStreamMetrics = mock(SessionStreamMetrics.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOperations);
        pendingMetrics = new SessionStreamPendingMetrics(sessionStreamManager, redisTemplate, sessionStreamMetrics);
    }

    @Test
    void sumsTargetGroupPendingAcrossActiveStreams() {
        when(sessionStreamManager.activeSessionIdsSnapshot()).thenReturn(Set.of("10", "20"));
        when(sessionStreamManager.buildStreamKey("10")).thenReturn("stream-10");
        when(sessionStreamManager.buildStreamKey("20")).thenReturn("stream-20");
        doReturn(groups(group(SessionStreamManager.CONSUMER_GROUP, 2L), group("other-group", 99L)))
            .when(streamOperations).groups("stream-10");
        doReturn(groups(group(SessionStreamManager.CONSUMER_GROUP, 3L)))
            .when(streamOperations).groups("stream-20");

        pendingMetrics.samplePending();

        verify(sessionStreamMetrics).updatePendingTotal(5L);
    }

    @Test
    void treatsMissingTargetGroupAsZeroPending() {
        when(sessionStreamManager.activeSessionIdsSnapshot()).thenReturn(Set.of("10"));
        when(sessionStreamManager.buildStreamKey("10")).thenReturn("stream-10");
        doReturn(groups(group("other-group", 4L))).when(streamOperations).groups("stream-10");

        pendingMetrics.samplePending();

        verify(sessionStreamMetrics).updatePendingTotal(0L);
    }

    @Test
    void publishesZeroWithoutQueryingRedisWhenNoListenersAreActive() {
        when(sessionStreamManager.activeSessionIdsSnapshot()).thenReturn(Set.of());

        pendingMetrics.samplePending();

        verify(sessionStreamMetrics).updatePendingTotal(0L);
        verifyNoInteractions(streamOperations);
    }

    @Test
    void preservesPreviousCompleteValueWhenAnyStreamQueryFails() {
        when(sessionStreamManager.activeSessionIdsSnapshot()).thenReturn(Set.of("10", "20"));
        when(sessionStreamManager.buildStreamKey("10")).thenReturn("stream-10");
        when(sessionStreamManager.buildStreamKey("20")).thenReturn("stream-20");
        doReturn(groups(group(SessionStreamManager.CONSUMER_GROUP, 2L)))
            .when(streamOperations).groups("stream-10");
        when(streamOperations.groups("stream-20")).thenThrow(new IllegalStateException("redis down"));

        pendingMetrics.samplePending();

        verify(sessionStreamMetrics).recordPendingSampleFailure();
        verify(sessionStreamMetrics, never()).updatePendingTotal(anyLong());
    }

    private XInfoGroups groups(XInfoGroup... groups) {
        XInfoGroups result = mock(XInfoGroups.class);
        when(result.stream()).thenReturn(Stream.of(groups));
        return result;
    }

    private XInfoGroup group(String name, Long pendingCount) {
        XInfoGroup group = mock(XInfoGroup.class);
        when(group.groupName()).thenReturn(name);
        when(group.pendingCount()).thenReturn(pendingCount);
        return group;
    }
}
