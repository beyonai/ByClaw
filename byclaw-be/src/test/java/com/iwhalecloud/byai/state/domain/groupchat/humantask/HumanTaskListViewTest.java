package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.List;
import java.util.UUID;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Verifies list views and matching totals against the production MyBatis mapper.
 *
 * @author Codex
 * @since 2026-11-14
 */
class HumanTaskListViewTest {
    private SqlSession session;

    private HumanTaskLocalService service;

    /** Creates mixed ownership, tenant and lifecycle fixtures for each independent query. */
    @BeforeEach
    void setup() throws Exception {
        UnpooledDataSource source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:human_task_view_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        try (Connection connection = source.getConnection()) {
            try (var statement = connection.createStatement()) {
                statement.execute("CREATE TABLE byai_group_human_task (human_task_id BIGINT PRIMARY KEY, "
                    + "enterprise_id BIGINT, initiator_user_id BIGINT, assignee_user_id BIGINT, "
                    + "status VARCHAR(32), payload VARCHAR(1000), group_session_id BIGINT)");
            }
            insert(connection, 1, 10, 20, 21, "PENDING_REVIEW");
            insert(connection, 2, 10, 20, 20, "PENDING_REVIEW");
            insert(connection, 3, 10, 21, 20, "PENDING_REVIEW");
            insert(connection, 4, 10, 21, 20, "PENDING");
            insert(connection, 5, 10, 21, 20, "CHANGES_REQUESTED");
            insert(connection, 6, 10, 20, 20, "PENDING");
            insert(connection, 7, 10, 20, 20, "CHANGES_REQUESTED");
            insert(connection, 8, 10, 20, 21, "CHANGES_REQUESTED");
            insert(connection, 9, 10, 21, 20, "ACCEPTED");
            insert(connection, 10, 11, 20, 20, "PENDING_REVIEW");
            insert(connection, 11, 11, 21, 20, "CHANGES_REQUESTED");
            insert(connection, 12, 10, 21, 22, "CHANGES_REQUESTED");
            insert(connection, 13, 10, 22, 21, "PENDING_REVIEW");
        }
        Configuration configuration = new Configuration(new Environment("human-task-view",
            new JdbcTransactionFactory(), source));
        // Register only the interface, as production and existing mapper tests do.
        configuration.addMapper(GroupHumanTaskMapper.class);
        session = new SqlSessionFactoryBuilder().build(configuration).openSession();
        service = new HumanTaskLocalService(session.getMapper(GroupHumanTaskMapper.class), null, null,
            null, null, null, null, null, null, null);
    }

    /** Releases the session and its isolated in-memory fixture database. */
    @AfterEach
    void cleanup() throws Exception {
        if (session != null) {
            try (var statement = session.getConnection().createStatement()) {
                statement.execute("DROP ALL OBJECTS");
            }
            session.close();
        }
    }

    /** Review includes self-assigned tasks while replacing conflicting legacy filters. */
    @Test
    void pendingReviewBelongsToInitiatorIncludingSelfAssignment() {
        assertItems(query("PENDING_REVIEW", "ASSIGNED", "ACCEPTED", 1, 20), 2, "2", "1");
    }

    /** Completion includes both actionable statuses but excludes all self-assigned tasks. */
    @Test
    void pendingCompletionIncludesReturnedTasksAndExcludesSelfAssignment() {
        assertItems(query("PENDING_COMPLETION", "INITIATED", "ACCEPTED", 1, 20), 2, "5", "4");
    }

    /** Modification narrows the same external-assignment ownership to returned tasks. */
    @Test
    void pendingModificationOnlyIncludesReturnedExternalAssignments() {
        assertItems(query("PENDING_MODIFICATION", "INITIATED", "PENDING", 1, 20), 1, "5");
    }

    /** Filtering precedes pagination and total remains the unpaginated matching count. */
    @Test
    void viewPaginationAndTotalUseTheSamePredicate() {
        assertItems(query("PENDING_COMPLETION", "ALL", null, 1, 1), 2, "5");
        assertItems(query("PENDING_COMPLETION", "ALL", null, 2, 1), 2, "4");
        assertItems(query("PENDING_COMPLETION", "ALL", null, 3, 1), 2);
    }

    /** Requests omitting view retain legacy relationship, status and self-assignment behavior. */
    @Test
    void omittedViewPreservesLegacyFilters() {
        assertItems(query(null, "ALL", null, 1, 20), 9, "9", "8", "7", "6", "5", "4", "3", "2", "1");
        assertItems(query(null, "ASSIGNED", "CHANGES_REQUESTED", 1, 20), 2, "7", "5");
        assertItems(query(null, "INITIATED", "PENDING_REVIEW", 1, 20), 2, "2", "1");
        assertItems(query(null, null, null, 1, 20), 9, "9", "8", "7", "6", "5", "4", "3", "2", "1");
        assertItems(query(null, "ALL", "", 1, 20), 0);
    }

