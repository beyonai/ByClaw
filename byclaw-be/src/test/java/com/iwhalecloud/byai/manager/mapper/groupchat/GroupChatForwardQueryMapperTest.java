package com.iwhalecloud.byai.manager.mapper.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.Statement;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.*;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GroupChatForwardQueryMapperTest {
    @TempDir Path directory;
    private String url;

    @BeforeEach
    void fixture() throws Exception {
        url = "jdbc:sqlite:" + directory.resolve("targets.sqlite");
        execute("CREATE TABLE byai_session (session_id INTEGER PRIMARY KEY, enterprise_id INTEGER, session_type TEXT, state TEXT, session_name TEXT, project_id INTEGER, update_time TEXT, create_time TEXT)");
        // Historic Java memberships have no reliable enterprise field; ownership comes from the session.
        execute("CREATE TABLE byai_session_member (session_id INTEGER, mem_obj_type TEXT, mem_obj_id INTEGER, user_role TEXT)");
        execute("CREATE TABLE byai_message (session_id INTEGER, create_time TEXT, archived_at TEXT)");
        for (var row : new ObjectMapper().readTree(Files.readString(Path.of("../byclaw-qa/fixtures/group-chat-forward/eligibility.json")))) {
            try (var connection = DriverManager.getConnection(url); var insert = connection.prepareStatement("INSERT INTO byai_session VALUES (?,?,?,?,?,4001,'2026-10-01','2026-09-01')")) {
                insert.setLong(1, row.path("sessionId").asLong());
                insert.setObject(2, row.path("enterpriseId").isNull() ? null : row.path("enterpriseId").asLong());
                insert.setString(3, row.path("sessionType").asText());
                insert.setString(4, row.path("state").isNull() ? null : row.path("state").asText());
                insert.setString(5, "team " + row.path("sessionId").asText()); insert.execute();
            }
            if (row.path("member").asBoolean()) execute("INSERT INTO byai_session_member VALUES (" + row.path("sessionId").asLong() + ",'USER',30,'MEMBER')");
            else execute("INSERT INTO byai_session_member VALUES (" + row.path("sessionId").asLong() + ",'AGENT',30,'MEMBER')");
        }
    }

    @Test
    void tenantOneIsStillStrict() {
        try (var session = open()) {
            var mapper = session.getMapper(GroupChatForwardQueryMapper.class);
            assertThat(mapper.selectTargets(30L, 1L, 1000L, null, 20, 0L)).extracting(ForwardDtos.TargetItem::sessionId).containsExactly("2002", "2001");
            assertThat(mapper.countTargets(30L, 1L, 1000L, null)).isEqualTo(2);
        }
    }

    @Test
    void filtersBeforePagination() throws Exception {
        execute("INSERT INTO byai_message VALUES (2001,'2026-10-15',NULL),(2002,'2026-10-16','archived')");
        try (var session = open()) {
            var mapper = session.getMapper(GroupChatForwardQueryMapper.class);
            assertThat(mapper.selectTargets(30L, 1L, 1000L, null, 1, 0L)).extracting(ForwardDtos.TargetItem::sessionId).containsExactly("2001");
            assertThat(mapper.selectTargets(30L, 1L, 1000L, null, 1, 1L)).extracting(ForwardDtos.TargetItem::sessionId).containsExactly("2002");
            assertThat(mapper.countTargets(30L, 1L, 1000L, null)).isEqualTo(2);
        }
    }

    @Test
    void literalKeywordAndTotalAgree() throws Exception {
        execute("UPDATE byai_session SET session_name='A%_\\ team' WHERE session_id=2001");
        try (var session = open()) {
            var mapper = session.getMapper(GroupChatForwardQueryMapper.class);
            for (String pattern : new String[] {"%a\\%\\_\\\\%", "%\\%%", "%\\_%", "%\\\\%"}) {
                assertThat(mapper.selectTargets(30L, 1L, 1000L, pattern, 20, 0L)).extracting(ForwardDtos.TargetItem::sessionId).containsExactly("2001");
                assertThat(mapper.countTargets(30L, 1L, 1000L, pattern)).isEqualTo(1);
            }
        }
    }

    @Test
    void countDoesNotReadAnyMessageHistory() throws Exception {
        execute("DROP TABLE byai_message");
        try (var session = open()) {
            assertThat(session.getMapper(GroupChatForwardQueryMapper.class).countTargets(30L, 1L, 1000L, null)).isEqualTo(2);
        }
    }

    private void execute(String sql) throws Exception {
        try (var connection = DriverManager.getConnection(url); Statement statement = connection.createStatement()) { statement.execute(sql); }
    }
    private SqlSession open() {
        var environment = new Environment("sqlite", new JdbcTransactionFactory(), new UnpooledDataSource("org.sqlite.JDBC", url, null, null));
        var configuration = new MybatisConfiguration(environment);
        configuration.addMapper(GroupChatForwardQueryMapper.class);
        return new SqlSessionFactoryBuilder().build(configuration).openSession();
    }
}
