package com.iwhalecloud.byai.state.domain.groupchat;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.util.List;
import java.util.concurrent.ExecutorService;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionStarted;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatStreamRouter;

class GroupChatClassificationObservationTest {
    private final ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final GroupChatExecutionEventHandler handler = mock(GroupChatExecutionEventHandler.class);
    private final GroupChatStreamRouter router = new GroupChatStreamRouter(executions, handler);

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(router, "turnMapper", turns);
        ExecutorService executor = mock(ExecutorService.class);
        doAnswer(call -> { call.getArgument(0, Runnable.class).run(); return null; })
            .when(executor).execute(any(Runnable.class));
        ReflectionTestUtils.setField(router, "observers", executor);
    }

    @Test
    void classificationTickUsesOnlyRegisteredExactTracesAndRemovesCompletedObservation() {
        GroupChatExecutionStarted event = new GroupChatExecutionStarted(10L, true, "trace-a");
        router.onExecutionStarted(event);
        router.onExecutionStarted(event);
        router.observeClassifications();
        router.observeClassifications();
        verify(handler).observe(10L, true, "trace-a");
        verifyNoInteractions(turns, executions);
    }

    @Test
    void failedClassificationRemainsRetryableWithoutDatabaseDiscovery() {
        when(handler.observe(10L, true, "trace-a")).thenThrow(new IllegalStateException("projection unavailable"));
        router.onExecutionStarted(new GroupChatExecutionStarted(10L, true, "trace-a"));
        router.observeClassifications();
        // Backoff prevents a failed projection from being retried on every tick.
        router.observeClassifications();
        verify(handler).observe(10L, true, "trace-a");
        verifyNoInteractions(turns, executions);
    }

    @Test
    void completionCursorAdvancesPastUnfinishedRowsAndWrapsAfterShortPage() {
        ReflectionTestUtils.setField(router, "batchSize", 1);
        ByaiGroupChatTurn first = new ByaiGroupChatTurn(); first.setExecutionId(10L);
        ByaiGroupChatTurn second = new ByaiGroupChatTurn(); second.setExecutionId(20L);
        when(turns.selectBoundPage(0L, 1)).thenReturn(List.of(first));
        when(turns.selectBoundPage(10L, 1)).thenReturn(List.of(second));
        when(turns.selectBoundPage(20L, 1)).thenReturn(List.of());
        router.pollRunningExecutions();
        router.pollRunningExecutions();
        router.pollRunningExecutions();
        router.pollRunningExecutions();
        verify(handler, times(2)).reconcileTurn(10L);
        verify(handler).reconcileTurn(20L);
    }
}
