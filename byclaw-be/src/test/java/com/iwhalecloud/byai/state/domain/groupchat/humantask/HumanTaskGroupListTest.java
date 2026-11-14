package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessageRejectedException;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
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
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

/**
 * Verifies authorized whole-group task queries through the real mapper and local service.
 *
 * @author Codex
 * @since 2026-11-14
 */
class HumanTaskGroupListTest {
    private SqlSession sqlSession;
    private HumanTaskLocalService service;
    private SessionService sessions;
    private SessionMemberService members;
    private SessionExtService extensions;
    private ByaiSession group;

    /** Includes unrelated users, self assignments, another group, and another tenant. */
    @BeforeEach
    void setup() throws Exception {
        UnpooledDataSource source = new UnpooledDataSource("org.h2.Driver",
            "jdbc:h2:mem:group_tasks_" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1", "sa", "");
        Configuration configuration = new Configuration(new Environment("group-tasks",
            new JdbcTransactionFactory(), source));
        configuration.addMapper(GroupHumanTaskMapper.class);
        sqlSession = new SqlSessionFactoryBuilder().build(configuration).openSession();
        try (var statement = sqlSession.getConnection().createStatement()) {
            statement.execute("CREATE TABLE byai_group_human_task (human_task_id BIGINT PRIMARY KEY, "
                + "enterprise_id BIGINT, group_session_id BIGINT, initiator_user_id BIGINT, "
                + "assignee_user_id BIGINT, status VARCHAR(32), payload VARCHAR(1000))");
        }
        insert(1, 10, 30, 20, 21, "PENDING");
        insert(2, 10, 30, 21, 22, "PENDING");
        insert(3, 10, 30, 21, 23, "PENDING_REVIEW");
        insert(4, 10, 30, 22, 22, "CHANGES_REQUESTED");
        insert(5, 10, 30, 24, 25, "ACCEPTED");
        insert(6, 10, 31, 21, 22, "PENDING");
        insert(7, 11, 30, 21, 22, "PENDING");
        sessions = mock(SessionService.class);
        members = mock(SessionMemberService.class);
        extensions = mock(SessionExtService.class);
        group = new ByaiSession();
        group.setEnterpriseId(10L);
        group.setSessionType(SessionType.HS_AS.getCode());
        when(sessions.findById(30L)).thenReturn(group);
        when(members.findSessionMember(30L, "USER", 20L)).thenReturn(new ByaiSessionMember());
        GroupChatAuthorizationService authorization = new GroupChatAuthorizationService(sessions, members, extensions);
        service = new HumanTaskLocalService(sqlSession.getMapper(GroupHumanTaskMapper.class), null, authorization,
            members, sessions, null, null, extensions, null, null);
    }

    /** Releases the test database after every independent query scenario. */
    @AfterEach
    void cleanup() throws Exception {
        if (sqlSession != null) {
            try (var statement = sqlSession.getConnection().createStatement()) {
                statement.execute("DROP ALL OBJECTS");
            }
            sqlSession.close();
        }
    }

    /** Current membership exposes tasks unrelated to the actor, including self assignments. */
    @Test
    void allGroupTasksAreVisibleOnlyWithinTenantAndGroup() {
        assertItems(query("{}"), 5, "5", "4", "3", "2", "1");
        assertItems(query("{\"initiatorUserIds\":[],\"assigneeUserIds\":[]}"), 5, "5", "4", "3", "2", "1");
    }

    /** Each selection is an OR and the two selections intersect with each other and status. */
    @Test
    void multiplePeopleIntersectWithStatusAndPreserveHistoricalUsers() {
        assertItems(query("{\"initiatorUserIds\":[\"21\",\"22\"]}"), 3, "4", "3", "2");
        assertItems(query("{\"assigneeUserIds\":[\"22\",\"23\"]}"), 3, "4", "3", "2");
        assertItems(query("{\"initiatorUserIds\":[\"21\",\"24\"],\"assigneeUserIds\":[\"22\",\"25\"]}"), 2, "5", "2");
        assertItems(query("{\"initiatorUserIds\":[\"21\",\"24\"],\"assigneeUserIds\":[\"22\",\"25\"],\"status\":\"PENDING\"}"), 1, "2");
        assertItems(query("{\"status\":\"PENDING_REVIEW\"}"), 1, "3");
        assertItems(query("{\"status\":\"CHANGES_REQUESTED\"}"), 1, "4");
        assertItems(query("{\"status\":\"ACCEPTED\"}"), 1, "5");
    }

    /** Count and pages share exactly the same filters and deterministic descending ordering. */
    @Test
    void paginationKeepsUnpaginatedTotal() {
        assertItems(query("{\"pageNum\":2,\"pageSize\":2}"), 5, "3", "2");
        assertItems(query("{\"pageNum\":4,\"pageSize\":2}"), 5);
        assertItems(query("{\"status\":\"PENDING\",\"pageNum\":2,\"pageSize\":1}"), 2, "1");
    }

    /** Invalid filters never degrade into an unfiltered query. */
    @Test
    void validatesStatusIdsAndPagination() {
        for (String status : List.of("", "pending", "UNKNOWN")) {
            JSONObject body = new JSONObject();
            body.put("status", status);
            assertInvalid(body, "INVALID_STATUS");
        }
        for (String field : List.of("initiatorUserIds", "assigneeUserIds")) {
            for (Object invalid : List.of("21", List.of(""), List.of(" "), List.of("0"), List.of("-1"),
                List.of("1.5"), List.of("01"), List.of("9223372036854775808"), List.of("21", "bad"), List.of(21))) {
                JSONObject body = new JSONObject();
                body.put(field, invalid);
                assertInvalid(body, "INVALID_" + field);
            }
            JSONObject body = new JSONObject();
            body.put(field, IntStream.rangeClosed(1, 101).mapToObj(Integer::toString).toList());
            assertInvalid(body, "INVALID_" + field);
            body.put(field, Collections.nCopies(101, "21"));
            assertEquals(field.equals("initiatorUserIds") ? 2 : 1, call(body).getIntValue("total"));
            body.put(field, List.of(Long.toString(Long.MAX_VALUE)));
            assertItems(call(body), 0);
        }
        assertInvalid(JSONObject.parseObject("{\"pageNum\":0}"), "INVALID_PAGE");
        assertInvalid(JSONObject.parseObject("{\"pageNum\":1000001}"), "INVALID_PAGE");
        assertInvalid(JSONObject.parseObject("{\"pageSize\":0}"), "INVALID_PAGE_SIZE");
        assertInvalid(JSONObject.parseObject("{\"pageSize\":101}"), "INVALID_PAGE_SIZE");
    }

    /** Tenant ownership is checked before any group data is queried. */
    @Test
    void rejectsMissingGroupCrossTenantAndConflictingOwnership() {
        group.setEnterpriseId(11L);
        assertInvalid(new JSONObject(), "GROUP_SCOPE_MISMATCH");
        group.setEnterpriseId(10L);
        ByaiSessionExt ownership = new ByaiSessionExt();
        ownership.setExtParamValue("11");
        when(extensions.findOneByExtParamCode(30L, GroupChatApplicationService.BUSINESS_ENTERPRISE_EXT))
            .thenReturn(ownership);
        assertInvalid(new JSONObject(), "GROUP_SCOPE_MISMATCH");
        when(sessions.findById(30L)).thenReturn(null);
        assertInvalid(new JSONObject(), "GROUP_SCOPE_MISMATCH");
    }

    /** Authorization uses the supplied trusted actor and current member record, not task ownership. */
    @Test
    void rejectsNonMembersWrongSessionTypeAndDissolvedGroups() {
        try (var translations = mockStatic(I18nUtil.class)) {
            when(members.findSessionMember(30L, "USER", 20L)).thenReturn(null);
            assertThrows(GroupChatMessageRejectedException.class, () -> query("{}"));
            when(members.findSessionMember(30L, "USER", 20L)).thenReturn(new ByaiSessionMember());
            group.setSessionType(SessionType.H_AS.getCode());
            assertThrows(GroupChatMessageRejectedException.class, () -> query("{}"));
            group.setSessionType(SessionType.HS_AS.getCode());
            group.setState(GroupChatAuthorizationService.DISSOLVED_STATE);
            assertThrows(GroupChatMessageRejectedException.class, () -> query("{}"));
        }
    }

    /** Parses a compact filter fixture into the same service request used by the HTTP endpoint. */
    private JSONObject query(String json) {
        return call(JSONObject.parseObject(json));
    }

    /** Adds the route identity while keeping authenticated tenant and actor outside the body. */
    private JSONObject call(JSONObject body) {
        body.put("groupSessionId", "30");
        return service.call(10L, 20L, "groupList", body);
    }

    /** Checks the existing human-task error protocol. */
    private void assertInvalid(JSONObject body, String code) {
        assertEquals("HUMAN_TASK_" + code,
            assertThrows(ResponseStatusException.class, () -> call(body)).getReason());
    }

    /** Verifies ordered payload IDs and the independent count together. */
    private void assertItems(JSONObject result, long total, String... ids) {
        assertEquals(total, result.getLongValue("total"));
        assertEquals(List.of(ids), result.getJSONArray("items").toJavaList(JSONObject.class).stream()
            .map(item -> item.getString("humanTaskId")).toList());
    }

    /** Inserts indexed filter values with the basic task payload returned by the mapper. */
    private void insert(long id, long tenant, long groupId, long initiator, long assignee, String status) throws Exception {
        try (var statement = sqlSession.getConnection().prepareStatement(
            "INSERT INTO byai_group_human_task VALUES (?, ?, ?, ?, ?, ?, ?)")) {
            statement.setLong(1, id);
            statement.setLong(2, tenant);
            statement.setLong(3, groupId);
            statement.setLong(4, initiator);
            statement.setLong(5, assignee);
            statement.setString(6, status);
            statement.setString(7, "{\"humanTaskId\":\"" + id + "\"}");
            statement.executeUpdate();
        }
    }
}
