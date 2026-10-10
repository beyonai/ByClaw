package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.alibaba.druid.wall.WallConfig;
import com.alibaba.druid.wall.spi.PGWallProvider;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;

/** 执行附件候选消息查询，验证时间顺序、可见范围和轻量投影。 */
class GroupChatFilePageMapperTest {
    private static final String QUERY = ByaiMessageMapper.class.getName() + ".selectGroupFileMessagePage";
    @TempDir Path directory;

    @Test
    void readsNewestAttachmentCandidatesWithoutMessageBodies() throws Exception {
        var config = configuration();
        assertThat(config.hasStatement(QUERY)).as("file pagination query is registered").isTrue();
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            List<ByaiMessage> rows = session.selectList(QUERY, parameters(null, false, 2));
            assertThat(rows).extracting(ByaiMessage::getMessageId).containsExactly(5L, 10L);
            assertThat(rows).allSatisfy(row -> {
                assertThat(row.getSessionId()).isEqualTo(10L);
                assertThat(row.getCreateTime()).isNotNull();
                assertThat(row.getMessageContent()).isNull();
                assertThat(row.getInferLog()).isNull();
            });
            assertThat(rows.get(0).getRelatedResources()).contains("files");
            assertThat(rows.get(1).getMetadata()).contains("TASK_RESULT");
        }
    }

    @Test
    void continuesAtDatabaseTimestampPrecisionAndCanResumeInsideOneMessage() throws Exception {
        var config = configuration();
        assertThat(config.hasStatement(QUERY)).as("file pagination query is registered").isTrue();
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            List<ByaiMessage> inclusive = session.selectList(QUERY, parameters(10L, true, 10));
            assertThat(inclusive).extracting(ByaiMessage::getMessageId).containsExactly(10L, 11L, 30L, 20L);
            List<ByaiMessage> older = session.selectList(QUERY, parameters(10L, false, 10));
            assertThat(older).extracting(ByaiMessage::getMessageId).containsExactly(11L, 30L, 20L);
            assertThat(session.<ByaiMessage>selectList(QUERY, parameters(99L, true, 10))).isEmpty();
            // 撤回游标所在消息后仍可从其原始时间位置向前翻页，但不再返回该消息的附件。
            try (Statement sql = session.getConnection().createStatement()) {
                sql.execute("UPDATE byai_message SET recalled_at=9000 WHERE message_id=10");
            }
            session.clearCache();
            assertThat(session.<ByaiMessage>selectList(QUERY, parameters(10L, true, 10)))
                .extracting(ByaiMessage::getMessageId).containsExactly(11L, 30L, 20L);
            // 无时间的旧消息排在有时间消息之后，仍可按消息 ID 继续翻页。
            try (Statement sql = session.getConnection().createStatement()) {
                sql.execute("INSERT INTO byai_message(message_id,session_id,related_resources,usage) "
                    + "VALUES (1000,10,'{}',1),(2000,10,'{}',1)");
            }
            session.clearCache();
            assertThat(session.<ByaiMessage>selectList(QUERY, parameters(20L, false, 10)))
                .extracting(ByaiMessage::getMessageId).containsExactly(2000L, 1000L);
            assertThat(session.<ByaiMessage>selectList(QUERY, parameters(2000L, true, 10)))
                .extracting(ByaiMessage::getMessageId).containsExactly(2000L, 1000L);
            assertThat(session.<ByaiMessage>selectList(QUERY, parameters(2000L, false, 10)))
                .extracting(ByaiMessage::getMessageId).containsExactly(1000L);
        }
    }

    @Test
    void generatedQueryPassesPostgresWallAndExcludesLargeColumns() throws Exception {
        var config = configuration();
        assertThat(config.hasStatement(QUERY)).as("file pagination query is registered").isTrue();
        for (boolean inclusive : List.of(false, true)) {
            String sql = config.getMappedStatement(QUERY).getBoundSql(parameters(10L, inclusive, 10)).getSql();
            assertThat(new PGWallProvider(new WallConfig()).check(sql).getViolations()).isEmpty();
            assertThat(sql).doesNotContain("message_content", "infer_log", "call_logs", "COUNT(", "OFFSET");
        }
    }

    private Map<String, Object> parameters(Long cursor, boolean inclusive, int limit) {
        Map<String, Object> values = new HashMap<>();
        values.put("sessionId", 10L);
        values.put("beforeMessageId", cursor);
        values.put("includeCursor", inclusive);
        values.put("limit", limit);
        return values;
    }

    private MybatisConfiguration configuration() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("file-page.sqlite");
        var config = new MybatisConfiguration(new Environment("sqlite", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        config.addMapper(ByaiMessageMapper.class);
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_message (message_id BIGINT, session_id BIGINT, create_time TIMESTAMP, "
                + "related_resources TEXT, metadata TEXT, usage INTEGER, archived_at TIMESTAMP, "
                + "recalled_at TIMESTAMP, message_content TEXT, infer_log TEXT)");
            sql.execute("INSERT INTO byai_message(message_id,session_id,create_time,related_resources,metadata,usage,message_content,infer_log) VALUES "
                + "(5,10,3000,'{\"files\":[{}]}',NULL,1,'body','large log'),"
                + "(10,10,2000.2,NULL,'{\"scene\":\"GROUP_CHAT\",\"kind\":\"TASK_RESULT\",\"files\":[{}]}',2,'body','log'),"
                + "(11,10,2000.1,'{\"files\":[{}]}',NULL,1,NULL,NULL),"
                + "(20,10,1000,'{\"files\":[{}]}',NULL,1,NULL,NULL),"
                + "(30,10,1000,'{\"files\":[{}]}',NULL,1,NULL,NULL),"
                + "(31,10,4000,NULL,NULL,1,'text only',NULL),"
                + "(32,10,4000,'   ','',1,NULL,NULL),"
                + "(40,10,4000,'{\"files\":[{}]}',NULL,1,NULL,NULL),"
                + "(41,10,4000,'{\"files\":[{}]}',NULL,1,NULL,NULL),"
                + "(42,10,4000,'{\"files\":[{}]}',NULL,5,NULL,NULL),"
                + "(99,11,5000,'{\"files\":[{}]}',NULL,1,NULL,NULL)");
            sql.execute("UPDATE byai_message SET archived_at=1 WHERE message_id=40");
            sql.execute("UPDATE byai_message SET recalled_at=1 WHERE message_id=41");
        }
        return config;
    }
}
