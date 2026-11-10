package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.tuple;

import java.util.Date;
import java.util.List;
import java.util.UUID;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.entity.ConversationOutlineItem;

class MessageCreatorNameMapperTest {

    @Test
    void batchInsertPreservesSuppliedCreatorNamesAndAllowsUnnamedMessages() throws Exception {
        try (SqlSession session = openSession()) {
            ByaiMessageMapper mapper = session.getMapper(ByaiMessageMapper.class);
            ByaiMessage user = message(21L, 1, "张三");
            ByaiMessage answer = message(22L, 2, "李四");
            ByaiMessage unnamed = message(23L, 1, null);

            assertThat(mapper.insertBatch(List.of(user, answer, unnamed))).isEqualTo(3);

            assertThat(mapper.selectConversationOutline(10L))
                .extracting(ConversationOutlineItem::getMessageId, ConversationOutlineItem::getUsage,
                    ConversationOutlineItem::getCreatorName, ConversationOutlineItem::getContent)
                .containsExactly(tuple(21L, 1, "张三", "正文21"), tuple(22L, 2, "李四", "正文22"),
                    tuple(23L, 1, null, "正文23"));
            try (var query = session.getConnection().createStatement();
                 var rows = query.executeQuery("SELECT creator_id, message_id, message_content, message_struct, "
                     + "metadata, is_complete FROM byai_message ORDER BY message_id")) {
                for (long id : List.of(21L, 22L, 23L)) {
                    assertThat(rows.next()).isTrue();
                    assertThat(rows.getLong("creator_id")).isEqualTo(100L);
                    assertThat(rows.getLong("message_id")).isEqualTo(id);
                    assertThat(rows.getString("message_content")).isEqualTo("正文" + id);
                    assertThat(rows.getString("message_struct")).isEqualTo("[]");
                    assertThat(rows.getString("metadata")).isEqualTo("{}");
                    assertThat(rows.getBoolean("is_complete")).isTrue();
                }
                assertThat(rows.next()).isFalse();
            }
        }
    }

    @Test
    void contentUpdateWithBaseDtoPreservesStoredCreatorName() throws Exception {
        try (SqlSession session = openSession()) {
            try (var seed = session.getConnection().createStatement()) {
                seed.execute("INSERT INTO byai_message (id, message_id, session_id, creator_id, creator_name, "
                    + "\"usage\", message_content) VALUES (21, 21, 10, 100, '张三', 1, '原正文')");
            }
            ByaiMessageHotDto update = new ByaiMessageHotDto();
            update.setMessageId(21L);
            update.setMessageContent("更新正文");
            ByaiMessageMapper mapper = session.getMapper(ByaiMessageMapper.class);

            assertThat(mapper.updateByMessageId(update)).isEqualTo(1);

            assertThat(mapper.selectConversationOutline(10L))
                .extracting(ConversationOutlineItem::getCreatorName, ConversationOutlineItem::getContent)
                .containsExactly(tuple("张三", "更新正文"));
        }
    }

    private ByaiMessage message(long id, int usage, String creatorName) {
        ByaiMessage message = new ByaiMessage();
        message.setId(id);
        message.setMessageId(id);
        message.setSessionId(10L);
        message.setCreatorId(100L);
        message.setCreatorName(creatorName);
        message.setUsage(usage);
        message.setCreateTime(new Date(id * 1000));
        message.setMessageContent("正文" + id);
        message.setMessageStruct("[]");
        message.setMetadata("{}");
        message.setIsComplete(true);
        return message;
    }

    private SqlSession openSession() throws Exception {
        String url = "jdbc:h2:mem:message-creator-" + UUID.randomUUID() + ";MODE=PostgreSQL";
        var configuration = new MybatisConfiguration(new Environment("h2", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.h2.Driver", url, "sa", "")));
        configuration.addMapper(ByaiMessageMapper.class);
        SqlSession session = new SqlSessionFactoryBuilder().build(configuration).openSession(true);
        try (var schema = session.getConnection().createStatement()) {
            schema.execute("""
                CREATE TABLE byai_message (
                    id BIGINT PRIMARY KEY, session_id BIGINT, task_id BIGINT, access_terminal VARCHAR(256),
                    metadata TEXT, "role" TEXT, "usage" INTEGER, creator_id BIGINT, creator_name TEXT,
                    message_id BIGINT, message_struct TEXT, create_time TIMESTAMP, belong_date DATE,
                    message_content TEXT, final_content TEXT, related_resources TEXT, call_logs TEXT,
                    infer_log TEXT, msg_status INTEGER, project_id BIGINT, res_com_ids TEXT,
                    is_complete BOOLEAN, archived_at TIMESTAMP, update_time TIMESTAMP,
                    recalled_at TIMESTAMP, recalled_by BIGINT
                )
                """);
        }
        catch (Exception exception) {
            session.close();
            throw exception;
        }
        return session;
    }
}
