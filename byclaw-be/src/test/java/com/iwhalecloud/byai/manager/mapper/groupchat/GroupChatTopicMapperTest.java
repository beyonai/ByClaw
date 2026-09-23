package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.nio.file.Path;
import java.util.Date;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;

/** SQLite 执行真实分页 SQL；不将其解释为 OpenGauss MERGE 或线上性能验证。 */
class GroupChatTopicMapperTest {
    @TempDir Path directory;

    @Test
    void storedActivityKeysetHandlesTiesIsolationAndIndexRange() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("topics.sqlite");
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("""
                CREATE TABLE byai_group_chat_topic (
                    topic_id BIGINT PRIMARY KEY, group_session_id BIGINT, root_message_id BIGINT,
                    last_message_id BIGINT, last_activity_at TIMESTAMP, create_time TIMESTAMP)
                """);
            sql.execute("CREATE INDEX topic_activity ON byai_group_chat_topic "
                + "(group_session_id, last_activity_at DESC, last_message_id DESC, topic_id DESC)");
            sql.execute("INSERT INTO byai_group_chat_topic VALUES "
                + "(1,10,1,30,2000,0),(2,10,2,30,2000,0),(3,10,3,29,2000,0),"
                + "(4,10,4,99,1000,0),(5,11,5,100,3000,0)");
            sql.execute("CREATE TABLE byai_message (session_id BIGINT, topic_id BIGINT, recalled_at TIMESTAMP)");
            sql.execute("CREATE INDEX message_topic ON byai_message (session_id, topic_id)");
            sql.execute("INSERT INTO byai_message VALUES "
                + "(10,1,NULL),(10,2,NULL),(10,3,NULL),(10,4,NULL),(11,5,NULL)");
        }
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiGroupChatTopicMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(ByaiGroupChatTopicMapper.class);
            assertThat(mapper.selectPage(10L, null, null, null, 2))
                .extracting(ByaiGroupChatTopic::getTopicId).containsExactly(2L, 1L);
            assertThat(mapper.selectPage(10L, new Date(2000), 30L, 1L, 2))
                .extracting(ByaiGroupChatTopic::getTopicId).containsExactly(3L, 4L);
            assertThat(mapper.selectPage(10L, new Date(1000), 99L, 4L, 2)).isEmpty();
            assertThat(mapper.selectPage(11L, null, null, null, 2))
                .extracting(ByaiGroupChatTopic::getTopicId).containsExactly(5L);
            var bound = config.getMappedStatement(ByaiGroupChatTopicMapper.class.getName() + ".selectPage")
                .getBoundSql(new PageParameters(10L, new Date(2000), 30L, 1L, 2));
            try (var explain = session.getConnection().prepareStatement("EXPLAIN QUERY PLAN " + bound.getSql())) {
                explain.setLong(1, 10L); explain.setLong(2, 2000L); explain.setLong(3, 30L);
                explain.setLong(4, 1L); explain.setInt(5, 2);
                try (ResultSet rows = explain.executeQuery()) {
                    StringBuilder plan = new StringBuilder();
                    while (rows.next()) plan.append(rows.getString("detail")).append('\n');
                    assertThat(plan.toString()).contains("topic_activity", "message_topic");
                    assertThat(plan.toString()).doesNotContain("TEMP B-TREE");
                }
            }
        }
    }

    @Test
    void filtersFullyRecalledTopicsBeforeLimitAndCursor() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("recalled-topics.sqlite");
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("""
                CREATE TABLE byai_group_chat_topic (
                    topic_id BIGINT PRIMARY KEY, group_session_id BIGINT, root_message_id BIGINT,
                    last_message_id BIGINT, last_activity_at TIMESTAMP, create_time TIMESTAMP)
                """);
            sql.execute("CREATE TABLE byai_message (session_id BIGINT, topic_id BIGINT, recalled_at TIMESTAMP)");
            sql.execute("INSERT INTO byai_group_chat_topic VALUES "
                + "(1,10,1,11,5000,0),(2,10,2,21,4000,0),(3,10,3,31,3000,0),"
                + "(4,10,4,41,2000,0),(5,11,5,51,6000,0)");
            sql.execute("INSERT INTO byai_message VALUES "
                + "(10,1,123),(10,1,124)," // 全部撤回，话题 1 不可见。
                + "(10,2,123),(10,2,NULL)," // 有一条未撤回，话题 2 可见。
                + "(10,3,123),(10,4,NULL),(11,5,NULL)," // 其他群的同 ID 不可借用。
                + "(11,3,NULL)");
        }
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiGroupChatTopicMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(ByaiGroupChatTopicMapper.class);
            assertThat(mapper.selectPage(10L, null, null, null, 2))
                .extracting(ByaiGroupChatTopic::getTopicId).containsExactly(2L, 4L);
            assertThat(mapper.selectPage(10L, new Date(4000), 21L, 2L, 2))
                .extracting(ByaiGroupChatTopic::getTopicId).containsExactly(4L);
            assertThat(mapper.selectPage(11L, null, null, null, 2))
                .extracting(ByaiGroupChatTopic::getTopicId).containsExactly(5L);
        }
    }

    private record PageParameters(Long sessionId, Date beforeTime, Long beforeMessageId, Long beforeTopicId, int limit) {}
}
