package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.DriverManager;
import java.util.Date;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;

/** 执行真实 Mapper SQL，验证任务准入与迟到回调隔离；不替代生产数据库并发验证。 */
class GroupChatTaskTurnMapperTest {
    @TempDir Path directory;

    @ParameterizedTest
    @ValueSource(strings = {"RUNNING", "WAITING_USER", "FAILED"})
    void activeTaskRegistersNewTurnRegardlessOfPreviousTurnStatus(String turnStatus) throws Exception {
        try (var session = openSession("ACTIVE", turnStatus)) {
            var mapper = session.getMapper(ByaiGroupChatTaskMapper.class);
            assertThat(mapper.claimTurn(60L, 101L, new Date())).isEqualTo(1);
            assertTurn(session, "ACTIVE", "RUNNING", 101L, null);
            assertThat(mapper.bindTurn(60L, 101L, "new-trace", new Date())).isEqualTo(1);
            assertTurn(session, "ACTIVE", "RUNNING", 101L, "new-trace");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"PUBLISHED", "CANCELLED"})
    void terminalTaskCannotRegisterNewTurn(String status) throws Exception {
        try (var session = openSession(status, "WAITING_USER")) {
            var mapper = session.getMapper(ByaiGroupChatTaskMapper.class);
            assertThat(mapper.claimTurn(60L, 101L, new Date())).isZero();
            assertTurn(session, status, "WAITING_USER", 100L, "old-trace");
        }
    }

    @Test
    void supersededTurnCannotBindCompleteOrFailTheNewTurn() throws Exception {
        try (var session = openSession("ACTIVE", "RUNNING")) {
            var mapper = session.getMapper(ByaiGroupChatTaskMapper.class);
            assertThat(mapper.claimTurn(60L, 101L, new Date())).isEqualTo(1);
            // 新 trace 尚未绑定时，旧轮次的准备和完成回调也不能重新取得当前轮次。
            assertThat(mapper.bindTurn(60L, 100L, "old-trace", new Date())).isZero();
            assertThat(mapper.completeTurn(60L, "old-trace", "WAITING_USER", new Date())).isZero();
            assertThat(mapper.failTurnStart(60L, 100L, new Date())).isZero();
            assertThat(mapper.bindTurn(60L, 101L, "new-trace", new Date())).isEqualTo(1);
            assertThat(mapper.completeTurn(60L, "old-trace", "FAILED", new Date())).isZero();
            assertTurn(session, "ACTIVE", "RUNNING", 101L, "new-trace");
            assertThat(mapper.completeTurn(60L, "new-trace", "WAITING_USER", new Date())).isEqualTo(1);
            assertTurn(session, "ACTIVE", "WAITING_USER", 101L, "new-trace");
        }
    }

    private SqlSession openSession(String status, String turnStatus) throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("task.sqlite");
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("""
                CREATE TABLE byai_group_chat_task (
                    task_session_id BIGINT PRIMARY KEY, status TEXT, turn_status TEXT,
                    current_turn_id BIGINT, current_turn_trace_id TEXT, update_time TIMESTAMP)
                """);
            try (var insert = connection.prepareStatement(
                "INSERT INTO byai_group_chat_task VALUES (60, ?, ?, 100, 'old-trace', 0)")) {
                insert.setString(1, status);
                insert.setString(2, turnStatus);
                insert.executeUpdate();
            }
        }
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiGroupChatTaskMapper.class);
        return new SqlSessionFactoryBuilder().build(config).openSession(true);
    }

    private void assertTurn(SqlSession session, String status, String turnStatus, long turnId, String traceId)
        throws Exception {
        try (var query = session.getConnection().createStatement();
            var row = query.executeQuery("SELECT * FROM byai_group_chat_task WHERE task_session_id = 60")) {
            assertThat(row.next()).isTrue();
            assertThat(row.getString("status")).isEqualTo(status);
            assertThat(row.getString("turn_status")).isEqualTo(turnStatus);
            assertThat(row.getLong("current_turn_id")).isEqualTo(turnId);
            assertThat(row.getString("current_turn_trace_id")).isEqualTo(traceId);
        }
    }
}
