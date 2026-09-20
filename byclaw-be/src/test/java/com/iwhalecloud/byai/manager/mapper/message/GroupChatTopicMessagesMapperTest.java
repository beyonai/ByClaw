package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Map;
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

/** 在临时 SQLite 中执行实际 Mapper，覆盖时间并列和分页期间追加。 */
class GroupChatTopicMessagesMapperTest {
    @TempDir Path directory;

    @Test
    void ascendingPagesExcludeRootInvisibleAndForeignMessages() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("topic-messages.sqlite");
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiMessageMapper.class);
        // Derive nullable projection columns from the mapped SQL to avoid duplicating the large message schema.
        String query = config.getMappedStatement(ByaiMessageMapper.class.getName() + ".selectTopicMessages")
            .getBoundSql(Map.of("sessionId", 10L, "topicId", 100L, "rootMessageId", 100L, "limit", 20)).getSql();
        String columns = query.substring(query.indexOf("SELECT") + 6, query.indexOf("FROM"));
        String schema = Stream.of(columns.split(",")).map(String::trim)
            .map(column -> column + (column.equals("create_time") || column.equals("archived_at")
                ? " TIMESTAMP" : " BIGINT")).collect(Collectors.joining(","));
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_message (" + schema + ")");
            sql.execute("CREATE INDEX topic_time ON byai_message(session_id,topic_id,create_time DESC,message_id DESC)");
            sql.execute("INSERT INTO byai_message(session_id,topic_id,message_id,create_time,archived_at,usage,message_content) VALUES "
                + "(10,100,100,1000,NULL,1,'root'),(10,100,101,2000,NULL,1,'reply'),"
                + "(10,100,102,2000,NULL,2,'branch'),(10,100,103,3000,NULL,1,'reply'),"
                + "(11,100,104,2000,NULL,1,'foreign'),(10,200,105,2000,NULL,1,'other topic'),"
                + "(10,100,106,2000,1,1,'archived'),(10,100,107,2000,NULL,5,'system'),"
                + "(10,100,108,2000,NULL,1,NULL)");
        }
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(ByaiMessageMapper.class);
            assertThat(mapper.selectTopicMessages(10L, 100L, 100L, null, 1))
                .extracting(ByaiMessage::getMessageId).containsExactly(101L);
            assertThat(mapper.selectTopicMessages(10L, 100L, 100L, 101L, 2))
                .extracting(ByaiMessage::getMessageId).containsExactly(102L, 103L);
            try (Statement sql = session.getConnection().createStatement()) {
                sql.execute("INSERT INTO byai_message(session_id,topic_id,message_id,create_time,usage,message_content) "
                    + "VALUES (10,100,109,4000,1,'new'),(10,100,110,2000.2,1,'later'),"
                    + "(10,100,111,2000.1,1,'earlier')");
            }
            // The database boundary keeps precision beyond the Date projection, even with inverted IDs.
            assertThat(mapper.selectTopicMessages(10L, 100L, 100L, 111L, 2))
                .extracting(ByaiMessage::getMessageId).containsExactly(110L, 103L);
            assertThat(mapper.selectTopicMessages(10L, 100L, 100L, 103L, 2))
                .extracting(ByaiMessage::getMessageId).containsExactly(109L);
        }
    }
}
