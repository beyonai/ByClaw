package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.Statement;
import java.util.Date;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatTaskTurnRecoveryService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** 使用真实 mapper SQL 验证跨轮次竞争，避免 mock 掩盖缺失的更新条件。 */
class GroupChatTaskTurnLifecycleTest {
    @TempDir Path temporary;
    private SqlSession session;
    private ByaiGroupChatTaskMapper mapper;
    private GroupChatTaskService service;
    private final GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private GroupChatTaskTurnRecoveryService recovery;

    @BeforeEach
    void setUp() throws Exception {
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + temporary.resolve("task-turn.sqlite"), null, null);
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_group_chat_task (task_session_id BIGINT PRIMARY KEY, "
                + "group_session_id BIGINT, source_message_id BIGINT, dispatch_id BIGINT, initiator_user_id BIGINT, "
                + "target_agent_id BIGINT, task_name TEXT, status TEXT, turn_status TEXT, current_turn_id BIGINT, "
                + "current_turn_trace_id TEXT, publish_message_id BIGINT, publish_by BIGINT, create_time TIMESTAMP, "
                + "update_time TIMESTAMP)");
        }
        MybatisConfiguration configuration = new MybatisConfiguration(
            new Environment("task-turn-test", new JdbcTransactionFactory(), dataSource));
        configuration.addMapper(ByaiGroupChatTaskMapper.class);
        session = new MybatisSqlSessionFactoryBuilder().build(configuration).openSession(true);
        mapper = session.getMapper(ByaiGroupChatTaskMapper.class);
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(102L, 103L, 104L);
        service = new GroupChatTaskService(mapper, null, null, messages, sequence, null, null, null,
            null, null, null, publisher, null, null, null);
        recovery = new GroupChatTaskTurnRecoveryService(mapper, messages, service);
        insertTask(60L, "ACTIVE", "WAITING_USER", 101L, "first-trace");
    }

    @AfterEach
    void close() {
        if (session != null) session.close();
    }

    @Test
    void secondTurnCompletesAndLateCallbacksCannotCompleteThirdTurn() {
        Long second = service.startTurn(60L);
        assertThat(second).isEqualTo(102L);
        assertThat(mapper.selectById(60L).getCurrentTurnTraceId()).isNull();
        assertThat(service.startTurn(60L)).isNull();
        service.bindTurn(60L, second, "second-trace");
        service.completeTurn(60L, "second-trace", false);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("WAITING_USER");

        Long third = service.startTurn(60L);
        service.bindTurn(60L, third, "third-trace");
        reset(publisher);
        service.completeTurn(60L, "first-trace", false);
        service.completeTurn(60L, "second-trace", true);
        service.failTurnStart(60L, second);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("RUNNING");
        assertThat(mapper.selectById(60L).getCurrentTurnId()).isEqualTo(third);
        verifyNoInteractions(publisher);

        service.completeTurn(60L, "third-trace", false);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("WAITING_USER");
        reset(publisher);
        service.completeTurn(60L, "third-trace", true);
        service.failTurnStart(60L, third);
        verifyNoInteractions(publisher);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("WAITING_USER");
    }

    @Test
    void failedPreparationReleasesOnlyItsReservationAndCannotRebindAnotherTrace() {
        Long first = service.startTurn(60L);
        service.failTurnStart(60L, first);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("FAILED");
        Long next = service.startTurn(60L);
        assertThatThrownBy(() -> service.bindTurn(60L, first, "stale-trace"))
            .hasMessageContaining("no longer current");
        service.bindTurn(60L, next, "next-trace");
        service.bindTurn(60L, next, "next-trace");
        assertThatThrownBy(() -> service.bindTurn(60L, next, "different-trace"))
            .hasMessageContaining("no longer current");
        service.failTurnStart(60L, first);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("RUNNING");
        service.failTurnStart(60L, next);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("FAILED");
    }

    @Test
    void newTurnCannotReuseAPersistedCompletedAnswer() {
        Long turn = service.startTurn(60L);
        ByaiMessage previous = answer(60L, 31L);
        when(messages.selectByMessageId(31L)).thenReturn(previous);
        assertThatThrownBy(() -> service.bindTurn(60L, turn, TraceIdCodec.encode(21L, 31L)))
            .hasMessageContaining("new answer message ID");
        assertThat(mapper.selectById(60L).getCurrentTurnTraceId()).isNull();
        service.failTurnStart(60L, turn);
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("FAILED");
    }

    @Test
    void terminalTasksCannotBeChangedByCompletionOrStartupCallbacks() {
        Long turn = service.startTurn(60L);
        service.bindTurn(60L, turn, "cancelled-trace");
        mapper.cancel(60L, new Date());
        reset(publisher);
        service.completeTurn(60L, "cancelled-trace", false);
        service.failTurnStart(60L, turn);
        assertThat(service.startTurn(60L)).isNull();
        assertThat(mapper.selectById(60L).getStatus()).isEqualTo("CANCELLED");
        insertTask(70L, "PUBLISHED", "WAITING_USER", 200L, "published-trace");
        service.completeTurn(70L, "published-trace", true);
        service.failTurnStart(70L, 200L);
        assertThat(service.startTurn(70L)).isNull();
        assertThat(mapper.selectById(70L).getTurnStatus()).isEqualTo("WAITING_USER");
        verifyNoInteractions(publisher);
    }

    @Test
    void recoveryUsesPersistedAnswerAndPagesPastUnfinishedTasks() {
        String trace = TraceIdCodec.encode(21L, 31L);
        service.bindTurn(60L, service.startTurn(60L), trace);
        insertTask(70L, "ACTIVE", "RUNNING", 201L, TraceIdCodec.encode(22L, 32L));
        insertTask(80L, "ACTIVE", "RUNNING", null, null);
        insertTask(90L, "CANCELLED", "RUNNING", 202L, TraceIdCodec.encode(23L, 33L));
        ByaiMessage answer = answer(70L, 32L);
        answer.setMetadata("{\"turnFailed\":true}");
        when(messages.selectByMessageId(32L)).thenReturn(answer);
        ReflectionTestUtils.setField(recovery, "batchSize", 1);

        recovery.recover();
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("RUNNING");
        recovery.recover();
        assertThat(mapper.selectById(70L).getTurnStatus()).isEqualTo("FAILED");
        recovery.recover();
        when(messages.selectByMessageId(31L)).thenReturn(answer(60L, 31L));
        recovery.recover();
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("WAITING_USER");
        assertThat(mapper.selectById(80L).getTurnStatus()).isEqualTo("RUNNING");
        assertThat(mapper.selectBoundRunningPage(0L, 100)).isEmpty();
    }

    @Test
    void recoveryRejectsWrongSessionUserMessagesAndIncompleteAnswers() {
        service.bindTurn(60L, service.startTurn(60L), TraceIdCodec.encode(21L, 31L));
        ByaiMessage answer = answer(61L, 31L);
        when(messages.selectByMessageId(31L)).thenReturn(answer);
        reset(publisher);
        recovery.recover();
        answer.setSessionId(60L);
        answer.setUsage(1);
        recovery.recover();
        answer.setUsage(2);
        answer.setIsComplete(false);
        answer.setMsgStatus(null);
        recovery.recover();
        assertThat(mapper.selectById(60L).getTurnStatus()).isEqualTo("RUNNING");
        verifyNoInteractions(publisher);
    }

    private void insertTask(Long id, String status, String turnStatus, Long turnId, String traceId) {
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(id);
        task.setGroupSessionId(10L);
        task.setStatus(status);
        task.setTurnStatus(turnStatus);
        task.setCurrentTurnId(turnId);
        task.setCurrentTurnTraceId(traceId);
        mapper.insert(task);
    }

    private ByaiMessage answer(Long sessionId, Long messageId) {
        ByaiMessage message = new ByaiMessage();
        message.setSessionId(sessionId);
        message.setMessageId(messageId);
        message.setUsage(2);
        message.setIsComplete(true);
        return message;
    }
}