    /** Invalid values must not fall back to the wider legacy list. */
    @Test
    void invalidAndEmptyViewsAreRejected() {
        for (String view : List.of("", " ", "pending_review", "UNKNOWN")) {
            ResponseStatusException exception = assertThrows(ResponseStatusException.class,
                () -> query(view, "ALL", null, 1, 20));
            assertEquals("HUMAN_TASK_INVALID_VIEW", exception.getReason());
        }
    }

    /** Homepage counts use the same ownership predicates as each unpaginated view. */
    @Test
    void countsMatchViewsWithoutReadingPayloads() throws Exception {
        // Invalid payload proves aggregation does not deserialize or fetch task detail rows.
        try (var statement = session.getConnection().createStatement()) {
            statement.executeUpdate("UPDATE byai_group_human_task SET payload='not-json'");
        }
        JSONObject counts = service.call(10L, 20L, "counts", new JSONObject());
        assertEquals(4, counts.size());
        assertEquals(2L, counts.get("pendingReview"));
        assertEquals(2L, counts.get("pendingCompletion"));
        assertEquals(1L, counts.get("pendingModification"));
        assertEquals(4L, counts.get("total"));
    }

    /** Empty accounts return numeric zero values for all homepage badges. */
    @Test
    void countsAreZeroForUnrelatedActorAndTenant() {
        for (JSONObject counts : List.of(service.call(10L, 99L, "counts", new JSONObject()),
            service.call(99L, 20L, "counts", new JSONObject()))) {
            assertEquals(0L, counts.get("pendingReview"));
            assertEquals(0L, counts.get("pendingCompletion"));
            assertEquals(0L, counts.get("pendingModification"));
            assertEquals(0L, counts.get("total"));
        }
    }

    /** Group filtering narrows views and legacy filters, including totals before pagination. */
    @Test
    void groupFilterAppliesToListsAndCounts() {
        JSONObject body = JSONObject.parseObject("{\"groupSessionId\":\"100\",\"view\":\"PENDING_COMPLETION\",\"pageSize\":1}");
        assertItems(service.call(10L, 20L, "list", body), 1, "4");
        body.put("pageNum", 2);
        assertItems(service.call(10L, 20L, "list", body), 1);
        body.remove("view");
        body.put("pageNum", 1);
        body.put("relation", "INITIATED");
        body.put("status", "PENDING_REVIEW");
        assertItems(service.call(10L, 20L, "list", body), 1, "2");
        JSONObject counts = service.call(10L, 20L, "counts", body);
        assertEquals(1L, counts.get("pendingReview"));
        assertEquals(1L, counts.get("pendingCompletion"));
        assertEquals(0L, counts.get("pendingModification"));
        assertEquals(2L, counts.get("total"));
        body.put("groupSessionId", "200");
        assertEquals(1L, service.call(10L, 20L, "counts", body).get("pendingModification"));
        body.put("groupSessionId", "999");
        assertItems(service.call(10L, 20L, "list", body), 0);
        assertEquals(0L, service.call(10L, 20L, "counts", body).get("total"));
        body.put("groupSessionId", "100");
        assertEquals(0L, service.call(99L, 20L, "counts", body).get("total"));
        assertItems(service.call(10L, 99L, "list", body), 0);
    }

    /** Malformed group IDs must fail rather than silently remove the group filter. */
    @Test
    void invalidGroupFilterIsRejected() {
        for (String value : List.of("", "0", "-1", "abc", "1 OR 1=1")) {
            JSONObject body = new JSONObject();
            body.put("groupSessionId", value);
            for (String action : List.of("list", "counts")) {
                assertThrows(ResponseStatusException.class, () -> service.call(10L, 20L, action, body));
            }
        }
    }

    /** Invokes the actual local list path with trusted tenant and actor identities. */
    private JSONObject query(String view, String relation, String status, int page, int size) {
        JSONObject body = new JSONObject();
        if (view != null) {
            body.put("view", view);
        }
        body.put("relation", relation);
        body.put("status", status);
        body.put("pageNum", page);
        body.put("pageSize", size);
        return service.call(10L, 20L, "list", body);
    }

    /** Asserts payload ordering and the independent count query together. */
    private void assertItems(JSONObject result, long total, String... ids) {
        assertEquals(total, result.getLongValue("total"));
        assertEquals(List.of(ids), result.getJSONArray("items").toJavaList(JSONObject.class).stream()
            .map(item -> item.getString("humanTaskId")).toList());
    }

    /** Inserts a payload alongside the indexed values used by list predicates. */
    private void insert(Connection connection, long id, long tenant, long initiator, long assignee,
        String status) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement(
            "INSERT INTO byai_group_human_task VALUES (?, ?, ?, ?, ?, ?, ?)")) {
            statement.setLong(1, id);
            statement.setLong(2, tenant);
            statement.setLong(3, initiator);
            statement.setLong(4, assignee);
            statement.setString(5, status);
            statement.setString(6, "{\"humanTaskId\":\"" + id + "\"}");
            statement.setLong(7, id % 2 == 0 ? 100L : 200L);
            statement.executeUpdate();
        }
    }
}
