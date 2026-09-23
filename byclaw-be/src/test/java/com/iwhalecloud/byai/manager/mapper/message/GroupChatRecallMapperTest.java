package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Date;
import java.util.Map;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;

/** 执行真实条件更新和分页 SQL；SQLite 不用于证明 OpenGauss 行锁行为。 */
class GroupChatRecallMapperTest {
    @TempDir Path directory;

    @Test
    void conditionalUpdatePreservesContentAndAnchorsWhileSearchExcludesRecalledRows() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("recall.sqlite");
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiMessageMapper.class);
        String query = config.getMappedStatement(ByaiMessageMapper.class.getName() + ".selectByMessageId")
            .getBoundSql(Map.of("messageId", 1L)).getSql();
        String columns = query.substring(query.indexOf("SELECT") + 6, query.indexOf("FROM"));
        String schema = Stream.of(columns.split(",")).map(String::trim)
            .map(column -> column + (column.endsWith("_at") || column.endsWith("_time") ? " TIMESTAMP" : " BIGINT"))
            .collect(Collectors.joining(","));
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_message (" + schema + ")");
            sql.execute("INSERT INTO byai_message(message_id,session_id,topic_id,message_ref,usage,message_content,create_time) VALUES "
                + "(1,10,1,NULL,1,'SECRET',1000),(2,10,1,1,1,'reply',2000),(3,10,NULL,NULL,5,'system',3000)");
        }
        var locking = config.getMappedStatement(ByaiMessageMapper.class.getName() + ".selectForRecall");
        assertThat(locking.isFlushCacheRequired()).isTrue();
        assertThat(locking.isUseCache()).isFalse();
        assertThat(locking.getBoundSql(Map.of("sessionId", 10L, "messageId", 1L)).getSql()).contains("FOR UPDATE");
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(ByaiMessageMapper.class);
            assertThat(mapper.recallGroupMessage(10L, 1L, 7L, new Date(5000))).isEqualTo(1);
            assertThat(mapper.recallGroupMessage(10L, 1L, 8L, new Date(6000))).isZero();
            assertThat(mapper.recallGroupMessage(10L, 3L, 8L, new Date(6000))).isZero();
            assertThat(mapper.recallGroupMessage(99L, 2L, 8L, new Date(6000))).isZero();
            ByaiMessage original = mapper.selectByMessageId(1L);
            assertThat(original.getMessageContent()).isEqualTo("SECRET");
            assertThat(original.getRecalledBy()).isEqualTo(7L);
            assertThat(original.getRecalledAt()).isEqualTo(new Date(5000));
            assertThat(original.getTopicId()).isEqualTo(1L);
            assertThat(mapper.countBySessionId(10L)).isEqualTo(3);
            assertThat(mapper.selectVisibleGroupMessage(10L, 1L).isRecalled()).isTrue();
            assertThat(mapper.selectTimelineBeforeMessageId(10L, 4L, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(3L, 2L, 1L);
            assertThat(mapper.selectTopicMessages(10L, 1L, 1L, 1L, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(2L);
            assertThat(mapper.searchVisibleGroupMessages(10L, null, "ALL", "ALL", 7L, null, null, null, 1))
                .extracting(ByaiMessage::getMessageId).containsExactly(2L);
            assertThat(mapper.selectVisibleGroupMessagesByIds(10L, List.of(1L)).get(0).isRecalled()).isTrue();
        }
    }
}
