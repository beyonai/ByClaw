package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

/** Exercise real binding, session creation and scope persistence together; only storage boundaries are doubled. */
class HumanTaskCoordinatedPrivateTest extends I18nTestSupport {
    private final GroupHumanTaskMapper db = mock(GroupHumanTaskMapper.class);
    private final SessionService sessions = mock(SessionService.class);
    private final SessionExtService extensions = mock(SessionExtService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final ByaiGroupChatTaskMapper executions = mock(ByaiGroupChatTaskMapper.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final GroupWorkAssistantService assistants = mock(GroupWorkAssistantService.class);
    private final GroupChatExecutionCoordinator dispatcher = mock(GroupChatExecutionCoordinator.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final Map<Long, ByaiSession> sessionRows = new HashMap<>();
    private final Map<Long, ByaiGroupChatTask> executionRows = new HashMap<>();
    private final Map<Long, Map<String, Object>> bindings = new HashMap<>();
    private final Map<String, String> requests = new HashMap<>();
    private final Map<String, ByaiSessionExt> extensionRows = new HashMap<>();
    private HumanTaskLocalService service;

    @BeforeEach
    void setup() {
        LoginInfo login = new LoginInfo();
        login.setUserId(20L);
        CurrentUserHolder.setLoginInfo(login);
        SequenceService sequence = mock(SequenceService.class);
        AtomicLong next = new AtomicLong(100);
        when(sequence.nextVal()).thenAnswer(call -> next.incrementAndGet());
        GroupChatAuthorizationService auth = mock(GroupChatAuthorizationService.class);
        ByaiSession group = new ByaiSession();
        group.setSessionId(30L);
        group.setEnterpriseId(10L);
        sessionRows.put(30L, group);
        when(auth.requireGroup(30L)).thenReturn(group);
        when(sessions.findById(anyLong())).thenAnswer(call -> sessionRows.get(call.getArgument(0)));
        doAnswer(call -> {
            ByaiSession session = call.getArgument(0);
            sessionRows.put(session.getSessionId(), session);
            return null;
        }).when(sessions).save(any(ByaiSession.class));
        when(executions.selectById(anyLong())).thenAnswer(call -> executionRows.get(call.getArgument(0)));
        when(executions.insert(any(ByaiGroupChatTask.class))).thenAnswer(call -> {
            ByaiGroupChatTask task = call.getArgument(0);
            executionRows.put(task.getTaskSessionId(), task);
            return 1;
        });
        when(extensions.findOneByExtParamCode(anyLong(), anyString())).thenAnswer(call ->
            extensionRows.get(call.getArgument(0) + ":" + call.getArgument(1)));
        doAnswer(call -> {
            ByaiSessionExt ext = call.getArgument(0);
            extensionRows.put(ext.getSessionId() + ":" + ext.getExtParamCode(), ext);
            return null;
        }).when(extensions).save(any());
        for (Long id : List.of(41L, 42L, 43L, 50L)) {
            ByaiSessionMember member = new ByaiSessionMember();
            member.setMemObjId(id);
            member.setMemName("Employee " + id);
            when(members.findSessionMember(30L, "AGENT", id)).thenReturn(member);
        }
        when(assistants.resolveCoordinatorId(30L)).thenReturn(50L);
        SsResource coordinator = new SsResource();
        coordinator.setResourceId(50L);
        coordinator.setResourceStatus(2);
        coordinator.setResourceBizType("DIG_EMPLOYEE");
        coordinator.setResourceType("ASSISTANT");
        ByaiSessionExt coordinatorBinding = new ByaiSessionExt();
        coordinatorBinding.setExtParamValue("50");
        extensionRows.put("30:group_coordinator_agent_id", coordinatorBinding);
        when(resources.findById(50L)).thenReturn(coordinator);
        ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
        GroupChatApplicationService application = new GroupChatApplicationService(sessions, sequence, auth, members,
            null, null, messages, dispatcher, events, extensions);
        ReflectionTestUtils.setField(application, "groupChatTaskMapper", executions);
        ReflectionTestUtils.setField(application, "workAssistantService", assistants);
        ReflectionTestUtils.setField(application, "resourceService", resources);
        ReflectionTestUtils.setField(application, "coordinationService", new GroupChatCoordinationService(extensions, sequence, members));
        service = new HumanTaskLocalService(db, sequence, auth, members, sessions, messages,
            mock(GroupChatTopicService.class), extensions, executions, resources);
        ReflectionTestUtils.setField(service, "groupApplication", application);
        when(db.task(10L, 2L)).thenReturn("{\"humanTaskId\":\"2\",\"groupSessionId\":\"30\",\"status\":\"TODO\"}");
        when(db.binding(eq(10L), anyLong())).thenAnswer(call -> bindings.get(call.getArgument(1)));
        when(db.requireOpenForBinding(10L, 2L)).thenReturn(1);
        doAnswer(call -> {
            Map<String, Object> row = call.getArgument(0);
            bindings.put((Long) row.get("session"), Map.of("humanTaskId", row.get("task"), "entryType", row.get("type")));
            return 1;
        }).when(db).bind(any());
        when(db.request(eq(2L), anyString())).thenAnswer(call -> requests.get(call.getArgument(1)));
        doAnswer(call -> {
            Map<String, Object> row = call.getArgument(0);
            requests.putIfAbsent((String) row.get("request"), (String) row.get("payload"));
            return 1;
        }).when(db).insertRequest(any());
        doAnswer(call -> {
            Map<String, Object> row = call.getArgument(0);
            requests.put((String) row.get("request"), (String) row.get("payload"));
            return 1;
        }).when(db).updateRequest(any());
    }

    @AfterEach
    void clearLogin() { CurrentUserHolder.clearLoginInfo(); }

    private JSONObject bind(String selection, String request) {
        return service.call(10L, 20L, "bind", JSON.parseObject("{\"humanTaskId\":\"2\",\"entryType\":\"PRIVATE\",\"requestId\":\""
            + request + "\"," + selection + "}"));
    }

    @Test
    void selectedEmployeesRunUnderExistingCoordinatorWithoutPublicDispatch() {
        JSONObject result = bind("\"agentIds\":[\"41\",42,41]", "multi");
        assertEquals("50", result.getString("targetAgentId"));
        JSONObject scope = result.getJSONObject("groupCoordination");
        assertEquals("COORDINATED", scope.getString("mode"));
        assertEquals(List.of("41", "42"), scope.getJSONArray("allowedAgentIds").toJavaList(String.class));
        assertEquals(result.getString("taskSessionId"), scope.getString("taskSessionId"));
        ByaiGroupChatTask execution = executionRows.get(result.getLong("taskSessionId"));
        assertEquals("PRIVATE", execution.getStatus());
        assertEquals("PRIVATE", execution.getTurnStatus());
        assertEquals(50L, sessionRows.get(execution.getTaskSessionId()).getObjectId());
        assertNotNull(extensionRows.get(execution.getTaskSessionId() + ":group_coordination_scope"));
        verifyNoInteractions(dispatcher, events);
        verify(members, never()).batchSave(any());
    }

    @Test
    void singleEmployeeArrayKeepsDirectPrivateBehavior() {
        JSONObject result = bind("\"agentIds\":[41,\"41\"]", "single");
        assertEquals("41", result.getString("targetAgentId"));
        assertNull(result.get("groupCoordination"));
        assertEquals("PRIVATE", executionRows.get(result.getLong("taskSessionId")).getStatus());
        verifyNoInteractions(assistants);
    }

    @Test
    void legacyAgentIdKeepsDirectPrivateBehavior() {
        JSONObject result = bind("\"agentId\":41", "legacy");
        assertEquals("41", result.getString("targetAgentId"));
        assertNull(result.get("groupCoordination"));
    }

    @Test
    void replayPreservesScopeAndNewRequestCreatesIndependentSession() {
        JSONObject first = bind("\"agentIds\":[41,42]", "first");
        JSONObject retry = bind("\"agentIds\":[42,\" 41 \",41]", "first");
        assertEquals(first, retry);
        assertEquals(1, executionRows.size());
        JSONObject second = bind("\"agentIds\":[41,43]", "second");
        assertNotEquals(first.getString("taskSessionId"), second.getString("taskSessionId"));
        assertEquals(List.of("41", "43"), second.getJSONObject("groupCoordination").getJSONArray("allowedAgentIds").toJavaList(String.class));
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,43]", "first"));
        assertEquals(2, executionRows.size());
    }

    @Test
    void bindingDoesNotMutateCallerRequestAndSameObjectCanReplay() {
        JSONObject request = JSON.parseObject("{\"humanTaskId\":\"2\",\"entryType\":\"PRIVATE\",\"requestId\":\"reusable\",\"agentIds\":[42,41,42]}");
        JSONObject original = JSON.parseObject(request.toJSONString());
        JSONObject result = service.call(10L, 20L, "bind", request);
        assertEquals(original, request);
        assertFalse(request.containsKey("taskSessionId"));
        assertEquals(result, service.call(10L, 20L, "bind", request));
        assertEquals(1, executionRows.size());
    }

    @Test
    void historicalNumericAgentReceiptRemainsReplayable() {
        JSONObject original = JSON.parseObject("{\"humanTaskId\":\"2\",\"entryType\":\"PRIVATE\",\"requestId\":\"numeric-history\",\"agentId\":41}");
        JSONObject first = service.call(10L, 20L, "bind", original);
        // Older receipts hashed the original numeric field and did not return execution routing fields.
        JSONObject historical = JSON.parseObject(requests.get("bind:numeric-history"));
        historical.put("payloadHash", HumanTaskRules.hash(original));
        historical.getJSONObject("result").remove("targetAgentId");
        requests.put("bind:numeric-history", historical.toJSONString());
        JSONObject retry = service.call(10L, 20L, "bind", original);
        assertEquals(first, retry);
        assertEquals("41", retry.getString("targetAgentId"));
        assertEquals(1, executionRows.size());
    }

    @Test
    void invalidSelectionsNeverCreatePrivateSession() {
        for (String selection : List.of("\"agentId\":41,\"agentIds\":[42]", "\"agentIds\":[]",
            "\"agentIds\":[0,42]", "\"agentIds\":[41.5,42]", "\"agentIds\":[null,42]",
            "\"agentIds\":[\"9223372036854775808\",42]", "\"agentIds\":\"41,42\"")) {
            assertThrows(RuntimeException.class, () -> bind(selection, "bad"));
        }
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":" + java.util.stream.LongStream.rangeClosed(1, 101).boxed().toList(), "large"));
        assertTrue(executionRows.isEmpty());
    }

