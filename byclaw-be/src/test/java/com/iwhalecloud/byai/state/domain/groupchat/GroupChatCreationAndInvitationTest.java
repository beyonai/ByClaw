package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.util.Arrays;
import java.util.List;
import javax.sql.DataSource;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatInvitationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatSettingsService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatDetailResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import jakarta.validation.Validation;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.http.MediaType;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.result.MockMvcResultMatchers;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class GroupChatCreationAndInvitationTest {
    private final GroupWorkAssistantService workAssistant = mock(GroupWorkAssistantService.class);
    private final ProjectApplicationService projects = mock(ProjectApplicationService.class);
    private final ProjectMemberService projectMembers = mock(ProjectMemberService.class);
    private final SessionService sessions = mock(SessionService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final WorkgroupTemplateService templates = mock(WorkgroupTemplateService.class);
    private final SessionExtService sessionExt = mock(SessionExtService.class);
    private GroupChatApplicationService service;

    @BeforeEach
    void setUp() {
        TransactionSynchronizationManager.initSynchronization();
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        CurrentUserHolder.setLoginInfo(login);
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(200L, 201L, 202L, 203L, 204L, 205L, 206L);
        service = new GroupChatApplicationService(sessions, sequence, authorization, members,
            projects, projectMembers, messages, mock(GroupChatExecutionCoordinator.class),
            events, sessionExt);
        ReflectionTestUtils.setField(service, "workgroupTemplateService", templates);
        ReflectionTestUtils.setField(service, "groupWorkAssistantService", workAssistant);
        when(workAssistant.resolveResourceId()).thenReturn(null);
        when(projects.createProject(any())).thenAnswer(invocation -> {
            ProjectDTO request = invocation.getArgument(0);
            Project project = new Project();
            project.setProjectId(100L);
            project.setProjectName(request.getProjectName().trim());
            return project;
        });
        ByaiSession group = new ByaiSession();
        group.setSessionId(200L);
        group.setProjectId(100L);
        when(authorization.requireGroup(200L)).thenReturn(group);
    }

    @AfterEach
    void tearDown() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void createsSameNameProjectAndDeduplicatedMembersWithLoggedInOwner() {
        GroupChatCreateRequest request = request();
        request.setUserIds(List.of(10L, 20L, 20L));
        request.setAgentIds(List.of(30L, 30L));

        GroupChatDetailResponse result = service.create(request);

        assertThat(result.getSession().getProjectId()).isEqualTo(100L);
        assertThat(result.getSession().getSessionName()).isEqualTo("协作群");
        assertThat(result.getSession().getCreatorId()).isEqualTo(10L);
        assertThat(result.getMembers()).extracting(ByaiSessionMember::getMemObjId).containsExactly(10L, 20L, 30L);
        assertThat(result.getMembers()).extracting(ByaiSessionMember::getUserRole)
            .containsExactly("OWNER", "MEMBER", "MEMBER");
        assertThat(result.getMembers()).extracting(ByaiSessionMember::getMemObjType)
            .containsExactly("USER", "USER", "AGENT");
        verify(projectMembers).addMembers(100L, List.of(20L), "member");
        verify(projectMembers, never()).addMember(any(), any(), any());
        verify(sessions).save(result.getSession());
        verify(members).batchSave(result.getMembers());
        assertDefaultMemberPermissions(result.getSession().getSessionId());
        ArgumentCaptor<ProjectDTO> projectRequest = ArgumentCaptor.forClass(ProjectDTO.class);
        verify(projects).createProject(projectRequest.capture());
        assertThat(projectRequest.getValue().getProjectName()).isEqualTo(request.getName());
        assertThat(projectRequest.getValue().getDescription()).isEqualTo(request.getGoal());
        // 初始成员属于建群状态，不进入成员变更时间线。
        verify(messages, never()).insert(any(ByaiMessage.class));
        TransactionSynchronizationManager.getSynchronizations().forEach(sync -> sync.afterCommit());
        verifyNoInteractions(events);
    }

    @Test
    void keepsTemplateResourcesIntactAndMergesThemWithExplicitAgents() {
        GroupChatCreateRequest request = request();
        request.setTemplateId(50L);
        request.setExpectedTemplateVersion(3L);
        request.setAgentIds(List.of(30L, 31L));
        // 31 可以是单个数字员工，32 可以是数字员工组；创建群时都以原始资源 ID 入群。
        when(templates.resolveResourceIds(50L, 3L)).thenReturn(List.of(31L, 32L));

        GroupChatDetailResponse result = service.create(request);

        assertThat(result.getMembers())
            .filteredOn(member -> "AGENT".equals(member.getMemObjType()))
            .extracting(ByaiSessionMember::getMemObjId)
            .containsExactly(30L, 31L, 32L);
        verify(templates).resolveResourceIds(50L, 3L);
        assertDefaultMemberPermissions(result.getSession().getSessionId());
    }

    private void assertDefaultMemberPermissions(Long sessionId) {
        ArgumentCaptor<ByaiSessionExt> captured = ArgumentCaptor.forClass(ByaiSessionExt.class);
        verify(sessionExt, times(2)).save(captured.capture());
        assertThat(captured.getAllValues()).extracting(ByaiSessionExt::getExtParamCode)
            .containsExactlyInAnyOrder(GroupChatAuthorizationService.MEMBER_INVITE_USER,
                GroupChatAuthorizationService.MEMBER_ADD_AGENT);
        assertThat(captured.getAllValues()).allSatisfy(ext -> {
            assertThat(ext.getSessionId()).isEqualTo(sessionId);
            assertThat(ext.getExtParamValue()).isEqualTo("true");
            assertThat(ext.getExtParamName()).isEqualTo(ext.getExtParamCode());
            assertThat(ext.getExtId()).isNotNull();
        });
    }

    @Test
    void addsConfiguredWorkAssistantToNewGroup() {
        when(workAssistant.resolveResourceId()).thenReturn(40L);
        GroupChatDetailResponse result = service.create(request());
        assertThat(result.getMembers()).filteredOn(member -> "AGENT".equals(member.getMemObjType()))
            .extracting(ByaiSessionMember::getMemObjId).containsExactly(40L);
        verify(members).batchSave(result.getMembers());
    }

    @Test
    void groupsInDifferentEnterprisesIncludeSamePlatformAssistant() {
        when(workAssistant.resolveResourceId()).thenReturn(40L);
        for (Long enterpriseId : List.of(20L, 21L)) {
            LoginInfo login = new LoginInfo();
            login.setUserId(10L);
            login.setEnterpriseId(enterpriseId);
            CurrentUserHolder.setLoginInfo(login);
            GroupChatDetailResponse result = service.create(request());
            assertThat(result.getSession().getEnterpriseId()).isEqualTo(enterpriseId);
            assertThat(result.getMembers()).filteredOn(member -> "AGENT".equals(member.getMemObjType()))
                .extracting(ByaiSessionMember::getMemObjId).containsExactly(40L);
        }
    }

    @Test
    void deduplicatesWorkAssistantAgainstSelectedAndTemplateAgents() {
        when(workAssistant.resolveResourceId()).thenReturn(40L);
        GroupChatCreateRequest request = request();
        request.setAgentIds(List.of(40L));
        request.setTemplateId(50L);
        request.setExpectedTemplateVersion(3L);
        when(templates.resolveResourceIds(50L, 3L)).thenReturn(List.of(40L, 41L));
        assertThat(service.create(request).getMembers())
            .filteredOn(member -> "AGENT".equals(member.getMemObjType()))
            .extracting(ByaiSessionMember::getMemObjId).containsExactly(40L, 41L);
    }

    @Test
    void createsGroupWithoutWorkAssistantWhenNotFound() {
        when(workAssistant.resolveResourceId()).thenReturn(null);
        assertThat(service.create(request()).getMembers())
            .extracting(ByaiSessionMember::getMemObjType).containsExactly("USER");
    }

    @Test
    void directInvitationRouteDelegatesToApplicationService() throws Exception {
        var application = mock(GroupChatApplicationService.class);
        var controller = new GroupChatController(
            application, mock(GroupChatContextService.class),
            mock(GroupChatTaskService.class),
            mock(GroupChatReadService.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        mvc.perform(MockMvcRequestBuilders.post("/group-chats/200/members")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"type\":\"USER\",\"id\":20}"))
            .andExpect(MockMvcResultMatchers.status().isOk());
        // 兼容旧客户端的单个 ID，但控制器统一委托批量入口。
        verify(application).inviteBatch(200L, "USER", List.of(20L));
        var invitations = mock(GroupChatInvitationService.class);
        ReflectionTestUtils.setField(controller, "invitationService", invitations);
        when(invitations.resolveSessionId("Ab1234CD")).thenReturn(200L);
        mvc.perform(MockMvcRequestBuilders.post("/group-chats/invitations/join")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"Ab1234CD\"}"))
            .andExpect(MockMvcResultMatchers.status().isOk());
        verify(application).acceptInvitation(200L, "Ab1234CD");
        mvc.perform(MockMvcRequestBuilders.post("/group-chats/200/members")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"Ab1234CD\"}"))
            .andExpect(MockMvcResultMatchers.status().isBadRequest());
    }

    @Test
    void directInvitationRouteDelegatesArraysInOneBatchForUsersAndAgents() throws Exception {
        var application = mock(GroupChatApplicationService.class);
        var controller = new GroupChatController(
            application, mock(GroupChatContextService.class),
            mock(GroupChatTaskService.class),
            mock(GroupChatReadService.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        // 与前端一致传字符串数组，两个成员类型都只调用一次批量服务。
        for (String type : List.of("USER", "AGENT")) {
            when(application.inviteBatch(200L, type, List.of(20L, 21L, 22L))).thenReturn(List.of());
            mvc.perform(MockMvcRequestBuilders.post("/group-chats/200/members")
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"type\":\"" + type + "\",\"id\":[\"20\",\"21\",\"22\"]}"))
                .andExpect(MockMvcResultMatchers.status().isOk())
                .andExpect(MockMvcResultMatchers.jsonPath("$.data").isArray());
            verify(application).inviteBatch(200L, type, List.of(20L, 21L, 22L));
        }
        verifyNoMoreInteractions(application);
    }

    @Test
    void legacyInvitationRoutesAreNotRegistered() throws Exception {
        var controller = new GroupChatController(
            service, mock(GroupChatContextService.class),
            mock(GroupChatTaskService.class),
            mock(GroupChatReadService.class));
        ReflectionTestUtils.setField(controller, "settingsService",
            mock(GroupChatSettingsService.class));
        var mvc = MockMvcBuilders.standaloneSetup(controller).build();
        for (String path : List.of("/200/invitation", "/200/join-requests/me", "/200/join-requests")) {
            mvc.perform(MockMvcRequestBuilders.get("/group-chats" + path))
                .andExpect(MockMvcResultMatchers.status().isNotFound());
        }
        for (String path : List.of("/200/join", "/join-by-number", "/200/join-requests/request/review")) {
            mvc.perform(MockMvcRequestBuilders.post("/group-chats" + path))
                .andExpect(MockMvcResultMatchers.status().is4xxClientError());
        }
        verifyNoInteractions(members, projectMembers);
    }

    @Test
    void missingListsStillIncludeCreatorAsOwner() {
        assertThat(service.create(request()).getMembers()).singleElement()
            .satisfies(member -> {
                assertThat(member.getMemObjId()).isEqualTo(10L);
                assertThat(member.getUserRole()).isEqualTo("OWNER");
            });
        verify(projectMembers).addMembers(100L, List.of(), "member");
    }

    @Test
    void rejectsMissingLoginBeforeCreatingProject() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.create(request())).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(projects, projectMembers, sessions, members);
    }

    @Test
    void projectFailureDoesNotWriteGroup() {
        doThrow(new IllegalArgumentException("duplicate project name")).when(projects).createProject(any());
        assertThatThrownBy(() -> service.create(request())).hasMessage("duplicate project name");
        verifyNoInteractions(projectMembers, sessions, members);
    }

    @Test
    void validatesNameAndMemberIdsAtRequestBoundary() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            GroupChatCreateRequest request = request();
            assertThat(validator.validate(request)).isEmpty();
            request.setName(" ");
            assertThat(validator.validate(request)).isNotEmpty();
            request.setName("群".repeat(101));
            assertThat(validator.validate(request)).isNotEmpty();
            request.setName("群");
            request.setUserIds(Arrays.asList(20L, null));
            assertThat(validator.validate(request)).isNotEmpty();
            request.setUserIds(List.of());
            request.setAgentIds(List.of(-1L));
            assertThat(validator.validate(request)).isNotEmpty();
        }
    }

    @Test
    void invitationAddsNewHumanToProjectAndInitializesReadCursor() {
        when(messages.selectLatestMessageId(200L)).thenReturn(199L);
        ByaiSessionMember member = service.invite(200L, "USER", 20L);
        verify(authorization).requireInvite(200L, "USER");
        verify(projectMembers).addMember(100L, 20L, "member");
        verify(members).save(member);
        assertThat(member.getLastReadMessageId()).isEqualTo(199L);
        assertThat(member.getLastReadTime()).isNotNull();
        assertThat(member.getUserRole()).isEqualTo("MEMBER");
    }

    @Test
    void existingProjectMemberKeepsProjectRole() {
        when(projectMembers.isMember(100L, 20L)).thenReturn(true);
        service.invite(200L, "USER", 20L);
        verify(projectMembers, never()).addMember(any(), any(), any());
        verify(members).save(any());
    }

    @Test
    void agentInvitationDoesNotCreateProjectMember() {
        service.invite(200L, "AGENT", 30L);
        verifyNoInteractions(projectMembers);
        verify(members).save(any());
    }

    @Test
    void duplicateGroupMemberDoesNotChangeProjectMembership() {
        when(members.findSessionMember(200L, "USER", 20L)).thenReturn(new ByaiSessionMember());
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("Member already exists");
        verifyNoInteractions(projectMembers);
        verify(members, never()).save(any());
    }

    @Test
    void unauthorizedInvitationDoesNotWriteAnything() {
        doThrow(new IllegalArgumentException("Admin required")).when(authorization).requireInvite(200L, "USER");
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("Admin required");
        verifyNoInteractions(projectMembers, members);
    }

    @Test
    void projectMemberFailureDoesNotInsertGroupMember() {
        when(projectMembers.addMember(100L, 20L, "member")).thenThrow(new IllegalStateException("insert failed"));
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("insert failed");
        verify(members, never()).save(any());
    }

    @Test
    void creationFailureRollsBackOuterJdbcTransaction() throws Exception {
        Connection connection = transactionalProxy();
        doAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            Project project = new Project();
            project.setProjectId(100L);
            project.setProjectName("协作群");
            return project;
        }).when(projects).createProject(any());
        doThrow(new IllegalStateException("group members failed")).when(members).batchSave(anyList());
        assertThatThrownBy(() -> service.create(request())).hasMessage("group members failed");
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void invitationFailureRollsBackProjectMemberTransaction() throws Exception {
        Connection connection = transactionalProxy();
        when(projectMembers.addMember(100L, 20L, "member")).thenAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue();
            return null;
        });
        doThrow(new IllegalStateException("group member failed")).when(members).save(any());
        assertThatThrownBy(() -> service.invite(200L, "USER", 20L)).hasMessage("group member failed");
        verify(connection).rollback();
        verify(connection, never()).commit();
    }

    @Test
    void successfulCreationCommitsJdbcTransaction() throws Exception {
        Connection connection = transactionalProxy();
        service.create(request());
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    /** 使用真实 Spring 事务拦截器和 JDBC 事务管理器验证外层事务边界，无需启动业务依赖。 */
    private Connection transactionalProxy() throws Exception {
        TransactionSynchronizationManager.clearSynchronization();
        DataSource dataSource = mock(DataSource.class);
        Connection connection = mock(Connection.class);
        when(dataSource.getConnection()).thenReturn(connection);
        when(connection.getAutoCommit()).thenReturn(true);
        TransactionInterceptor interceptor = new TransactionInterceptor();
        interceptor.setTransactionManager(new DataSourceTransactionManager(dataSource));
        interceptor.setTransactionAttributeSource(new AnnotationTransactionAttributeSource());
        ProxyFactory factory = new ProxyFactory(service);
        factory.setProxyTargetClass(true);
        factory.addAdvice(interceptor);
        service = (GroupChatApplicationService) factory.getProxy();
        return connection;
    }

    private GroupChatCreateRequest request() {
        GroupChatCreateRequest request = new GroupChatCreateRequest();
        request.setName(" 协作群 ");
        request.setGoal("整理需求并形成执行计划");
        return request;
    }
}
