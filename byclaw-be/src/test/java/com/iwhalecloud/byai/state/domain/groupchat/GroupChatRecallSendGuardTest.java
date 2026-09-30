package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatRecallMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatGatewaySendGuard.Lease;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatRecallCancellationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatRecallSendGuard;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionSendGate;

class GroupChatRecallSendGuardTest {
    private final ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ByaiGroupChatRecallMapper recalls = mock(ByaiGroupChatRecallMapper.class);
    private final GroupChatSessionSendGate gate = mock(GroupChatSessionSendGate.class);
    private final GroupChatRecallCancellationService cancellations = mock(GroupChatRecallCancellationService.class);
    private final GroupChatRecallSendGuard guard = new GroupChatRecallSendGuard(executions, turns, tasks, recalls, gate, cancellations);

    @Test
    void pendingStopRunsUnderGateBeforeNewRuntimeCanRegister() throws Exception {
        var ctx = context();
        var lease = mock(Lease.class);
        when(executions.selectByCandidateSessionId(20L)).thenReturn(new ByaiGroupChatExecution());
        when(gate.acquire(20L)).thenReturn(lease);
        try (Lease actual = guard.open(ctx)) {
            var order = inOrder(gate, cancellations);
            order.verify(gate).acquire(20L);
            order.verify(cancellations).stopPending(20L);
            verify(lease, never()).close();
        }
        verify(lease).close();
    }

    @Test
    void recallCommittedDuringPreparationRejectsNextActualSend() {
        var turn = new ByaiGroupChatTurn();
        turn.setExecutionId(1L);
        when(turns.selectByTrace("trace")).thenReturn(turn);
        when(recalls.isRecalled(1L)).thenReturn(false, true);
        guard.beforeSend(context());
        assertThatThrownBy(() -> guard.beforeSend(context())).hasMessageContaining("原消息已撤回");
    }

    @Test
    void cancelledTaskRejectsPrivateContinuationButAllowsIndependentGroupTurn() {
        var anchor = new ByaiGroupChatExecution();
        var task = new ByaiGroupChatTask();
        task.setStatus("CANCELLED");
        when(executions.selectByCandidateSessionId(20L)).thenReturn(anchor);
        when(tasks.selectById(20L)).thenReturn(task);
        assertThatThrownBy(() -> guard.beforeSend(context())).isInstanceOf(IllegalStateException.class);
        var independent = new ByaiGroupChatTurn();
        independent.setExecutionId(2L);
        when(turns.selectByTrace("trace")).thenReturn(independent);
        assertThatCode(() -> guard.beforeSend(context())).doesNotThrowAnyException();
    }

    @Test
    void failedStopReleasesGateButDoesNotAllowNewSend() throws Exception {
        var lease = mock(Lease.class);
        when(executions.selectByCandidateSessionId(20L)).thenReturn(new ByaiGroupChatExecution());
        when(gate.acquire(20L)).thenReturn(lease);
        doThrow(new IllegalStateException("stop failed")).when(cancellations).stopPending(20L);
        assertThatThrownBy(() -> guard.open(context())).hasMessage("stop failed");
        verify(lease).close();
    }

    @Test
    void ordinaryPrivateSessionDoesNotAcquireGroupGate() throws Exception {
        try (Lease lease = guard.open(context())) {
            verifyNoInteractions(gate, cancellations);
        }
    }

    private ChatProcessContext context() {
        var context = new ChatProcessContext(null, new AssistantChatDto());
        context.sessionId = 20L;
        context.traceId = "trace";
        return context;
    }
}
