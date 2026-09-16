package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.sql.Connection;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.beans.BeanUtils;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatTurnProjectionTest {
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatTurnMapper turns = mock(ByaiGroupChatTurnMapper.class);
    private final GroupChatTaskService tasks = mock(GroupChatTaskService.class);
    private final GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
    private final GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
    private final GroupChatDispositionReader reader = mock(GroupChatDispositionReader.class);
    private final UserService users = mock(UserService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messages, publisher,
        sequence, mock(ByaiGroupChatExecutionMapper.class), mock(GroupChatExecutionCoordinator.class),
        mock(SsResourceService.class), users, reader, tasks, mock(GroupChatCandidateSessionService.class), parser,
        mock(GroupChatMentionService.class), mock(ChatRuntimeStateService.class));
    private ByaiGroupChatTurn turn;
    private ChatProcessContext context;
    private ByaiMessage answer;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(handler, "turnMapper", turns);
        turn = new ByaiGroupChatTurn();
        turn.setExecutionId(10L); turn.setCandidateSessionId(60L); turn.setGatewaySessionId("60");
        turn.setGroupSessionId(1L); turn.setSourceMessageId(2L); turn.setRootMessageId(2L);
        turn.setTargetAgentId(8L); turn.setInitiatorUserId(7L); turn.setTraceId("current-trace");
        turn.setStatus("RUNNING"); turn.setPhase("NORMAL"); turn.setDisposition("UNKNOWN");
        when(turns.selectByTrace("current-trace")).thenReturn(turn);
        when(turns.selectById(10L)).thenReturn(turn);
        when(turns.selectForUpdateById(10L)).thenReturn(turn);
        when(turns.decideDisposition(any(), any(), any(), any(), any())).thenReturn(1);
        when(turns.markSucceeded(any(), any(), any())).thenReturn(1);
        Users user = new Users(); user.setUserCode("user-7");
        when(users.findById(7L)).thenReturn(user);
        context = new ChatProcessContext(null, null); context.sessionId = 60L; context.traceId = "current-trace";
        context.modelAnswerMessageId = 30L;
        answer = new ByaiMessage(); answer.setMessageId(30L); answer.setSessionId(60L);
        answer.setUsage(2); answer.setIsComplete(true); answer.setMessageContent("reply");
        when(messages.selectByMessageId(30L)).thenReturn(answer);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void legacyBoundAssessmentIsRetiredWithoutProjectingOrStartingBusiness(boolean reconcile) {
        turn.setPhase("ASSESSMENT");
        if (reconcile) { handler.reconcileTurn(10L); }
        else { handler.afterPersisted(context); }
        verify(turns).markFailed(eq(10L), eq("ASSESSMENT_RETIRED"), any(), any());
        verifyNoInteractions(reader, parser, publisher, tasks);
        verify(messages, never()).insert(any());
    }

    @Test
    void observerLeavesUnboundLegacyAssessmentForSchedulerRecovery() {
        turn.setPhase("ASSESSMENT");
        turn.setTraceId(null);
        handler.reconcileTurn(10L);
        verify(turns, never()).markFailed(any(), any(), any(), any());
        verifyNoInteractions(reader, parser, publisher, tasks);
    }

    @Test
    void staleCallbackCannotCompleteAnotherTurn() {
        turn.setPhase("CHAT_CONTINUATION"); turn.setTraceId("next-trace");
        handler.afterPersisted(context);
        verifyNoInteractions(reader, parser, publisher, tasks);
    }

    @Test
    void continuedChatProjectsCurrentTurnAndCompletesIt() {
        turn.setPhase("CHAT_CONTINUATION"); turn.setDisposition("CHAT");
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        when(sequence.nextVal()).thenReturn(90L);
        handler.afterPersisted(context);
        verify(messages).insert(any());
        verify(turns).markSucceeded(eq(10L), eq(90L), any());
        verifyNoInteractions(reader, tasks);
    }

    @Test
    void taskTurnEndsWithoutPublishingItsPrivateAnswer() {
        turn.setDisposition("TASK");
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        handler.afterPersisted(context);
        verify(tasks).updateTurnStatus(60L, "WAITING_USER");
        verify(turns).markSucceeded(eq(10L), eq(30L), any());
        verify(messages, never()).insert(any());
        verifyNoInteractions(publisher);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void competingCompletionDuringLockWaitDoesNotProjectCachedRunningTurnAgain(boolean pollStartsFirst) {
        turn.setTraceId(TraceIdCodec.encode(20L, 30L));
        context.traceId = turn.getTraceId();
        when(turns.selectByTrace(context.traceId)).thenReturn(turn);
        ByaiGroupChatTurn persisted = new ByaiGroupChatTurn();
        BeanUtils.copyProperties(turn, persisted);
        // 普通查询保留加锁前的缓存快照，锁定查询读取竞争者提交后的最新状态。
        when(turns.selectForUpdateById(10L)).thenAnswer(call -> {
            ByaiGroupChatTurn current = new ByaiGroupChatTurn();
            BeanUtils.copyProperties(persisted, current);
            return current;
        });
        when(turns.markSucceeded(eq(10L), any(), any())).thenAnswer(call -> {
            if (!"RUNNING".equals(persisted.getStatus())) { return 0; }
            persisted.setStatus("SUCCEEDED");
            return 1;
        });
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        when(sequence.nextVal()).thenReturn(90L, 91L);
        AtomicBoolean waiting = new AtomicBoolean(true);
        when(turns.lockGroup(1L)).thenAnswer(call -> {
            // 确定性模拟等待群锁期间，另一入口先完成同一个 turn 的处理。
            if (waiting.getAndSet(false)) {
                if (pollStartsFirst) { handler.afterPersisted(context); }
                else { handler.reconcileTurn(10L); }
            }
            return 1L;
        });

        if (pollStartsFirst) { handler.reconcileTurn(10L); }
        else { handler.afterPersisted(context); }

        verify(messages, times(1)).insert(any(ByaiMessage.class));
        verify(turns, times(1)).markSucceeded(eq(10L), any(), any());
        verify(publisher, times(1)).publish(eq(1L), any(), any());
    }

    @Test
    void completionConflictRollsBackProjectionAndDoesNotPublish() throws Exception {
        turn.setDisposition("CHAT");
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        when(sequence.nextVal()).thenReturn(90L);
        when(turns.markSucceeded(eq(10L), any(), any())).thenReturn(0);
        Connection connection = mock(Connection.class);
        GroupChatExecutionEventHandler transactional = transactionalHandler(connection);

        assertThatThrownBy(() -> transactional.afterPersisted(context))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("completion");

        verify(connection).rollback();
        verify(connection, never()).commit();
        verifyNoInteractions(publisher);
    }

    @Test
    void classificationConflictRollsBackWithoutProjectingChat() throws Exception {
        when(turns.decideDisposition(eq(10L), any(), any(), any(), any())).thenReturn(0);
        when(parser.parse(1L, 8L, "reply")).thenReturn(new GroupChatAgentMention("reply", List.of()));
        Connection connection = mock(Connection.class);
        GroupChatExecutionEventHandler transactional = transactionalHandler(connection);

        assertThatThrownBy(() -> transactional.afterPersisted(context))
            .isInstanceOf(IllegalStateException.class).hasMessageContaining("disposition");

        verify(connection).rollback();
        verify(messages, never()).insert(any(ByaiMessage.class));
        verifyNoInteractions(publisher);
    }

    private GroupChatExecutionEventHandler transactionalHandler(Connection connection) throws Exception {
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        ProxyFactory factory = new ProxyFactory(handler);
        factory.setProxyTargetClass(true);
        factory.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(dataSource),
            new AnnotationTransactionAttributeSource()));
        return (GroupChatExecutionEventHandler) factory.getProxy();
    }

}
