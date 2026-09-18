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
    void storedActivityKeysetHandlesTiesIsolationAndIndexRangeWithoutMessageTable() throws Exception {
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
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getString("detail")).contains("topic_activity", "last_activity_at");
                    assertThat(rows.getString("detail")).doesNotContain("TEMP B-TREE");
                }
            }
        }
    }

    private record PageParameters(Long sessionId, Date beforeTime, Long beforeMessageId, Long beforeTopicId, int limit) {}
}
