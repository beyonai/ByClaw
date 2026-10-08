package com.iwhalecloud.byai.manager.mapper.message;

import static org.assertj.core.api.Assertions.assertThat;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.common.message.dto.MemRelSearchRequestDto;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageRel;
import java.sql.Connection;
import java.sql.DriverManager;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class ConversationSearchMapperTest {

    private SqlSessionFactory factory;
    private final LocalDateTime boundary = LocalDateTime.of(2026, 9, 2, 12, 0);

    @BeforeEach
    void setUp() throws Exception {
        String url = "jdbc:h2:mem:conversation-" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        try (Connection connection = DriverManager.getConnection(url); var statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE byai_message_relobj (
                    rel_id BIGINT PRIMARY KEY, task_id BIGINT, project_id BIGINT, com_acct_id BIGINT, session_id BIGINT,
                    ask_msg_id BIGINT, ask_content VARCHAR, ask_obj_type VARCHAR, ask_obj_id BIGINT,
                    ask_access_terminal VARCHAR, ask_time TIMESTAMP, ask_content_tags VARCHAR,
                    res_msg_id BIGINT, res_content VARCHAR, res_obj_type VARCHAR, res_obj_id BIGINT,
                    res_access_terminal VARCHAR, res_time TIMESTAMP, res_content_tags VARCHAR,
                    feedback_type VARCHAR, feedback_score REAL, feedback_content VARCHAR, feedback_time TIMESTAMP,
                    feedback_label VARCHAR, request_status INTEGER, task_due_time REAL, first_text_duration REAL,
                    create_time TIMESTAMP)
                """);
            statement.execute("""
                INSERT INTO byai_message_relobj(rel_id, ask_obj_id, ask_obj_type, res_obj_id, res_obj_type,
                    ask_time, ask_content, res_content) VALUES
                    (1, 7, 'HUMAN', 10, 'AGENT', '2026-09-01 12:00:00', '预算提问', '回答'),
                    (2, 7, 'HUMAN', 10, 'AGENT', '2026-09-02 12:00:00', '提问', '预算回复'),
                    (3, 8, 'HUMAN', 10, 'AGENT', '2026-09-02 12:00:00', '预算提问', '回答'),
                    (4, 7, 'HUMAN', 11, 'AGENT', '2026-09-02 12:00:00', '预算提问', '回答'),
                    (5, 7, 'HUMAN', 10, 'AGENT', '2026-09-03 12:00:00', '进度50%_完成', '回答')
                """);
        }
        MybatisConfiguration configuration = new MybatisConfiguration(new Environment("conversation-test",
            new JdbcTransactionFactory(), new UnpooledDataSource("org.h2.Driver", url, null, null)));
        configuration.addMapper(ByaiMessageRelMapper.class);
        factory = new SqlSessionFactoryBuilder().build(configuration);
    }

    @Test
    void searchesQuestionOrAnswerAndCombinesAllFiltersInclusively() {
        MemRelSearchRequestDto query = query();
        query.setKeyword("预算");
        assertThat(ids(query)).containsExactly(4L, 3L, 2L, 1L);
        query.setAskObjIds(List.of(7L));
        query.setAskObjTypes(List.of("HUMAN"));
        query.setResObjIds(List.of(10L));
        query.setResObjTypes(List.of("AGENT"));
        query.setAskTimeRange(List.of(boundary, boundary));
        assertThat(ids(query)).containsExactly(2L);
    }

    @Test
    void supportsSingleSidedBoundsAndDeterministicOrdering() {
        MemRelSearchRequestDto query = query();
        assertThat(ids(query)).containsExactly(5L, 4L, 3L, 2L, 1L);
        query.setAskTimeRange(Arrays.asList(boundary, null));
        assertThat(ids(query)).containsExactly(5L, 4L, 3L, 2L);
        query.setAskTimeRange(Arrays.asList(null, boundary));
        assertThat(ids(query)).containsExactly(4L, 3L, 2L, 1L);
    }

    @Test
    void escapedWildcardsMatchLiteralContentAndSqlTextRemainsData() {
        MemRelSearchRequestDto query = query();
        query.setKeyword("50\\%\\_");
        assertThat(ids(query)).containsExactly(5L);
        query.setKeyword("' OR 1=1 --");
        assertThat(ids(query)).isEmpty();
    }

    private MemRelSearchRequestDto query() {
        MemRelSearchRequestDto query = new MemRelSearchRequestDto();
        query.setSortField("askTime");
        query.setSortDirection("DESC");
        return query;
    }

    private List<Long> ids(MemRelSearchRequestDto query) {
        try (SqlSession session = factory.openSession()) {
            return session.getMapper(ByaiMessageRelMapper.class).selectSearchMemPage(query).stream()
                .map(ByaiMessageRel::getRelId).toList();
        }
    }
}
