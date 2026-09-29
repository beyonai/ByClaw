package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.Statement;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTurnMapper;

class GroupChatSchedulingMapperTest {
    @TempDir Path temporary;
    private SqlSessionFactory factory;

    @BeforeEach
    void setUp() throws Exception {
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + temporary.resolve("scheduling.sqlite"), null, null);
        try (Connection connection = dataSource.getConnection(); Statement sql = connection.createStatement()) {
            // The discovery projection must not depend on large input or metadata columns.
            for (String table : new String[] {"byai_group_chat_turn", "byai_group_chat_execution"}) {
                sql.execute("CREATE TABLE " + table + " (execution_id BIGINT PRIMARY KEY, "
                    + "candidate_session_id BIGINT, status VARCHAR(32), trace_id VARCHAR(255))");
                sql.execute("INSERT INTO " + table + " VALUES "
                    + "(1,10,'QUEUED',NULL),(2,10,'QUEUED',NULL),(3,20,'QUEUED',NULL),"
                    + "(4,30,'RUNNING',NULL),(5,40,'RUNNING','trace-5'),"
                    + "(6,50,'SUCCEEDED','trace-6'),(7,60,'CONVERSATION',NULL)");
            }
        }
        MybatisConfiguration configuration = new MybatisConfiguration(
            new Environment("scheduling-test", new JdbcTransactionFactory(), dataSource));
        configuration.addMapper(ByaiGroupChatExecutionMapper.class);
        configuration.addMapper(ByaiGroupChatTurnMapper.class);
        factory = new MybatisSqlSessionFactoryBuilder().build(configuration);
    }

    @Test
    void queuedDiscoveryPagesAcrossSessionHeadsWithoutReturningBusySessionTail() {
        try (SqlSession session = factory.openSession()) {
            ByaiGroupChatTurnMapper turns = session.getMapper(ByaiGroupChatTurnMapper.class);
            assertThat(turns.selectQueuedPage(0L, 1)).extracting(ByaiGroupChatExecution::getExecutionId)
                .containsExactly(1L);
            assertThat(turns.selectQueuedPage(1L, 1)).extracting(ByaiGroupChatExecution::getExecutionId)
                .containsExactly(3L);
            assertThat(turns.selectQueuedPage(3L, 1)).isEmpty();
            assertThat(turns.selectQueuedPage(0L, 10)).extracting(ByaiGroupChatExecution::getCandidateSessionId)
                .containsExactly(10L, 20L);
        }
    }

    @Test
    void recoverySeparatesUnboundFromBoundAndExcludesTerminalRecords() {
        try (SqlSession session = factory.openSession()) {
            ByaiGroupChatTurnMapper turns = session.getMapper(ByaiGroupChatTurnMapper.class);
            assertThat(turns.selectUnboundPage(0L, 10)).extracting(ByaiGroupChatExecution::getExecutionId)
                .containsExactly(4L);
            assertThat(turns.selectBoundPage(0L, 10)).extracting(ByaiGroupChatExecution::getExecutionId)
                .containsExactly(5L);
            assertThat(turns.selectUnboundPage(4L, 10)).isEmpty();
            assertThat(turns.selectBoundPage(5L, 10)).isEmpty();
        }
    }

    @Test
    void legacyDiscoveryRetainsQueuedExecutionsAndSkipsConversationAnchors() {
        try (SqlSession session = factory.openSession()) {
            ByaiGroupChatExecutionMapper executions = session.getMapper(ByaiGroupChatExecutionMapper.class);
            assertThat(executions.selectQueuedPage(0L, 2)).extracting(ByaiGroupChatExecution::getExecutionId)
                .containsExactly(1L, 2L);
            assertThat(executions.selectQueuedPage(2L, 2)).extracting(ByaiGroupChatExecution::getExecutionId)
                .containsExactly(3L);
            assertThat(executions.selectBoundPage(0L, 10)).extracting(ByaiGroupChatExecution::getTraceId)
                .containsExactly("trace-5");
        }
    }
}
