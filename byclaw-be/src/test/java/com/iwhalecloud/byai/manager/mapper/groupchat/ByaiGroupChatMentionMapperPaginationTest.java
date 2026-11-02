package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.atomic.AtomicInteger;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.sqlite.Function;

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
                .selectMyGroups(30L, 100L);

            // 分页总数应排除已确认解散的群，同时兼容历史 state 为空的群。
            assertThat(page.getTotal()).isEqualTo(2L);
            assertThat(groups).hasSize(1);
            assertThat(groups.get(0).getSessionId()).isEqualTo(10L);
            assertThat(groups.get(0).getEnterpriseId()).isEqualTo(100L);
            assertThat(groups.get(0).getEnterpriseName()).isEqualTo("enterprise 100");
            assertThat(groups.get(0).getLatestMessageId()).isEqualTo(99L);
            assertThat(groups.get(0).getLatestMessageContent()).isEqualTo("later timestamp but lower id");
            assertThat(groups.get(0).getLatestMessageMetadata()).isEqualTo("{\"resourceList\":[]}");
            assertThat(groups.get(0).getLatestMessageRelatedResources())
                .isEqualTo("{\"files\":[{\"fileId\":\"123\",\"fileName\":\"report.pdf\"}]}");
            assertThat(groups.get(0).getUnreadCount()).isEqualTo(1L);
            assertThat(groups.get(0).getUnreadMentionCount()).isEqualTo(1L);
            assertThat(groups.get(0).getLatestMentionMessageId()).isEqualTo(100L);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void dissolvedGroupRemainsForUnacknowledgedMembersOnly() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-acknowledgment.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO byai_session_member VALUES (30, 'MEMBER', NULL, 'USER', 31)");
            statement.execute("INSERT INTO byai_session_member VALUES (30, 'OWNER', NULL, 'USER', 32)");
        }
        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            ByaiGroupChatMentionMapper mapper = session.getMapper(ByaiGroupChatMentionMapper.class);
            assertThat(mapper.selectMyGroups(31L, 100L)).extracting(GroupChatListItemResponse::getSessionId).contains(30L);
            assertThat(mapper.selectMyGroups(30L, 100L)).extracting(GroupChatListItemResponse::getSessionId).doesNotContain(30L);
            assertThat(mapper.selectMyGroups(32L, 100L)).isEmpty();
        }
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("INSERT INTO byai_session_ext VALUES (30, 'group_dissolution_ack_31', 'true')");
        }
        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            assertThat(session.getMapper(ByaiGroupChatMentionMapper.class).selectMyGroups(31L, 100L)).isEmpty();
        }
    }

    @Test
    void selectMyGroupsCountsOnlyActiveMessagesAfterTheReadCursor() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-unread-count.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);

        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            List<GroupChatListItemResponse> groups = session.getMapper(ByaiGroupChatMentionMapper.class)
                .selectMyGroups(30L, 100L);

            GroupChatListItemResponse groupWithReadCursor = groups.stream()
                .filter(group -> group.getSessionId().equals(10L))
                .findFirst()
                .orElseThrow();
            GroupChatListItemResponse groupWithoutReadCursor = groups.stream()
                .filter(group -> group.getSessionId().equals(20L))
                .findFirst()
                .orElseThrow();

            // 已撤回但未归档的消息 100 在游标之后；已归档的消息 101 不应计入未读数量。
            assertThat(groupWithReadCursor.getUnreadMessageCount()).isEqualTo(1L);
            // 空游标表示该群的全部未归档消息均未读。
            assertThat(groupWithoutReadCursor.getUnreadMessageCount()).isEqualTo(1L);
        }
    }

    @Test
    void legacyGroupsAreScopedToTheirOwningEnterprise() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-tenant-scope.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("UPDATE byai_session SET enterprise_id = 200 WHERE session_id = 20");
        }
        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            ByaiGroupChatMentionMapper mapper = session.getMapper(ByaiGroupChatMentionMapper.class);
            assertThat(mapper.selectMyGroupsScoped(30L, 100L))
                .extracting(GroupChatListItemResponse::getSessionId).containsExactly(10L);
            assertThat(mapper.selectMyGroupsScoped(30L, 200L))
                .extracting(GroupChatListItemResponse::getSessionId).containsExactly(20L);
            assertThat(mapper.isLegacyGroupMember(10L, 30L, 100L)).isTrue();
            assertThat(mapper.isLegacyGroupMember(10L, 30L, 200L)).isFalse();
            assertThat(mapper.isLegacyGroupMember(10L, 31L, 100L)).isFalse();
        }
    }

    @Test
    void selectMyGroupsFiltersByEnterpriseId() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-enterprise-filter.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("UPDATE byai_session SET enterprise_id = 200 WHERE session_id = 20");
        }

        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            ByaiGroupChatMentionMapper mapper = session.getMapper(ByaiGroupChatMentionMapper.class);

            assertThat(mapper.selectMyGroups(30L, 100L))
                .extracting(GroupChatListItemResponse::getSessionId)
                .containsExactly(10L);
            assertThat(mapper.selectMyGroups(30L, 200L))
                .extracting(GroupChatListItemResponse::getSessionId)
                .containsExactly(20L);
        }
    }

    @Test
    void defaultEnterpriseIdFiltersGroupsAndPaginationLikeOtherEnterprises() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-default-enterprise.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("UPDATE byai_session SET enterprise_id = 1 WHERE session_id = 10");
            statement.execute("UPDATE byai_session SET enterprise_id = 200 WHERE session_id = 20");
            statement.execute("INSERT INTO byai_session VALUES (40, 'not my group', NULL, 1, 'hs_as', NULL, "
                + "'2026-09-11 15:00:00', '2026-09-11 15:00:00')");
            statement.execute("INSERT INTO byai_session_member VALUES (40, 'MEMBER', NULL, 'USER', 31)");
            statement.execute("INSERT INTO byai_session VALUES (50, 'my default group', NULL, 1, 'hs_as', NULL, "
                + "'2026-09-11 15:00:00', '2026-09-11 15:00:00')");
            statement.execute("INSERT INTO byai_session_member VALUES (50, 'MEMBER', NULL, 'USER', 30)");
            statement.execute("INSERT INTO byai_session VALUES (60, 'unassigned group', NULL, NULL, 'hs_as', NULL, "
                + "'2026-09-11 16:00:00', '2026-09-11 16:00:00')");
            statement.execute("INSERT INTO byai_session_member VALUES (60, 'MEMBER', NULL, 'USER', 30)");
        }

        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            ByaiGroupChatMentionMapper mapper = session.getMapper(ByaiGroupChatMentionMapper.class);
            assertThat(mapper.selectMyGroups(30L, 1L))
                .extracting(GroupChatListItemResponse::getSessionId).containsExactly(50L, 10L);
            assertThat(mapper.selectMyGroups(30L, null))
                .extracting(GroupChatListItemResponse::getSessionId).containsExactlyInAnyOrder(10L, 20L, 50L, 60L);

            Page<GroupChatListItemResponse> page = PageHelper.startPage(2, 1);
            assertThat(mapper.selectMyGroups(30L, 1L))
                .extracting(GroupChatListItemResponse::getSessionId).containsExactly(10L);
            assertThat(page.getTotal()).isEqualTo(2L);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void selectMyGroupsDoesNotFilterWhenEnterpriseIdIsAbsent() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-enterprise-optional.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("UPDATE byai_session SET enterprise_id = 200 WHERE session_id = 20");
        }

        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            assertThat(session.getMapper(ByaiGroupChatMentionMapper.class).selectMyGroups(30L, null))
                .extracting(GroupChatListItemResponse::getSessionId)
                .containsExactly(10L, 20L);
        }
    }

    @Test
    void latestMessageProjectionReadsOnlyVisibleGroupPartitions() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-visible-message-partitions.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                INSERT INTO byai_session VALUES
                    (40, 'another user group', NULL, 100, 'hs_as', NULL, '2026-09-11 15:00:00', '2026-09-11 15:00:00'),
                    (50, 'another enterprise group', NULL, 200, 'hs_as', NULL, '2026-09-11 15:00:00', '2026-09-11 15:00:00'),
                    (60, 'other session type', NULL, 100, 'other', NULL, '2026-09-11 15:00:00', '2026-09-11 15:00:00'),
                    (70, 'enterprise one group', NULL, 1, 'hs_as', NULL, '2026-09-11 15:00:00', '2026-09-11 15:00:00')
                """);
            statement.execute("""
                INSERT INTO byai_session_member VALUES
                    (40, 'MEMBER', NULL, 'USER', 31),
                    (50, 'MEMBER', NULL, 'USER', 30),
                    (60, 'MEMBER', NULL, 'USER', 30),
                    (70, 'MEMBER', NULL, 'USER', 30)
                """);
            statement.execute("""
                INSERT INTO byai_message(message_id, session_id, message_content, create_time, creator_id, creator_name)
                VALUES (300, 30, 'acknowledged dissolved group', '2026-09-11 15:00:00', 31, 'user 31'),
                       (400, 40, 'another user message', '2026-09-11 15:00:00', 31, 'user 31'),
                       (500, 50, 'another enterprise message', '2026-09-11 15:00:00', 31, 'user 31'),
                       (600, 60, 'other session message', '2026-09-11 15:00:00', 31, 'user 31'),
                       (700, 70, 'enterprise one message', '2026-09-11 15:00:00', 31, 'user 31')
                """);
            statement.execute("ALTER TABLE byai_message RENAME TO message_storage");
            // Observe actual content projection rather than timing a tiny fixture or inspecting SQL text.
            statement.execute("""
                CREATE VIEW byai_message AS
                SELECT message_id, session_id, observe_message_partition(session_id, message_content) AS message_content,
                       related_resources, metadata, create_time, creator_id, creator_name,
                       recalled_at, recalled_by, archived_at
                FROM message_storage
                """);
        }
        Long[] enterpriseIds = { null, 1L, 100L, 200L };
        List<List<Long>> visibleGroups = List.of(List.of(70L, 50L, 10L, 20L), List.of(70L, 50L, 10L, 20L),
            List.of(10L, 20L), List.of(50L));
        for (int index = 0; index < enterpriseIds.length; index++) {
            List<Long> projectedSessionIds = new ArrayList<>();
            try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
                Function.create(session.getConnection(), "observe_message_partition", new Function() {
                    @Override
                    protected void xFunc() throws java.sql.SQLException {
                        projectedSessionIds.add(value_long(0));
                        result(value_text(1));
                    }
                });
                Page<GroupChatListItemResponse> page = PageHelper.startPage(1, 1);
                assertThat(session.getMapper(ByaiGroupChatMentionMapper.class).selectMyGroups(30L, enterpriseIds[index]))
                    .extracting(GroupChatListItemResponse::getSessionId).containsExactly(visibleGroups.get(index).get(0));
                assertThat(page.getTotal()).isEqualTo(visibleGroups.get(index).size());
                assertThat(projectedSessionIds).as("projected groups for enterprise %s", enterpriseIds[index])
                    .isNotEmpty().containsOnlyElementsOf(visibleGroups.get(index));
            }
            finally {
                PageHelper.clearPage();
            }
        }
    }

    @Test
    void paginationTotalDoesNotReadMessageRows() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-count-without-messages.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        AtomicInteger messageTimeReads = new AtomicInteger();
        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            Function.create(session.getConnection(), "observe_message_time", new Function() {
                @Override
                protected void xFunc() throws java.sql.SQLException {
                    messageTimeReads.incrementAndGet();
                    result(value_text(0));
                }
            });
            try (Statement statement = session.getConnection().createStatement()) {
                statement.execute("ALTER TABLE byai_message RENAME TO message_storage");
                // Window ordering must evaluate this expression, even when an outer COUNT drops message content.
                statement.execute("""
                    CREATE VIEW byai_message AS
                    SELECT message_id, session_id, message_content, related_resources, metadata,
                           observe_message_time(create_time) AS create_time, creator_id, creator_name,
                           recalled_at, recalled_by, archived_at
                    FROM message_storage
                    """);
            }
            ByaiGroupChatMentionMapper mapper = session.getMapper(ByaiGroupChatMentionMapper.class);
            assertThat(PageHelper.count(() -> mapper.selectMyGroups(30L, 100L))).isEqualTo(2L);
            assertThat(messageTimeReads).hasValue(0);
        }
        finally {
            PageHelper.clearPage();
        }
    }

    @Test
    void paginationPreservesEmptyArchivedOnlyAndRecalledLatestGroups() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("group-latest-boundaries.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                INSERT INTO byai_session VALUES
                    (40, 'empty group', NULL, 100, 'hs_as', NULL, '2026-09-11 15:00:00', '2026-09-11 09:00:00'),
                    (50, 'archived only group', NULL, 100, 'hs_as', NULL, '2026-09-11 14:00:00', '2026-09-11 09:00:00'),
                    (60, 'recalled latest group', NULL, 100, 'hs_as', NULL, '2026-09-11 09:00:00', '2026-09-11 09:00:00')
                """);
            statement.execute("""
                INSERT INTO byai_session_member VALUES
                    (40, 'MEMBER', NULL, 'USER', 30),
                    (50, 'MEMBER', NULL, 'USER', 30),
                    (60, 'MEMBER', NULL, 'USER', 30)
                """);
            statement.execute("""
                INSERT INTO byai_message(message_id, session_id, message_content, create_time, creator_id,
                    creator_name, recalled_at, recalled_by, archived_at)
                VALUES (500, 50, 'archived', '2026-09-11 17:00:00', 31, 'user 31', NULL, NULL, '2026-09-11'),
                       (600, 60, 'recalled', '2026-09-11 16:00:00', 31, 'user 31', '2026-09-11 16:30:00', 31, NULL)
                """);
        }
        try (SqlSession session = buildSqlSessionFactory(jdbcUrl).openSession()) {
            ByaiGroupChatMentionMapper mapper = session.getMapper(ByaiGroupChatMentionMapper.class);
            List<GroupChatListItemResponse> groups = mapper.selectMyGroups(30L, 100L);
            assertThat(groups).extracting(GroupChatListItemResponse::getSessionId).containsExactly(60L, 40L, 50L, 10L, 20L);
            assertThat(groups.get(0).isLatestMessageRecalled()).isTrue();
            assertThat(groups.get(0).getLatestMessageId()).isEqualTo(600L);
            assertThat(groups.get(0).getUnreadMessageCount()).isEqualTo(1L);
            for (int index : new int[] { 1, 2 }) {
                assertThat(groups.get(index).getLatestMessageId()).isNull();
                assertThat(groups.get(index).getUnreadMessageCount()).isZero();
            }
            Page<GroupChatListItemResponse> page = PageHelper.startPage(2, 2);
            assertThat(mapper.selectMyGroups(30L, 100L))
                .extracting(GroupChatListItemResponse::getSessionId).containsExactly(50L, 10L);
            assertThat(page.getTotal()).isEqualTo(5L);
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
                    enterprise_id INTEGER,
                    session_type TEXT,
                    state TEXT,
                    update_time TEXT,
                    create_time TEXT
                )
                """);
            statement.execute("""
                CREATE TABLE po_enterprise_info (
                    enterprise_id INTEGER PRIMARY KEY,
                    com_acct_name TEXT
                )
                """);
            statement.execute("""
                INSERT INTO po_enterprise_info VALUES
                    (1, 'default enterprise'),
                    (100, 'enterprise 100'),
                    (200, 'enterprise 200')
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
                CREATE TABLE byai_session_ext (
                    session_id INTEGER,
                    ext_param_code TEXT,
                    ext_param_value TEXT
                )
                """);
            statement.execute("""
                INSERT INTO byai_session_ext VALUES (30, 'group_dissolution_ack_30', 'true')
                """);
            statement.execute("""
                CREATE TABLE byai_message (
                    message_id INTEGER,
                    session_id INTEGER,
                    message_content TEXT,
                    related_resources TEXT,
                    metadata TEXT,
                    create_time TEXT,
                    creator_id INTEGER,
                    creator_name TEXT,
                    recalled_at TIMESTAMP,
                    recalled_by BIGINT,
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
                INSERT INTO byai_session(session_id, session_name, project_id, enterprise_id, session_type, state, update_time, create_time)
                VALUES (10, 'group 10', 1, 100, 'hs_as', NULL, '2026-09-11 12:00:00', '2026-09-11 10:00:00'),
                       (20, 'group 20', 1, 100, 'hs_as', 'GROUP_ACTIVE', '2026-09-11 11:00:00', '2026-09-11 09:00:00'),
                       (30, 'dissolved group', 1, 100, 'hs_as', 'GROUP_DISSOLVED', '2026-09-11 14:00:00', '2026-09-11 08:00:00')
                """);
            statement.execute("""
                INSERT INTO byai_session_member(
                    session_id, user_role, last_read_message_id, mem_obj_type, mem_obj_id
                )
                VALUES (10, 'MEMBER', 99, 'USER', 30),
                       (20, 'MEMBER', NULL, 'USER', 30),
                       (30, 'MEMBER', NULL, 'USER', 30)
                """);
            statement.execute("""
                INSERT INTO byai_message(
                    message_id, session_id, message_content, create_time, creator_id, creator_name, archived_at
                )
                VALUES (98, 10, 'same timestamp and lower id', '2026-09-11 13:00:00', 31, 'user 31', NULL),
                       (99, 10, 'later timestamp but lower id', '2026-09-11 13:00:00', 31, 'user 31', NULL),
                       (100, 10, 'highest active message id', '2026-09-11 12:00:00', 32, 'user 32', NULL),
                       (101, 10, 'archived highest id', '2026-09-11 14:00:00', 33, 'user 33', '2026-09-11'),
                       (102, 10, 'own message', '2026-09-11 11:00:00', 30, 'user 30', NULL),
                       (200, 20, 'second group message', '2026-09-11 11:00:00', 31, 'user 31', NULL)
                """);
            statement.execute("UPDATE byai_message SET metadata = '{\"resourceList\":[]}' WHERE message_id = 99");
            statement.execute("UPDATE byai_message SET related_resources = "
                + "'{\"files\":[{\"fileId\":\"123\",\"fileName\":\"report.pdf\"}]}' WHERE message_id = 99");
            statement.execute("UPDATE byai_message SET recalled_at = '2026-09-11 14:00:00' WHERE message_id = 100");
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
