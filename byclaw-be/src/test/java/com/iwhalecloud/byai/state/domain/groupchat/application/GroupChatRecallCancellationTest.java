package com.iwhalecloud.byai.state.domain.groupchat.application;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatRecallStop;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatRecallMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionSendGate;

class GroupChatRecallCancellationTest {
    private final ByaiGroupChatRecallMapper recalls = mock(ByaiGroupChatRecallMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
    private final GroupChatTaskService tasks = mock(GroupChatTaskService.class);
    private final ChatRuntimeStateService runtime = mock(ChatRuntimeStateService.class);
    private final RunningOutputStreamRegistry registry = mock(RunningOutputStreamRegistry.class);
    private final AssistantChatApplicationService chat = mock(AssistantChatApplicationService.class);
    private final UserService users = mock(UserService.class);
    private final SandboxUserContextRunner context = mock(SandboxUserContextRunner.class);
    private final GroupChatRecallCancellationService service = new GroupChatRecallCancellationService(recalls, turns,
        executions, tasks, mock(GroupChatSessionSendGate.class), runtime, registry, chat, users, context);

    @BeforeEach
    void setUp() {
        Users user = new Users();
        user.setUserCode("initiator");
        when(users.findById(1L)).thenReturn(user);
        doAnswer(call -> { call.getArgument(1, Runnable.class).run(); return null; })
            .when(context).runAsUser(eq("initiator"), any());
    }

    @AfterEach
    void close() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) TransactionSynchronizationManager.clearSynchronization();
        service.close();
    }

    @Test
    void cascadesAcrossAgentsAndAutomaticDescendantsButNotIndependentFollowupsWithSameRootAndSession() {
        var first = turn(1, 100, null);
        var second = turn(2, 100, null);
        var child = turn(3, 101, 1L);
        var grandchild = turn(4, 102, 3L);
        var independent = turn(5, 103, null);
        var independentChild = turn(6, 104, 5L);
        assertThat(GroupChatRecallCancellationService.descendants(
            List.of(grandchild, independentChild, first, second, child, independent), 100L))
            .extracting(ByaiGroupChatExecution::getExecutionId).containsExactly(4L, 1L, 2L, 3L);
    }

    @Test
    void marksQueuedAndRunningAtomicallyWithoutCallingStopInsideRecallTransaction() {
        var queued = turn(1, 100, null);
        queued.setStatus("QUEUED");
        queued.setTraceId(null);
        var running = turn(2, 100, null);
        when(recalls.turns(10L)).thenReturn(List.of(queued, running));
        when(turns.selectForUpdateById(1L)).thenReturn(queued);
        when(turns.selectForUpdateById(2L)).thenReturn(running);
        TransactionSynchronizationManager.initSynchronization();
        service.cancel(10L, 100L);
        var records = ArgumentCaptor.forClass(ByaiGroupChatRecallStop.class);
        verify(recalls, times(2)).insertStop(records.capture());
        assertThat(records.getAllValues()).extracting(ByaiGroupChatRecallStop::getStatus).containsExactly("DONE", "PENDING");
        verify(recalls).cancelTurn(1L);
        verify(recalls).cancelTurn(2L);
        verifyNoInteractions(chat);
        assertThat(TransactionSynchronizationManager.getSynchronizations()).hasSize(1);
    }

    @Test
    void activeTaskStillProducesStopIntentAfterOriginalTurnFinished() {
        var finished = turn(1, 100, null);
        finished.setStatus("SUCCEEDED");
        when(recalls.turns(10L)).thenReturn(List.of(finished));
        when(turns.selectForUpdateById(1L)).thenReturn(finished);
        var task = new ByaiGroupChatTask();
        task.setTurnStatus("RUNNING");
        when(tasks.cancelForRecall(20L, 1L)).thenReturn(task);
        TransactionSynchronizationManager.initSynchronization();
        service.cancel(10L, 100L);
        var record = ArgumentCaptor.forClass(ByaiGroupChatRecallStop.class);
        verify(recalls).insertStop(record.capture());
        assertThat(record.getValue().isTaskOwned()).isTrue();
        assertThat(record.getValue().getStatus()).isEqualTo("PENDING");
    }

    @Test
    void waitingTaskCancelsWithoutAnUnnecessaryRemoteStop() {
        var finished = turn(1, 100, null);
        finished.setStatus("SUCCEEDED");
        var task = new ByaiGroupChatTask();
        task.setTurnStatus("WAITING_USER");
        when(tasks.cancelForRecall(20L, 1L)).thenReturn(task);
        when(recalls.turns(10L)).thenReturn(List.of(finished));
        when(turns.selectForUpdateById(1L)).thenReturn(finished);
        TransactionSynchronizationManager.initSynchronization();
        service.cancel(10L, 100L);
        var record = ArgumentCaptor.forClass(ByaiGroupChatRecallStop.class);
        verify(recalls).insertStop(record.capture());
        assertThat(record.getValue().getStatus()).isEqualTo("DONE");
        assertThat(record.getValue().getTraceId()).isNull();
    }

    @Test
    void retryDoesNotInsertAnotherCancellationRecord() {
        when(recalls.turns(10L)).thenReturn(List.of(turn(1, 100, null)));
        when(recalls.isRecalled(1L)).thenReturn(true);
        TransactionSynchronizationManager.initSynchronization();
        service.cancel(10L, 100L);
        verify(recalls, never()).insertStop(any());
        verifyNoInteractions(tasks, turns, chat);
    }

    @Test
    void stopsOwnedRunningTraceUsingInitiatorContext() {
        pending(false);
        running("original");
        service.stopPending(20L);
        var request = ArgumentCaptor.forClass(StopChatDto.class);
        verify(chat).stopChatForRecall(request.capture());
        assertThat(request.getValue().getTraceId()).isEqualTo("original");
        verify(context).runAsUser(eq("initiator"), any());
        verify(recalls).finishStop(1L);
    }

    @Test
    void ignoresLaterIndependentTurnEvenWhenOriginalOwnedATask() {
        pending(true);
        running("independent");
        when(turns.selectByTrace("independent")).thenReturn(turn(2, 103, null));
        service.stopPending(20L);
        verifyNoInteractions(chat);
        verify(recalls).finishStop(1L);
    }

    @Test
    void privateTaskContinuationIsStoppedEvenWithANewTrace() {
        pending(true);
        running("private-followup");
        service.stopPending(20L);
        verify(chat).stopChatForRecall(argThat(dto -> "private-followup".equals(dto.getTraceId())));
    }

    @Test
    void failedStopKeepsIntentForRecovery() {
        pending(false);
        running("original");
        doThrow(new IllegalStateException("gateway offline")).when(chat).stopChatForRecall(any());
        assertThatThrownBy(() -> service.stopPending(20L)).hasMessage("gateway offline");
        verify(recalls, never()).finishStop(any());
        doNothing().when(chat).stopChatForRecall(any());
        service.stopPending(20L);
        verify(recalls).finishStop(1L);
    }

    @Test
    void lostRuntimeDoesNotLoseAnAlreadyBoundStopIntent() {
        pending(false);
        service.stopPending(20L);
        verify(chat).stopChatForRecall(argThat(dto -> "original".equals(dto.getTraceId())));
    }

    private void pending(boolean task) {
        var stop = new ByaiGroupChatRecallStop();
        stop.setExecutionId(1L);
        stop.setSessionId(20L);
        stop.setInitiatorUserId(1L);
        stop.setTraceId("original");
        stop.setTaskOwned(task);
        when(recalls.pending(20L)).thenReturn(List.of(stop));
    }

    private void running(String trace) {
        var state = new ChatRuntimeState();
        state.setStatus("RUNNING");
        state.setTraceId(trace);
        state.setModelAnswerMessageId(99L);
        when(runtime.get(20L)).thenReturn(state);
    }

    private ByaiGroupChatTurn turn(long id, long trigger, Long parent) {
        var turn = new ByaiGroupChatTurn();
        turn.setExecutionId(id);
        turn.setGroupSessionId(10L);
        turn.setCandidateSessionId(20L);
        turn.setInitiatorUserId(1L);
        turn.setRootMessageId(100L);
        turn.setTriggerMessageId(trigger);
        turn.setParentTurnId(parent);
        turn.setStatus("RUNNING");
        turn.setTraceId("trace-" + id);
        return turn;
    }
}
