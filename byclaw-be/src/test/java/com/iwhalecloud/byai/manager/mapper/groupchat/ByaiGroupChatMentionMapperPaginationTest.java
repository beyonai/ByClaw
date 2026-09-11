package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Properties;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInterceptor;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;

class ByaiGroupChatMentionMapperPaginationTest {

    @TempDir
    Path tempDir;

    @Test
    void selectMyGroupsSupportsPaginationCountAndUsesLatestActiveMessageOrdering() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-list-pagination.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);

        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            Page<GroupChatListItemResponse> page = PageHelper.startPage(1, 1);
            List<GroupChatListItemResponse> groups = session.getMapper(ByaiGroupChatMentionMapper.class)
                .selectMyGroups(30L);

            assertThat(page.getTotal()).isEqualTo(2L);
            assertThat(groups).hasSize(1);
            assertThat(groups.get(0).getSessionId()).isEqualTo(10L);
            assertThat(groups.get(0).getLatestMessageId()).isEqualTo(99L);
            assertThat(groups.get(0).getLatestMessageContent()).isEqualTo("later timestamp but lower id");
            assertThat(groups.get(0).getUnreadMentionCount()).isEqualTo(1L);
            assertThat(groups.get(0).getLatestMentionMessageId()).isEqualTo(100L);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    private void initializeSchema(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE byai_session (
                    session_id INTEGER PRIMARY KEY,
                    session_name TEXT,
                    project_id INTEGER,
                    session_type TEXT,
                    update_time TEXT,
                    create_time TEXT
                )
                """);
            statement.execute("""
                CREATE TABLE byai_session_member (
                    session_id INTEGER,
                    user_role TEXT,
                    last_read_message_id INTEGER,
                    mem_obj_type TEXT,
                    mem_obj_id INTEGER
                )
                """);
            statement.execute("""
                CREATE TABLE byai_message (
                    message_id INTEGER,
                    session_id INTEGER,
                    message_content TEXT,
                    create_time TEXT,
                    creator_id INTEGER,
                    creator_name TEXT,
                    archived_at TEXT
                )
                """);
            statement.execute("""
                CREATE TABLE byai_group_chat_mention (
                    message_id INTEGER,
                    group_session_id INTEGER,
                    mentioned_user_id INTEGER
                )
                """);
            statement.execute("""
                INSERT INTO byai_session(session_id, session_name, project_id, session_type, update_time, create_time)
                VALUES (10, 'group 10', 1, 'hs_as', '2026-09-11 12:00:00', '2026-09-11 10:00:00'),
                       (20, 'group 20', 1, 'hs_as', '2026-09-11 11:00:00', '2026-09-11 09:00:00')
                """);
            statement.execute("""
                INSERT INTO byai_session_member(
                    session_id, user_role, last_read_message_id, mem_obj_type, mem_obj_id
                )
                VALUES (10, 'MEMBER', 99, 'USER', 30),
                       (20, 'MEMBER', NULL, 'USER', 30)
                """);
            statement.execute("""
                INSERT INTO byai_message(
                    message_id, session_id, message_content, create_time, creator_id, creator_name, archived_at
                )
                VALUES (98, 10, 'same timestamp and lower id', '2026-09-11 13:00:00', 31, 'user 31', NULL),
                       (99, 10, 'later timestamp but lower id', '2026-09-11 13:00:00', 31, 'user 31', NULL),
                       (100, 10, 'highest active message id', '2026-09-11 12:00:00', 32, 'user 32', NULL),
                       (101, 10, 'archived highest id', '2026-09-11 14:00:00', 33, 'user 33', '2026-09-11'),
                       (200, 20, 'second group message', '2026-09-11 11:00:00', 31, 'user 31', NULL)
                """);
            statement.execute("""
                INSERT INTO byai_group_chat_mention(message_id, group_session_id, mentioned_user_id)
                VALUES (99, 10, 30), (100, 10, 30), (101, 10, 30)
                """);
        }
    }

    private SqlSessionFactory buildSqlSessionFactory(String jdbcUrl) {
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC", jdbcUrl, null, null);
        Environment environment = new Environment("sqlite-test", new JdbcTransactionFactory(), dataSource);
        MybatisConfiguration configuration = new MybatisConfiguration(environment);
        PageInterceptor pageInterceptor = new PageInterceptor();
        Properties properties = new Properties();
        properties.setProperty("helperDialect", "sqlite");
        pageInterceptor.setProperties(properties);
        configuration.addInterceptor(pageInterceptor);
        configuration.addMapper(ByaiGroupChatMentionMapper.class);
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
