package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCoordinationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatCoordinationServiceTest {
    private final SessionExtService extensions = mock(SessionExtService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final Map<Long, ByaiSessionExt> rows = new HashMap<>();
    private final GroupChatCoordinationService service = new GroupChatCoordinationService(extensions, sequence, members);

    @BeforeEach
    void setup() {
        when(extensions.findOneByExtParamCode(anyLong(), anyString())).thenAnswer(call -> rows.get(call.getArgument(0)));
        doAnswer(call -> {
            ByaiSessionExt ext = call.getArgument(0);
            rows.put(ext.getSessionId(), ext);
            return null;
        }).when(extensions).save(any());
        when(members.findSessionMember(anyLong(), anyString(), anyLong())).thenReturn(new ByaiSessionMember());
        service.resolveForExecution(10L, 20L, List.of(2L, 3L, 2L, 9L), 9L, "COORDINATED");
    }

    @AfterEach
    void clearLogin() { CurrentUserHolder.clearLoginInfo(); }

    @Test
    void serverScopeSurvivesServiceRecreationAndReplacesClientScope() {
        GroupChatCoordinationService recreated = new GroupChatCoordinationService(extensions, sequence, members);
        AssistantChatDto request = request(9L);
        request.setExtParams(new HashMap<>(Map.of("groupCoordination", Map.of("allowedAgentIds", List.of("99")),
            "groupContextSnapshot", Map.of("messages", List.of("forged")), "groupTaskContext", Map.of("objective", "forged"))));
        recreated.validateRequest(request);
        Map<?, ?> scope = (Map<?, ?>) request.getExtParams().get("groupCoordination");
        assertThat(scope.get("allowedAgentIds")).isEqualTo(List.of("2", "3"));
        assertThat(scope.get("coordinatorAgentId")).isEqualTo("9");
        assertThat(request.getExtParams()).doesNotContainKeys("groupContextSnapshot", "groupTaskContext");
    }

    @Test
    void continuationCannotReplaceCoordinatorOrAddParallelLanes() {
        assertThatThrownBy(() -> service.validateRequest(request(2L))).hasMessageContaining("group work assistant");
        AssistantChatDto request = request(9L);
        request.setExtParams(new HashMap<>(Map.of("multi_agent", Map.of("lanes", List.of(Map.of("agentId", "2"))))));
        assertThatThrownBy(() -> service.validateRequest(request)).hasMessageContaining("parallel chat lanes");
    }

    @Test
    void continuationCannotExpandSelectedRosterEvenWhenEmployeeIsAGroupMember() {
        AssistantChatDto request = request(9L);
        ResourceVo employee = new ResourceVo();
        employee.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        employee.setResourceId("4");
        request.setResourceList(List.of(employee));
        assertThatThrownBy(() -> service.validateRequest(request)).hasMessageContaining("outside this group");
        employee.setResourceId("2");
        service.validateRequest(request);
        when(members.findSessionMember(10L, "AGENT", 2L)).thenReturn(null);
        assertThatThrownBy(() -> service.validateRequest(request)).hasMessageContaining("no longer a group member");
    }

    @Test
    void childRoutingHintsCannotMoveTheContinuationToAnotherPlatformTask() {
        AssistantChatDto request = request(9L);
        request.setExtParams(new HashMap<>(Map.of("dsh_target_session_id", "durable-child",
            "byclaw_root_session_id", "20")));
        service.validateRequest(request);
        Map<String, Object> gatewayParams = new HashMap<>();
        GroupChatCoordinationService.attachDshTarget(request, service.findScope(20L), gatewayParams);
        assertThat(gatewayParams).containsEntry("dsh_target_session_id", "durable-child");
        request.getExtParams().put("byclaw_root_session_id", "99");
        assertThatThrownBy(() -> service.validateRequest(request)).hasMessageContaining("original task session");
    }

    @Test
    void ordinarySessionCannotProvideItsOwnCoordinationPolicy() {
        AssistantChatDto request = request(9L);
        request.setSessionId(30L);
        request.setExtParams(new HashMap<>(Map.of("groupCoordination", Map.of("mode", "COORDINATED"))));
        service.validateRequest(request);
        assertThat(request.getExtParams()).doesNotContainKey("groupCoordination");
    }

    @Test
    void activeLegacyTaskGetsOneServerOwnedDirectScopeOnItsInitiatorsFirstContinuation() {
        GroupChatApplicationService application = legacyTask("ACTIVE", 47L, 47L);
        when(application.ensureDefaultCoordinator(10L)).thenReturn(9L);
        when(members.findSessionMembers(10L, "AGENT", null))
            .thenReturn(List.of(member(2L), member(3L), member(9L)));
        AssistantChatDto request = request(2L);
        request.setSessionId(30L);
        request.setExtParams(Map.of("groupCoordination", Map.of("allowedAgentIds", List.of("999"))));

        service.validateRequest(request);
        service.validateRequest(request);

        Map<String, Object> persisted = service.findScope(30L);
        assertThat(persisted).containsEntry("mode", "DIRECT")
            .containsEntry("taskSessionId", "30").containsEntry("groupSessionId", "10")
            .containsEntry("coordinatorAgentId", "9").containsEntry("allowedAgentIds", List.of("2", "3"));
        assertThat(request.getExtParams().get("groupCoordination")).isEqualTo(persisted);
        verify(application, times(1)).ensureDefaultCoordinator(10L);
    }

    @Test
    void legacyScopeCannotBeCreatedByAnotherUserOrForATerminalTask() {
        GroupChatApplicationService application = legacyTask("ACTIVE", 47L, 48L);
        AssistantChatDto request = request(2L);
        request.setSessionId(30L);
        service.validateRequest(request);
        assertThat(rows).doesNotContainKey(30L);
        assertThat(request.getExtParams()).doesNotContainKey("groupCoordination");
        verify(application, never()).ensureDefaultCoordinator(anyLong());

        application = legacyTask("PUBLISHED", 47L, 47L);
        service.validateRequest(request);
        assertThat(rows).doesNotContainKey(30L);
        verify(application, never()).ensureDefaultCoordinator(anyLong());
    }

    @Test
    void legacyTaskMustPassTheGroupsCurrentMembershipCheckBeforeScopeIsPersisted() {
        GroupChatApplicationService application = legacyTask("ACTIVE", 47L, 47L);
        when(application.ensureDefaultCoordinator(10L)).thenThrow(new IllegalArgumentException("User is not a group member"));
        AssistantChatDto request = request(2L);
        request.setSessionId(30L);

        assertThatThrownBy(() -> service.validateRequest(request)).hasMessage("User is not a group member");
        assertThat(rows).doesNotContainKey(30L);
        verify(application).ensureDefaultCoordinator(10L);
    }

    @Test
    void legacyUpgradeKeepsTheScopeAnotherRequestSavedWhileWaitingForTheGroupLock() {
        GroupChatApplicationService application = legacyTask("ACTIVE", 47L, 47L);
        when(application.ensureDefaultCoordinator(10L)).thenAnswer(call -> {
            service.resolveForExecution(10L, 30L, List.of(2L), 9L, "DIRECT");
            return 9L;
        });
        when(members.findSessionMembers(10L, "AGENT", null))
            .thenReturn(List.of(member(2L), member(3L), member(9L)));
        AssistantChatDto request = request(2L);
        request.setSessionId(30L);

        service.validateRequest(request);

        assertThat(service.findScope(30L)).containsEntry("allowedAgentIds", List.of("2"));
        assertThat(request.getExtParams().get("groupCoordination")).isEqualTo(service.findScope(30L));
    }

    @Test
    void directTaskWithOnlyTheCoordinatorHasAValidEmptyWorkerRoster() {
        rows.clear();
        service.resolveForExecution(10L, 20L, List.of(9L), 9L, "DIRECT");
        AssistantChatDto request = request(9L);
        service.validateRequest(request);
        assertThat(service.findScope(20L)).containsEntry("allowedAgentIds", List.of()).containsEntry("mode", "DIRECT");
    }

    @Test
    void directAssistanceCannotReuseAWorkerWhoHasLeftTheGroup() {
        rows.clear();
        service.resolveForExecution(10L, 20L, List.of(2L, 3L), 9L, "DIRECT");
        when(members.findSessionMember(10L, "AGENT", 3L)).thenReturn(null);

        assertThatThrownBy(() -> service.validateRequest(request(9L)))
            .hasMessageContaining("no longer a group member");
        assertThat(service.findScope(20L)).containsEntry("allowedAgentIds", List.of("2", "3"));
    }

    @Test
    void directRootCannotContinueWithAnEmployeeWhoHasLeftTheGroup() {
        rows.clear();
        service.resolveForExecution(10L, 20L, List.of(2L, 3L), 9L, "DIRECT");
        when(members.findSessionMember(10L, "AGENT", 4L)).thenReturn(null);

        assertThatThrownBy(() -> service.validateRequest(request(4L)))
            .hasMessageContaining("task employee is no longer a group member");
    }

    @SuppressWarnings("unchecked")
    private GroupChatApplicationService legacyTask(String status, Long initiator, Long currentUser) {
        LoginInfo login = new LoginInfo();
        login.setUserId(currentUser);
        CurrentUserHolder.setLoginInfo(login);
        SessionService sessionService = mock(SessionService.class);
        ObjectProvider<SessionService> sessionProvider = mock(ObjectProvider.class);
        when(sessionProvider.getIfAvailable()).thenReturn(sessionService);
        ByaiSession session = new ByaiSession();
        session.setSessionId(30L);
        session.setState("GROUP_TASK");
        when(sessionService.findById(30L)).thenReturn(session);
        ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(30L);
        task.setGroupSessionId(10L);
        task.setInitiatorUserId(initiator);
        task.setStatus(status);
        when(tasks.selectById(30L)).thenReturn(task);
        GroupChatApplicationService application = mock(GroupChatApplicationService.class);
        ObjectProvider<GroupChatApplicationService> applicationProvider = mock(ObjectProvider.class);
        when(applicationProvider.getIfAvailable()).thenReturn(application);
        ReflectionTestUtils.setField(service, "sessions", sessionProvider);
        ReflectionTestUtils.setField(service, "tasks", tasks);
        ReflectionTestUtils.setField(service, "applications", applicationProvider);
        return application;
    }

    private ByaiSessionMember member(Long id) {
        ByaiSessionMember member = new ByaiSessionMember();
        member.setMemObjId(id);
        member.setMemObjType("AGENT");
        return member;
    }

    private AssistantChatDto request(Long agentId) {
        AssistantChatDto request = new AssistantChatDto();
        request.setSessionId(20L);
        request.setAgentId(agentId);
        return request;
    }
}
