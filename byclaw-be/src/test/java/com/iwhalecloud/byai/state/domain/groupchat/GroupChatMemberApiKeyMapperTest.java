package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.UUID;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** The credential lookup must select only the authenticated user's active original-group membership. */
class GroupChatMemberApiKeyMapperTest {
    @Test
    void selectsOnlyTheActiveUserCredentialInTheOriginalGroup() throws Exception {
        var source = new DriverManagerDataSource("jdbc:h2:mem:group-key-" + UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        JdbcTemplate db = new JdbcTemplate(source);
        db.execute("CREATE SCHEMA byai");
        db.execute("CREATE TABLE byai.byai_session_member(session_id BIGINT, mem_obj_type VARCHAR, mem_obj_id BIGINT, state VARCHAR, api_key VARCHAR)");
        db.update("""
            INSERT INTO byai.byai_session_member VALUES
              (30,'USER',20,'00A','original-group-key'),
              (50,'USER',20,'00A','task-session-key'),
              (30,'USER',99,'00A','other-user-key'),
              (30,'AGENT',20,'00A','agent-key'),
              (30,'USER',21,'00X','inactive-key'),
              (30,'USER',22,NULL,'unknown-state-key')
            """);
        Configuration configuration = new Configuration(new Environment("test", new JdbcTransactionFactory(), source));
        String resource = "com/iwhalecloud/byai/manager/mapper/session/ByaiSessionMemberMapper.xml";
        try (var xml = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(xml, configuration, resource, configuration.getSqlFragments()).parse();
        }
        String query = "com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMemberMapper.findActiveUserApiKey";
        try (SqlSession session = new SqlSessionFactoryBuilder().build(configuration).openSession()) {
            assertThat((String) session.selectOne(query, Map.of("groupSessionId", 30L, "userId", 20L)))
                .isEqualTo("original-group-key");
            assertThat((String) session.selectOne(query, Map.of("groupSessionId", 30L, "userId", 21L))).isNull();
            assertThat((String) session.selectOne(query, Map.of("groupSessionId", 30L, "userId", 22L))).isNull();
            assertThat((String) session.selectOne(query, Map.of("groupSessionId", 30L, "userId", 23L))).isNull();
        }
        finally {
            db.execute("SHUTDOWN");
        }
    }
}
