package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.sql.SQLException;
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
import org.sqlite.Function;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** 执行真实查询 SQL，覆盖历史纯附件消息及分页计数，而非模拟 Mapper 返回值。 */
class GroupChatAttachmentMapperTest {
    @TempDir Path directory;

    @Test
    void attachmentOnlyMessagesRemainVisibleAcrossGroupQueries() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("attachments.sqlite");
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
            sql.execute("INSERT INTO byai_message(message_id,session_id,topic_id,usage,message_content,related_resources,create_time) VALUES "
                + "(1,10,1,1,NULL,'{\"files\":[{\"fileId\":\"7\",\"fileName\":\"report.md\"}]}',1000),"
                + "(2,10,1,1,'','{\"files\":[{\"fileId\":\"8\",\"fileName\":\"report.md\"}]}',2000),"
                + "(3,10,1,1,NULL,NULL,3000),"
                + "(4,10,1,1,NULL,'',4000),"
                + "(5,10,1,1,NULL,'   ',5000),"
                + "(6,99,1,1,NULL,'{\"files\":[{}]}',6000),"
                + "(7,10,1,3,NULL,'{\"files\":[{}]}',7000),"
                + "(8,10,1,1,NULL,'{\"files\":[{}]}',8000)");
            sql.execute("UPDATE byai_message SET archived_at=9000 WHERE message_id=8");
        }
        try (var session = new SqlSessionFactoryBuilder().build(config).openSession(true)) {
            var mapper = session.getMapper(ByaiMessageMapper.class);
            assertThat(mapper.selectTimelineBeforeMessageId(10L, 9L, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(2L, 1L);
            assertThat(mapper.selectVisibleBeforeMessageId(10L, 9L, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(2L, 1L);
            assertThat(mapper.countTimelineBeforeMessageId(10L, 9L)).isEqualTo(2);
            assertThat(mapper.countVisibleBeforeMessageId(10L, 9L)).isEqualTo(2);
            SessionService sessions = mock(SessionService.class);
            ByaiSession group = new ByaiSession();
            group.setSessionId(10L);
            when(sessions.findById(10L)).thenReturn(group);
            GroupChatContextService context = new GroupChatContextService(mapper, sessions, mock(SsResourceService.class));
            GroupChatContextRequest request = new GroupChatContextRequest();
            request.setConversationKey("10");
            request.setBeforeMessageId("9");
            var timeline = context.loadTimeline(request);
            assertThat(timeline.getMessages()).hasSize(2).allSatisfy(message -> {
                assertThat(message.getContent()).isEmpty();
                assertThat(message.getAttachments()).singleElement()
                    .satisfies(file -> assertThat(file.getFileName()).isEqualTo("report.md"));
            });
            assertThat(timeline.getTruncation().getOmittedMessageCount()).isZero();
            request.setMaxMessages(1);
            assertThat(context.loadTimeline(request).getTruncation().getOmittedMessageCount()).isEqualTo(1);
            assertThat(mapper.selectVisibleGroupMessage(10L, 1L)).isNotNull();
            assertThat(mapper.selectVisibleAfterMessageId(10L, 0L, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(1L, 2L);
            assertThat(mapper.selectTopicMessages(10L, 1L, 2L, null, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(1L);
            assertThat(mapper.selectVisibleGroupMessagesByIds(10L, List.of(1L, 2L, 3L, 6L, 7L, 8L)))
                .extracting(ByaiMessage::getMessageId).containsExactlyInAnyOrder(1L, 2L);
            assertThat(mapper.searchVisibleGroupMessages(10L, null, "ALL", "ALL", 7L, null, null, null, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(2L);
            // SQLite 补齐 PostgreSQL CHR 函数，仅用于执行真实 LIKE 条件；方言解析另由 PGWallProvider 验证。
            Function.create(session.getConnection(), "CHR", new Function() {
                @Override
                protected void xFunc() throws SQLException {
                    result(String.valueOf((char) value_int(0)));
                }
            });
            try (var insert = session.getConnection().prepareStatement(
                "INSERT INTO byai_message(message_id,session_id,usage,message_content) VALUES (?,10,1,?)")) {
                insert.setLong(1, 9L);
                insert.setString(2, "100%_\\Report");
                insert.executeUpdate();
                insert.setLong(1, 10L);
                insert.setString(2, "100XXReport");
                insert.executeUpdate();
            }
            for (String keyword : List.of("\\%", "\\_", "\\\\")) {
                assertThat(mapper.searchVisibleGroupMessages(10L, keyword, "ALL", "ALL", 7L, null, null, null, 10))
                    .extracting(ByaiMessage::getMessageId).containsExactly(9L);
            }
            assertThat(mapper.searchVisibleGroupMessages(10L, "report", "ALL", "ALL", 7L, null, null, null, 10))
                .extracting(ByaiMessage::getMessageId).containsExactly(10L, 9L);

        }
    }
}
