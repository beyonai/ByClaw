package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import jakarta.servlet.http.HttpServletResponse;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;

@ExtendWith(MockitoExtension.class)
class ProjectApplicationServiceCloudDownloadTest {

    private static final Long PROJECT_ID = 7L;
    private static final Long CURRENT_USER_ID = 88L;
    private static final Long CLOUD_RESOURCE_ID = 9001L;

    @Mock
    private ProjectService projectService;

    @Mock
    private ProjectMemberService projectMemberService;

    @Mock
    private DatasetApplicationService datasetApplicationService;

    @BeforeEach
    void setCurrentUser() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(CURRENT_USER_ID);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void downloadsCloudFileForProjectMember() {
        Project project = project();
        when(projectService.findById(PROJECT_ID)).thenReturn(project);
        when(projectMemberService.isMember(PROJECT_ID, CURRENT_USER_ID)).thenReturn(true);
        HttpServletResponse response = mock(HttpServletResponse.class);

        service().downloadProjectCloudFile(PROJECT_ID, "/联网搜索API.md", response);

        verify(datasetApplicationService).downloadProjectCloudFile(CLOUD_RESOURCE_ID, "/联网搜索API.md", response);
    }

    @Test
    void rejectsProjectCloudDownloadForNonMember() {
        when(projectService.findById(PROJECT_ID)).thenReturn(project());
        when(projectMemberService.isMember(PROJECT_ID, CURRENT_USER_ID)).thenReturn(false);
        HttpServletResponse response = mock(HttpServletResponse.class);

        assertThatThrownBy(() -> service().downloadProjectCloudFile(PROJECT_ID, "/联网搜索API.md", response))
            .isInstanceOf(BaseException.class);

        verifyNoInteractions(datasetApplicationService);
    }

    @Test
    void allowsProjectCreatorWithoutMemberLookup() {
        Project project = project();
        project.setCreateBy(CURRENT_USER_ID);
        when(projectService.findById(PROJECT_ID)).thenReturn(project);
        HttpServletResponse response = mock(HttpServletResponse.class);

        service().downloadProjectCloudFile(PROJECT_ID, "/联网搜索API.md", response);

        verify(datasetApplicationService).downloadProjectCloudFile(CLOUD_RESOURCE_ID, "/联网搜索API.md", response);
        verify(projectMemberService, never()).isMember(PROJECT_ID, CURRENT_USER_ID);
    }

    private Project project() {
        Project project = new Project();
        project.setProjectId(PROJECT_ID);
        project.setProjectType("normal");
        project.setCreateBy(99L);
        project.setCloudResourceId(CLOUD_RESOURCE_ID);
        project.setDeleteFlag(DeleteFlag.NORMAL);
        return project;
    }

    private ProjectApplicationService service() {
        ProjectApplicationService service = new ProjectApplicationService();
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "projectMemberService", projectMemberService);
        ReflectionTestUtils.setField(service, "datasetApplicationService", datasetApplicationService);
        return service;
    }
}
