package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import java.util.Arrays;
import java.util.List;
import javax.sql.DataSource;

import jakarta.validation.Validation;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatDetailResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatCreationAndInvitationTest {
    private final ProjectApplicationService projects = mock(ProjectApplicationService.class);
    private final ProjectMemberService projectMembers = mock(ProjectMemberService.class);
    private final SessionService sessions = mock(SessionService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final GroupChatAuthorizationService authorization = mock(GroupChatAuthorizationService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private GroupChatApplicationService service;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(10L);
        CurrentUserHolder.setLoginInfo(login);
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(200L, 201L, 202L, 203L, 204L);
        service = new GroupChatApplicationService(sessions, sequence, authorization, members,
            projects, projectMembers, messages, mock(GroupChatExecutionCoordinator.class),
            mock(GroupChatEventPublisher.class), mock(SessionExtService.class));
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
        ArgumentCaptor<ProjectDTO> projectRequest = ArgumentCaptor.forClass(ProjectDTO.class);
        verify(projects).createProject(projectRequest.capture());
        assertThat(projectRequest.getValue().getProjectName()).isEqualTo(request.getName());
    }

    @Test
    void legacyInvitationRoutesAreNotRegistered() throws Exception {
        var controller = new com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController(
            service, mock(com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService.class),
            mock(com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService.class),
            mock(com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatReadService.class));
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "settingsService",
            mock(com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatSettingsService.class));
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        for (String path : List.of("/200/invitation", "/200/join-requests/me", "/200/join-requests")) {
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/group-chats" + path))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
        }
        for (String path : List.of("/200/join", "/200/members", "/join-by-number", "/200/join-requests/request/review")) {
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/group-chats" + path))
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().is4xxClientError());
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
    void successfulCreationCommitsJdbcTransaction() throws Exception {
        Connection connection = transactionalProxy();
        service.create(request());
        verify(connection).commit();
        verify(connection, never()).rollback();
    }

    /** 使用真实 Spring 事务拦截器和 JDBC 事务管理器验证外层事务边界，无需启动业务依赖。 */
    private Connection transactionalProxy() throws Exception {
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
        return request;
    }
}
