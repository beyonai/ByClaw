package com.iwhalecloud.byai.manager.domain.datasource;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.tenant.*;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class TenantSessionResourceAccessTest {
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final ByaiSessionMapper sessions = mock(ByaiSessionMapper.class);
    private final ProjectService projects = mock(ProjectService.class);
    private final DataSourceAccessService access = new DataSourceAccessService(projects,
        mock(ProjectMemberService.class), sessions, mock(SessionMemberService.class), node);

    @AfterEach
    void clear() {
        TenantRequestContextHolder.clear();
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void readsTenantTaskWithoutFallingBackToPersonalDatabase() {
        setup();
        when(node.request(any(), eq("GET"), eq("/internal/v1/sessions/50"), isNull(), any()))
            .thenReturn(new TenantNodeModels.SessionView("50", "task", "h_as", null, null, null, "123", "8", null));
        assertThat(access.requireSessionProject(50L)).isNull();
        verifyNoInteractions(sessions, projects);
    }

    @Test
    void rejectsMismatchedTenantRatherThanReturningAnEmptyResourcePage() {
        setup();
        when(node.request(any(), eq("GET"), anyString(), isNull(), any()))
            .thenReturn(new TenantNodeModels.SessionView("50", "task", "h_as", null, null, null, "123", "9", null));
        assertThatThrownBy(() -> access.requireSessionProject(50L)).isInstanceOf(BaseException.class);
        verifyNoInteractions(sessions, projects);
    }

    @Test
    void tenantSessionWithProjectStillRequiresPlatformProjectAccess() {
        setup();
        when(node.request(any(), eq("GET"), anyString(), isNull(), any()))
            .thenReturn(new TenantNodeModels.SessionView("50", "task", "h_as", null, null, null, "123", "8", "10"));
        var project = new com.iwhalecloud.byai.manager.entity.devloop.Project();
        project.setProjectId(10L);
        project.setCreateBy(123L);
        when(projects.findById(10L)).thenReturn(project);
        assertThat(access.requireSessionProject(50L)).isSameAs(project);
        project.setCreateBy(456L);
        assertThatThrownBy(() -> access.requireSessionProject(50L)).isInstanceOf(BaseException.class);
        verifyNoInteractions(sessions);
    }

    @Test
    void preservesNodeAuthorizationFailure() {
        setup();
        when(node.request(any(), eq("GET"), anyString(), isNull(), any()))
            .thenThrow(new BaseException(403, "denied"));
        assertThatThrownBy(() -> access.requireSessionProject(50L)).isInstanceOf(BaseException.class);
        verifyNoInteractions(sessions, projects);
    }

    private void setup() {
        LoginInfo login = new LoginInfo();
        login.setUserId(123L);
        CurrentUserHolder.setLoginInfo(login);
        TenantRequestContextHolder.set(new TenantRequestContext(123L, 8L, "OWNER"));
    }
}
