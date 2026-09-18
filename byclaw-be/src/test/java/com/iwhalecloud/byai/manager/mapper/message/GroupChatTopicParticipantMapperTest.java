package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.core.MybatisConfiguration;

/** 用真实 SQL 验证参与者身份去重、群隔离和首次发言顺序。 */
class GroupChatTopicParticipantMapperTest {
    @TempDir Path directory;

    @Test
    void selectsEveryUserAndAgentOnceForTheRequestedTopicPage() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("topic-participants.sqlite");
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("""
                CREATE TABLE byai_message (
                    session_id BIGINT, topic_id BIGINT, message_id BIGINT, creator_id BIGINT,
                    creator_name VARCHAR(100), "usage" INTEGER)
                """);
            sql.execute("INSERT INTO byai_message VALUES "
                + "(10,100,1,7,'小林',1),(10,100,2,9,'分析助手',2),(10,100,3,7,'林同学',1),"
                + "(10,101,4,8,'小周',1),(11,100,5,6,'其他群成员',1),(10,100,6,NULL,'未知',2)");
        }
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiMessageMapper.class);
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var rows = session.getMapper(ByaiMessageMapper.class)
                .selectGroupTopicParticipants(10L, List.of(100L, 101L));
            assertThat(rows).extracting("topicId", "memberType", "memberId", "firstMessageId")
                .containsExactly(
                    org.assertj.core.groups.Tuple.tuple(100L, "USER", 7L, 1L),
                    org.assertj.core.groups.Tuple.tuple(100L, "AGENT", 9L, 2L),
                    org.assertj.core.groups.Tuple.tuple(101L, "USER", 8L, 4L));
        }
    }
}
