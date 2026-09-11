package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import org.junit.jupiter.api.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DataSourceAccessServiceTest {
    private final ProjectService projects = mock(ProjectService.class);
    private final ProjectMemberService members = mock(ProjectMemberService.class);
    private final ByaiSessionMapper sessions = mock(ByaiSessionMapper.class);
    private final SessionMemberService sessionMembers = mock(SessionMemberService.class);
    private final DataSourceAccessService access = new DataSourceAccessService(projects, members, sessions, sessionMembers);
    private Project project;

    @BeforeEach
    void setup() {
        LoginInfo login = new LoginInfo();
        login.setUserId(7L);
        CurrentUserHolder.setLoginInfo(login);
        project = new Project();
        project.setProjectId(10L);
        project.setCreateBy(8L);
        project.setDeleteFlag("0");
        when(projects.findById(10L)).thenReturn(project);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void anonymousCallerCannotAccessEvenKnownProject() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> access.requireProject(10L, false)).isInstanceOf(BaseException.class);
        verifyNoInteractions(projects, members);
    }

    @Test
    void memberCanReadButOnlyOwnerCanManageBindings() {
        when(members.isMember(10L, 7L)).thenReturn(true);
        assertThat(access.requireProject(10L, false)).isSameAs(project);
        assertThatThrownBy(() -> access.requireProject(10L, true)).isInstanceOf(BaseException.class);
        project.setCreateBy(7L);
        assertThat(access.requireProject(10L, true)).isSameAs(project);
    }

    @Test
    void strangerAndDeletedProjectAreDenied() {
        assertThatThrownBy(() -> access.requireProject(10L, false)).isInstanceOf(BaseException.class);
        project.setCreateBy(7L);
        project.setDeleteFlag("1");
        assertThatThrownBy(() -> access.requireProject(10L, false)).isInstanceOf(BaseException.class);
    }

    @Test
    void projectOwnerCannotUseUnrelatedSessionId() {
        project.setCreateBy(7L);
        session(8L, 10L);
        assertThatThrownBy(() -> access.requireSessionProject(50L)).isInstanceOf(BaseException.class);
        verifyNoInteractions(projects);
    }

    @Test
    void sessionOwnerStillNeedsProjectVisibility() {
        session(7L, 10L);
        assertThatThrownBy(() -> access.requireSessionProject(50L)).isInstanceOf(BaseException.class);
        when(members.isMember(10L, 7L)).thenReturn(true);
        assertThat(access.requireSessionProject(50L)).isSameAs(project);
    }

    @Test
    void sessionMemberWithProjectMembershipCanReadResources() {
        session(8L, 10L);
        when(sessionMembers.findSessionMember(50L, "USER", 7L)).thenReturn(new ByaiSessionMember());
        when(members.isMember(10L, 7L)).thenReturn(true);
        assertThat(access.requireSessionProject(50L)).isSameAs(project);
    }

    @Test
    void unknownSessionAndSessionWithoutProjectFailClearly() {
        assertThatThrownBy(() -> access.requireSessionProject(51L)).isInstanceOf(BaseException.class);
        session(7L, null);
        assertThatThrownBy(() -> access.requireSessionProject(50L)).isInstanceOf(BaseException.class);
    }

    private void session(Long creator, Long projectId) {
        ByaiSession session = new ByaiSession();
        session.setCreatorId(creator);
        session.setProjectId(projectId);
        when(sessions.selectById(50L)).thenReturn(session);
    }
}
