package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.h2.util.ScriptReader;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper;

/** 使用真实 Mapper 与迁移源文件验证条件更新；H2 用例不替代 openGauss 上线验证。 */
class GroupChatWelcomePersistenceTest {
    private SqlSessionFactory factory;
    private SqlSession keeper;

    @BeforeEach
    void setUp() throws Exception {
        var source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:welcome_" + UUID.randomUUID() + ";MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE;"
                + "INIT=CREATE SCHEMA IF NOT EXISTS byai\\;SET SCHEMA byai", "sa", "");
        var configuration = new Configuration(new Environment("welcome", new JdbcTransactionFactory(), source));
        String resource = "/com/iwhalecloud/byai/manager/mapper/session/ByaiSessionMemberMapper.xml";
        try (var input = getClass().getResourceAsStream(resource)) {
            assertThat(input).isNotNull();
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        factory = new SqlSessionFactoryBuilder().build(configuration);
        keeper = factory.openSession(true);
        execute("CREATE TABLE byai_session(session_id BIGINT PRIMARY KEY, session_type VARCHAR(30), state VARCHAR(30))");
        execute("INSERT INTO byai_session VALUES(30, 'hs_as', 'ACTIVE')");
        execute("CREATE TABLE byai_session_member(byai_session_member_id BIGINT PRIMARY KEY, session_id BIGINT, "
            + "mem_obj_type VARCHAR(20), mem_obj_id BIGINT, last_read_message_id BIGINT, last_read_time TIMESTAMP)");
        insertMember(40L, "USER", 21L);
    }

    @AfterEach
    void tearDown() {
        if (keeper != null) {
            keeper.close();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"V0.6.0__ddl.sql", "tenant/V0.6.0__ddl.sql"})
    void migrationSkipsExistingMembersAndLeavesFutureMembersEligible(String script) throws Exception {
        applyWelcomeMigration(script);
        insertMember(41L, "USER", 20L);
        // 重复应用欢迎字段迁移不能把迁移后加入的新成员误标为历史成员。
        applyWelcomeMigration(script);

        assertThat(claim(40L, 30L, 21L)).isZero();
        assertThat(claim(41L, 30L, 20L)).isEqualTo(1);
        assertThat(claim(41L, 30L, 20L)).isZero();
        try (var statement = keeper.getConnection().createStatement();
             var result = statement.executeQuery("SELECT welcome_handled_at, last_read_message_id, last_read_time "
                 + "FROM byai_session_member ORDER BY byai_session_member_id")) {
            while (result.next()) {
                assertThat(result.getTimestamp("welcome_handled_at")).isNotNull();
                assertThat(result.getLong("last_read_message_id")).isEqualTo(91L);
                assertThat(result.getTimestamp("last_read_time").toLocalDateTime().getYear()).isEqualTo(2020);
            }
        }
    }

    @Test
    void concurrentBrowsersHaveExactlyOneWinner() throws Exception {
        applyWelcomeMigration("V0.6.0__ddl.sql");
        insertMember(41L, "USER", 20L);
        var executor = Executors.newFixedThreadPool(2);
        var ready = new CountDownLatch(2);
        var start = new CountDownLatch(1);
        java.util.concurrent.Callable<Integer> request = () -> {
            try (var session = factory.openSession(true)) {
                ready.countDown();
                assertThat(start.await(5, TimeUnit.SECONDS)).isTrue();
                return session.getMapper(ByaiSessionMemberMapper.class).claimWelcome(41L, 30L, 20L, new Date());
            }
        };
        try {
            var firstBrowser = executor.submit(request);
            var secondBrowser = executor.submit(request);
            assertThat(ready.await(5, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            assertThat(firstBrowser.get(5, TimeUnit.SECONDS) + secondBrowser.get(5, TimeUnit.SECONDS)).isEqualTo(1);
            assertThat(claim(41L, 30L, 20L)).isZero();
        } finally {
            start.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void oldMembershipCannotConsumeRejoinAndOtherUsersAreIndependent() throws Exception {
        applyWelcomeMigration("V0.6.0__ddl.sql");
        insertMember(41L, "USER", 20L);
        assertThat(claim(41L, 30L, 20L)).isEqualTo(1);
        execute("DELETE FROM byai_session_member WHERE byai_session_member_id=41");
        insertMember(42L, "USER", 20L);
        insertMember(43L, "USER", 22L);

        assertThat(claim(41L, 30L, 20L)).isZero();
        assertThat(claim(42L, 30L, 22L)).isZero();
        assertThat(claim(42L, 31L, 20L)).isZero();
        assertThat(claim(42L, 30L, 20L)).isEqualTo(1);
        assertThat(claim(43L, 30L, 22L)).isEqualTo(1);
    }

    @Test
    void agentsClosedGroupsAndPersonalSessionsCannotClaim() throws Exception {
        applyWelcomeMigration("V0.6.0__ddl.sql");
        insertMember(41L, "AGENT", 20L);
        assertThat(claim(41L, 30L, 20L)).isZero();
        execute("UPDATE byai_session_member SET mem_obj_type='USER' WHERE byai_session_member_id=41");
        execute("UPDATE byai_session SET state='GROUP_DISSOLVED'");
        assertThat(claim(41L, 30L, 20L)).isZero();
        execute("UPDATE byai_session SET state='CLOSED'");
        assertThat(claim(41L, 30L, 20L)).isZero();
        execute("UPDATE byai_session SET state='ACTIVE', session_type='h_as'");
        assertThat(claim(41L, 30L, 20L)).isZero();
    }

    private int claim(Long memberId, Long sessionId, Long userId) {
        return keeper.getMapper(ByaiSessionMemberMapper.class).claimWelcome(memberId, sessionId, userId, new Date());
    }

    private void insertMember(long memberId, String type, long userId) throws Exception {
        try (var statement = keeper.getConnection().prepareStatement("INSERT INTO byai_session_member "
            + "(byai_session_member_id, session_id, mem_obj_type, mem_obj_id, last_read_message_id, last_read_time) "
            + "VALUES(?, 30, ?, ?, 91, TIMESTAMP '2020-01-01 00:00:00')")) {
            statement.setLong(1, memberId);
            statement.setString(2, type);
            statement.setLong(3, userId);
            statement.executeUpdate();
        }
    }

    private void execute(String sql) throws Exception {
        try (var statement = keeper.getConnection().createStatement()) {
            statement.execute(sql);
        }
    }

    private void applyWelcomeMigration(String script) throws Exception {
        Path root = Path.of(System.getProperty("user.dir")).toAbsolutePath();
        while (root != null && !Files.isDirectory(root.resolve("deploy/migrations/versions/V0.6.0"))) {
            root = root.getParent();
        }
        assertThat(root).as("repository migration directory").isNotNull();
        String sql = Files.readString(root.resolve("deploy/migrations/versions/V0.6.0").resolve(script));
        // 从真实版本脚本提取欢迎字段语句，避免重复执行同版本其他模块的建表语句。
        var statements = new ArrayList<String>();
        try (var reader = new ScriptReader(new StringReader(sql))) {
            reader.setSkipRemarks(true);
            for (String statement = reader.readStatement(); statement != null; statement = reader.readStatement()) {
                if (statement.contains("welcome_handled_at")) {
                    statements.add(statement);
                }
            }
        }
        assertThat(statements).as("welcome migration statements in %s", script).hasSize(3);
        for (String statement : statements) {
            execute(statement);
        }
    }
}
