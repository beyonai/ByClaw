package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTurnCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** Tests queue outcomes across polls with retained rows; Gateway and DB transport stay outside this unit boundary. */
class GroupChatTurnQueueTest {
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final ByaiGroupChatExecutionMapper anchors = mock(ByaiGroupChatExecutionMapper.class);
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final ChatRuntimeStateService runtime = mock(ChatRuntimeStateService.class);
    private final GroupChatGatewayExecutor gateway = mock(GroupChatGatewayExecutor.class);
    private final List<ByaiGroupChatTurn> rows = new ArrayList<>();
    private final List<Long> sent = new ArrayList<>();
    private GroupChatTurnCoordinator coordinator;

    @BeforeEach
    void setUp() {
        SessionMemberService members = mock(SessionMemberService.class);
        when(members.findSessionMember(anyLong(), anyString(), anyLong())).thenReturn(new ByaiSessionMember());
        SessionService sessions = mock(SessionService.class);
        when(sessions.findById(anyLong())).thenAnswer(call -> {
            ByaiSession session = new ByaiSession();
            session.setSessionId(call.getArgument(0));
            session.setCreatorId(1L);
            session.setObjectId(2L);
            return session;
        });
        PlatformTransactionManager transactions = mock(PlatformTransactionManager.class);
        when(transactions.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        coordinator = new GroupChatTurnCoordinator(turns, anchors, tasks, mock(ByaiMessageMapper.class),
            mock(GroupChatCandidateSessionService.class), mock(SequenceService.class), members, sessions,
            mock(UserService.class), mock(SsResourceService.class), runtime, gateway, transactions);
        // Inline executor makes scheduling deterministic; persisted row state still survives each poll.
        ExecutorService workers = mock(ExecutorService.class);
        when(workers.submit(any(Runnable.class))).thenAnswer(call -> {
            call.getArgument(0, Runnable.class).run();
            return null;
        });
        ReflectionTestUtils.setField(coordinator, "workers", workers);
        when(turns.selectQueuedExecutions()).thenAnswer(call -> rows.stream()
            .filter(row -> "QUEUED".equals(row.getStatus())).toList());
        when(turns.selectRunningExecutions()).thenAnswer(call -> rows.stream()
            .filter(row -> "RUNNING".equals(row.getStatus())).toList());
        when(turns.selectRunningBySession(anyLong())).thenAnswer(call -> rows.stream()
            .filter(row -> row.getCandidateSessionId().equals(call.getArgument(0)) && "RUNNING".equals(row.getStatus()))
            .findFirst().orElse(null));
        when(turns.selectFirstQueued(anyLong())).thenAnswer(call -> rows.stream()
            .filter(row -> row.getCandidateSessionId().equals(call.getArgument(0)) && "QUEUED".equals(row.getStatus()))
            .min(Comparator.comparing(ByaiGroupChatTurn::getExecutionId)).orElse(null));
        when(turns.selectForUpdateById(anyLong())).thenAnswer(call -> find(call.getArgument(0)));
        when(turns.claim(anyLong(), any())).thenAnswer(call -> {
            ByaiGroupChatTurn row = find(call.getArgument(0));
            if (!"QUEUED".equals(row.getStatus())) { return 0; }
            row.setStatus("RUNNING");
            return 1;
        });
        when(turns.markFailed(anyLong(), anyString(), anyString(), any())).thenAnswer(call -> {
            find(call.getArgument(0)).setStatus("FAILED");
            return 1;
        });
        doAnswer(call -> {
            ByaiGroupChatTurn row = call.getArgument(0);
            row.setTraceId("bound-" + row.getExecutionId());
            sent.add(row.getExecutionId());
            return null;
        }).when(gateway).executeTurn(any());
    }

    @Test
    void oldestPerSessionRunsFirstWhileOtherSessionsCanRun() {
        ByaiGroupChatTurn later = row(12L, 60L);
        ByaiGroupChatTurn first = row(11L, 60L);
        row(13L, 70L);
        coordinator.poll();
        assertThat(sent).containsExactly(11L, 13L);
        assertThat(later.getStatus()).isEqualTo("QUEUED");
        verify(anchors, times(2)).selectForUpdateByCandidateSessionId(60L);
        first.setStatus("SUCCEEDED");
        coordinator.poll();
        assertThat(sent).containsExactly(11L, 13L, 12L);
        assertThat(later.getStatus()).isEqualTo("RUNNING");
    }

    @Test
    void restartingAfterClaimRecoversUnboundWorkButNeverResendsBoundTrace() {
        ByaiGroupChatTurn unbound = row(11L, 60L);
        unbound.setStatus("RUNNING");
        ByaiGroupChatTurn uncertain = row(12L, 70L);
        uncertain.setStatus("RUNNING");
        uncertain.setTraceId("possibly-delivered");
        coordinator.poll();
        coordinator.poll();
        assertThat(sent).containsExactly(11L);
        assertThat(uncertain.getTraceId()).isEqualTo("possibly-delivered");
    }

    @Test
    void queuedContinuationCannotStartAfterTaskPromotionEvenIfWaitingForUser() {
        ByaiGroupChatTurn pending = row(11L, 60L);
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setStatus("ACTIVE");
        task.setTurnStatus("WAITING_USER");
        when(tasks.selectById(60L)).thenReturn(task);
        coordinator.poll();
        assertThat(pending.getStatus()).isEqualTo("BLOCKED");
        assertThat(pending.getErrorCode()).isEqualTo("ACTIVE_TASK");
        verifyNoInteractions(gateway);
    }

    @ParameterizedTest
    @ValueSource(strings = {"RUNNING", "HANDOFF_REQUESTED"})
    void runningOrdinaryTurnKeepsQueueWaitingWithoutConsumingHop(String status) {
        ByaiGroupChatTurn pending = row(11L, 60L);
        pending.setHopCount(6);
        ChatRuntimeState busy = new ChatRuntimeState();
        busy.setStatus(status);
        when(runtime.get(60L)).thenReturn(busy);
        coordinator.poll();
        assertThat(pending.getStatus()).isEqualTo("QUEUED");
        assertThat(pending.getHopCount()).isEqualTo(6);
        verifyNoInteractions(gateway);
        when(runtime.get(60L)).thenReturn(null);
        coordinator.poll();
        assertThat(sent).containsExactly(11L);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void onlyProvenPreparationFailureReleasesABoundTurn(boolean preparationFailed) {
        ByaiGroupChatTurn pending = row(11L, 60L);
        doAnswer(call -> {
            pending.setTraceId("bound-11");
            if (preparationFailed) {
                throw new IllegalStateException(new ChatTurnPreparationException(new IllegalStateException("local")));
            }
            throw new IllegalStateException("transport outcome unknown");
        }).when(gateway).executeTurn(any());
        coordinator.poll();
        assertThat(pending.getStatus()).isEqualTo(preparationFailed ? "FAILED" : "RUNNING");
    }

    private ByaiGroupChatTurn row(long id, long session) {
        ByaiGroupChatTurn row = new ByaiGroupChatTurn();
        row.setExecutionId(id);
        row.setCandidateSessionId(session);
        row.setGatewaySessionId(String.valueOf(session));
        row.setInitiatorUserId(1L);
        row.setTargetAgentId(2L);
        row.setGroupSessionId(10L);
        row.setHopCount(0);
        row.setPhase("NORMAL");
        row.setStatus("QUEUED");
        rows.add(row);
        return row;
    }

    private ByaiGroupChatTurn find(Long id) {
        return rows.stream().filter(row -> row.getExecutionId().equals(id)).findFirst().orElseThrow();
    }
}
