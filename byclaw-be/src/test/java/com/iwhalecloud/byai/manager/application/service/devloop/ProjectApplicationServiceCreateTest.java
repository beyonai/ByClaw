package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.Locale;

import org.springframework.web.multipart.MultipartFile;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.project.ProjectInitService;
import com.iwhalecloud.byai.manager.application.service.project.ProjectWorkspaceManifestService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectResourceService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

@ExtendWith(MockitoExtension.class)
class ProjectApplicationServiceCreateTest {

    @Mock
    private ProjectService projectService;

    @Mock
    private SequenceService sequenceService;

    @Mock
    private ProjectRepoMapper projectRepoMapper;

    @Mock
    private ProjectResourceService projectResourceService;

    @Mock
    private ProjectMemberService projectMemberService;

    @Mock
    private ProjectInitService projectInitService;

    @Mock
    private ProjectWorkspaceManifestService projectWorkspaceManifestService;

    @Mock
    private DatasetApplicationService datasetApplicationService;

    private Object originalMessageSource;

    @BeforeEach
    void setCurrentUser() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(88L);
        CurrentUserHolder.setLoginInfo(loginInfo);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        originalMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("project.cloud.resource.name", Locale.SIMPLIFIED_CHINESE, "{0} cloud");
        messageSource.addMessage("project.cloud.resource.desc", Locale.SIMPLIFIED_CHINESE, "{0} cloud desc");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
        LocaleContextHolder.resetLocaleContext();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }

    @Test
    void initializesWorkspaceAfterCreatingProject() throws IOException {
        ProjectApplicationService service = service();
        Project persistedProject = new Project();
        persistedProject.setProjectId(1001L);
        when(sequenceService.nextVal()).thenReturn(1001L);
        when(projectService.findById(1001L)).thenReturn(persistedProject);
        stubCreateCloudResource();
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("workspace");

        service.createProject(dto);

        verify(projectInitService).initProjectWorkspace(1001L);
        verify(projectWorkspaceManifestService).syncProjectGitmodules(1001L);
        verify(datasetApplicationService).createDataset(any());
        verify(datasetApplicationService).uploadFiles(any(MultipartFile[].class), anyLong(), anyString(), eq("init"),
            anyBoolean(), anyBoolean(), anyBoolean(), anyMap());
    }

    @Test
    void propagatesWorkspaceInitializationFailure() throws IOException {
        ProjectApplicationService service = service();
        Project persistedProject = new Project();
        persistedProject.setProjectId(1001L);
        when(sequenceService.nextVal()).thenReturn(1001L);
        when(projectService.findById(1001L)).thenReturn(persistedProject);
        stubCreateCloudResource();
        when(projectInitService.initProjectWorkspace(1001L))
            .thenThrow(new IllegalStateException("workspace unavailable"));
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("workspace");

        assertThatThrownBy(() -> service.createProject(dto))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("workspace unavailable");
    }

    @Test
    void createsProjectWithinTransaction() throws NoSuchMethodException {
        Method createProject = ProjectApplicationService.class.getDeclaredMethod("createProject", ProjectDTO.class);

        Transactional transactional = AnnotatedElementUtils.findMergedAnnotation(createProject, Transactional.class);

        assertThat(transactional).isNotNull();
    }

    @Test
    void getsProjectWorkspacePathFromProjectInitializationService() {
        ProjectApplicationService service = service();
        Path workspace = Path.of("/tmp/byclaw-storage/projects/1001");
        when(projectInitService.initProjectWorkspace(1001L)).thenReturn(workspace);

        Path result = service.getProjectWorkspacePath(1001L);

        assertThat(result).isEqualTo(workspace);
        verify(projectInitService).initProjectWorkspace(1001L);
    }

    private void stubCreateCloudResource() throws IOException {
        SsResource cloudResource = new SsResource();
        cloudResource.setResourceId(9001L);
        when(datasetApplicationService.createDataset(any())).thenReturn(cloudResource);
        when(datasetApplicationService.uploadFiles(any(MultipartFile[].class), anyLong(), anyString(), eq("init"),
            anyBoolean(), anyBoolean(), anyBoolean(), anyMap())).thenReturn(null);
    }

    private ProjectApplicationService service() {
        ProjectApplicationService service = new ProjectApplicationService();
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
        ReflectionTestUtils.setField(service, "projectResourceService", projectResourceService);
        ReflectionTestUtils.setField(service, "projectMemberService", projectMemberService);
        ReflectionTestUtils.setField(service, "projectInitService", projectInitService);
        ReflectionTestUtils.setField(service, "projectWorkspaceManifestService", projectWorkspaceManifestService);
        ReflectionTestUtils.setField(service, "datasetApplicationService", datasetApplicationService);
        return service;
    }
}