    @Test
    void employeeOutsideGroupIsRejectedBeforeCreation() {
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,99]", "missing"));
        assertTrue(executionRows.isEmpty());
    }

    @Test
    void unpublishedCoordinatorIsRejectedBeforeCreation() {
        when(resources.findById(50L)).thenReturn(null);
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,42]", "missing-coordinator"));
        SsResource draft = new SsResource();
        draft.setResourceId(50L);
        draft.setResourceStatus(1);
        draft.setResourceBizType("DIG_EMPLOYEE");
        when(resources.findById(50L)).thenReturn(draft);
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,42]", "draft-coordinator"));
        assertTrue(executionRows.isEmpty());
        verify(members, never()).batchSave(any());
    }

    @Test
    void requestCollisionCannotRevealAnotherUsersPrivateSession() {
        JSONObject first = bind("\"agentIds\":[41,42]", "owner");
        JSONObject request = JSON.parseObject("{\"humanTaskId\":\"2\",\"entryType\":\"PRIVATE\",\"requestId\":\"owner\",\"agentIds\":[41,42]}");
        RuntimeException error = assertThrows(RuntimeException.class, () -> service.call(10L, 21L, "bind", request));
        assertTrue(error.getMessage().contains("SESSION_SCOPE_MISMATCH"));
        assertEquals(first, bind("\"agentIds\":[41,42]", "owner"));
        assertEquals(1, executionRows.size());
    }

    @Test
    void retryAfterAcceptanceReturnsOriginalPrivateBinding() {
        JSONObject first = bind("\"agentIds\":[41,42]", "accepted");
        when(db.task(10L, 2L)).thenReturn("{\"humanTaskId\":\"2\",\"groupSessionId\":\"30\",\"status\":\"ACCEPTED\"}");
        assertEquals(first, bind("\"agentIds\":[41,42]", "accepted"));
        assertEquals(1, executionRows.size());
    }

    @Test
    void groupWithoutEnabledCoordinatorIsRejectedWithoutDefaultFallback() {
        extensionRows.remove("30:group_coordinator_agent_id");
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,42]", "disabled"));
        assertTrue(executionRows.isEmpty());
        verifyNoInteractions(assistants);
    }

    @Test
    void nonEmployeeResourceCannotCoordinatePrivateExecution() {
        SsResource invalid = new SsResource();
        invalid.setResourceId(50L);
        invalid.setResourceStatus(2);
        invalid.setResourceType("DIG_EMPLOYEE");
        invalid.setResourceBizType("OTHER");
        when(resources.findById(50L)).thenReturn(invalid);
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,42]", "wrong-resource"));
        assertTrue(executionRows.isEmpty());
    }

    @Test
    void removedCoordinatorCannotBeAddedByPrivateCreation() {
        when(members.findSessionMember(30L, "AGENT", 50L)).thenReturn(null);
        assertThrows(RuntimeException.class, () -> bind("\"agentIds\":[41,42]", "removed-coordinator"));
        assertTrue(executionRows.isEmpty());
        verify(members, never()).batchSave(any());
    }
}
