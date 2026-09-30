package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.*;
import java.util.List;
import java.util.Date;
import java.util.UUID;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatRecallStop;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;

class GroupChatRecallStopMapperTest {
    @Test
    void cancellationSurvivesNewSessionAndDoesNotOverwriteCompletedExecutionsOrPublishedTasks() throws Exception {
        var source = new UnpooledDataSource("org.h2.Driver", "jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1", "sa", "");
        try (var connection = source.getConnection(); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_group_chat_recall_stop (execution_id BIGINT PRIMARY KEY, session_id BIGINT, "
                + "initiator_user_id BIGINT, trace_id VARCHAR, task_owned BOOLEAN, status VARCHAR)");
            sql.execute("CREATE TABLE byai_group_chat_turn (execution_id BIGINT PRIMARY KEY, group_session_id BIGINT, "
                + "trigger_message_id BIGINT, parent_turn_id BIGINT, status VARCHAR, error_code VARCHAR, finish_time TIMESTAMP)");
            sql.execute("CREATE TABLE byai_group_chat_execution (execution_id BIGINT PRIMARY KEY, group_session_id BIGINT, "
                + "status VARCHAR, error_code VARCHAR, finish_time TIMESTAMP)");
            sql.execute("CREATE TABLE byai_group_chat_task (task_session_id BIGINT PRIMARY KEY, status VARCHAR, update_time TIMESTAMP)");
            sql.execute("INSERT INTO byai_group_chat_turn(execution_id, group_session_id, trigger_message_id, status) VALUES "
                + "(1,10,100,'QUEUED'),(2,10,100,'RUNNING'),(3,10,101,'SUCCEEDED')");
            sql.execute("INSERT INTO byai_group_chat_execution(execution_id, group_session_id, status) VALUES "
                + "(4,10,'CONVERSATION'),(5,10,'RUNNING')");
            sql.execute("INSERT INTO byai_group_chat_task(task_session_id,status) VALUES (20,'ACTIVE'),(21,'PUBLISHED')");
        }
        var configuration = new MybatisConfiguration(new Environment("h2", new JdbcTransactionFactory(), source));
        configuration.setMapUnderscoreToCamelCase(true);
        configuration.addMapper(ByaiGroupChatRecallMapper.class);
        configuration.addMapper(ByaiGroupChatTaskMapper.class);
        var factory = new SqlSessionFactoryBuilder().build(configuration);
        try (var session = factory.openSession(true)) {
            var mapper = session.getMapper(ByaiGroupChatRecallMapper.class);
            // 同一 SqlSession 内也必须看到新屏障，不能沿用第一次查询的 false。
            assertThat(mapper.isRecalled(2L)).isFalse();
            var stop = new ByaiGroupChatRecallStop();
            stop.setExecutionId(2L);
            stop.setSessionId(20L);
            stop.setInitiatorUserId(7L);
            stop.setTraceId("trace");
            stop.setTaskOwned(true);
            stop.setStatus("PENDING");
            mapper.insertStop(stop);
            assertThat(mapper.isRecalled(2L)).isTrue();
            assertThat(mapper.cancelTurn(1L)).isEqualTo(1);
            assertThat(mapper.cancelTurn(2L)).isEqualTo(1);
            assertThat(mapper.cancelTurn(3L)).isZero();
            assertThat(mapper.cancelExecution(4L)).isZero();
            assertThat(mapper.cancelExecution(5L)).isEqualTo(1);
            assertThat(mapper.turns(10L)).extracting(ByaiGroupChatTurn::getStatus)
                .containsExactly("CANCELLED", "CANCELLED", "SUCCEEDED");
            assertThat(mapper.executions(10L)).hasSize(1);
            var tasks = session.getMapper(ByaiGroupChatTaskMapper.class);
            assertThat(tasks.cancel(20L, new Date())).isEqualTo(1);
            assertThat(tasks.cancel(21L, new Date())).isZero();
        }
        try (var session = factory.openSession(true)) {
            var mapper = session.getMapper(ByaiGroupChatRecallMapper.class);
            assertThat(mapper.pendingSessions(0L, 100)).isEqualTo(List.of(20L));
            assertThat(mapper.pendingSessions(20L, 100)).isEmpty();
            assertThat(mapper.pending(20L).get(0).isTaskOwned()).isTrue();
            mapper.finishStop(2L);
            assertThat(mapper.pending(20L)).isEmpty();
            assertThat(mapper.isRecalled(2L)).isTrue();
        }
    }
}
