package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.nio.file.Path;
import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.core.annotation.AnnotatedElementUtils;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.Transactional;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.project.ProjectInitService;
import com.iwhalecloud.byai.manager.application.service.project.ProjectWorkspaceManifestService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectResourceService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.devloop.service.WorkgroupNameService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
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
    private WorkgroupNameService workgroupNames;

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
        TenantRequestContextHolder.clear();
        LocaleContextHolder.resetLocaleContext();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }

    @Test
    void initializesWorkspaceAfterCreatingProject() {
        ProjectApplicationService service = service();
        Project persistedProject = new Project();
        persistedProject.setProjectId(1001L);
        when(sequenceService.nextVal()).thenReturn(1001L);
        when(projectService.findById(1001L)).thenReturn(persistedProject);
        stubCreateCloudResource();
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("workspace");

        Project result = service.createProject(dto);

        assertThat(result.getProjectType()).isEqualTo("normal");
        verify(projectService).existsProjectName("workspace", 88L, 1L, null);
        verify(projectInitService).initProjectWorkspace(1001L);
        verify(projectWorkspaceManifestService).syncProjectGitmodules(1001L);
        verify(datasetApplicationService).createDataset(any());
    }

    @Test
    void rejectsDuplicateNamesWithinCurrentUsersProjectsBeforeSaving() {
        when(projectService.existsProjectName("workspace", 88L, 1L, null)).thenReturn(true);
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName(" workspace ");

        assertThatThrownBy(() -> service().createProject(dto)).isInstanceOf(BaseException.class);

        verify(projectService, never()).save(any());
    }

    @Test
    void checksOriginalCreatorWhenUpdatingAProject() {
        Project project = new Project();
        project.setProjectId(1001L);
        project.setCreateBy(99L);
        project.setEnterpriseId(10L);
        project.setCloudResourceId(9001L);
        when(projectService.findById(1001L)).thenReturn(project);
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectId(1001L);
        dto.setProjectName(" renamed workspace ");

        service().updateProject(dto);

        verify(projectService).existsProjectName("renamed workspace", 99L, 10L, 1001L);
        verify(projectService).update(project);
        assertThat(project.getProjectName()).isEqualTo("renamed workspace");
    }

    @Test
    void allowsEditingARecreatedProjectWhenItsUnchangedNameAlsoBelongsToHistory() {
        Project project = new Project();
        project.setProjectId(1002L);
        project.setCreateBy(88L);
        project.setEnterpriseId(10L);
        project.setProjectName("Team");
        project.setProjectType("hacu");
        project.setCloudResourceId(9001L);
        when(projectService.findById(1002L)).thenReturn(project);
        org.mockito.Mockito.lenient().when(projectService.existsProjectName("Team", 88L, 10L, 1002L))
            .thenReturn(true);
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectId(1002L);
        dto.setProjectName(" Team ");
        dto.setDescription("updated goal");

        service().updateProject(dto);

        assertThat(project.getProjectName()).isEqualTo("Team");
        assertThat(project.getDescription()).isEqualTo("updated goal");
        verify(projectService).update(project);
        verify(projectService, never()).existsProjectName("Team", 88L, 10L, 1002L);
    }

    @Test
    void createsGroupChatProjectWithHacuType() {
        ProjectApplicationService service = service();
        when(sequenceService.nextVal()).thenReturn(1001L);
        Project persistedProject = new Project();
        persistedProject.setProjectId(1001L);
        when(projectService.findById(1001L)).thenReturn(persistedProject);
        stubCreateCloudResource();
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("group workspace");

        Project result = service.createGroupChatProject(dto);

        ArgumentCaptor<Project> savedProject = ArgumentCaptor.forClass(Project.class);
        verify(projectService).save(savedProject.capture());
        assertThat(savedProject.getValue().getProjectType()).isEqualTo("hacu");
        assertThat(result.getProjectType()).isEqualTo("hacu");
        verify(projectInitService).initProjectWorkspace(1001L);
    }

    @Test
    void recreatesGroupProjectWithoutChangingTheHistoricalProject() {
        // The old generic check sees the retained HACU project; workgroup availability must use group lifecycle.
        org.mockito.Mockito.lenient().when(projectService.existsProjectName("group workspace", 88L, 1L, null))
            .thenReturn(true);
        when(sequenceService.nextVal()).thenReturn(1002L);
        Project persisted = new Project();
        persisted.setProjectId(1002L);
        when(projectService.findById(1002L)).thenReturn(persisted);
        stubCreateCloudResource();
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("group workspace");

        Project result = service().createGroupChatProject(dto);

        assertThat(result.getProjectId()).isEqualTo(1002L);
        verify(projectService).save(result);
        verify(projectService).existsNonWorkgroupProjectName("group workspace", 88L, 1L);
        verify(workgroupNames).exists("group workspace", 88L, 1L);
        verify(projectService, never()).update(org.mockito.ArgumentMatchers.argThat(p -> Long.valueOf(1001L).equals(p.getProjectId())));
    }

    @Test
    void rejectsAnActiveSameNameWorkgroupBeforeCreatingAnyProject() {
        when(workgroupNames.exists("group workspace", 88L, 1L)).thenReturn(true);
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName(" group workspace ");

        assertThatThrownBy(() -> service().createGroupChatProject(dto)).isInstanceOf(BaseException.class);

        verify(projectService, never()).save(any());
        verify(datasetApplicationService, never()).createDataset(any());
    }

    @Test
    void keepsOrdinaryProjectNameConflictsWhenCreatingWorkgroups() {
        when(projectService.existsNonWorkgroupProjectName("workspace", 88L, 1L)).thenReturn(true);
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("workspace");

        assertThatThrownBy(() -> service().createGroupChatProject(dto)).isInstanceOf(BaseException.class);

        verify(projectService, never()).save(any());
        org.mockito.Mockito.verifyNoInteractions(workgroupNames);
    }

    @Test
    void usesTheSelectedTenantForNameChecksAndProjectOwnership() {
        TenantRequestContextHolder.set(new TenantRequestContext(88L, 10L, "OWNER"));
        when(sequenceService.nextVal()).thenReturn(1002L);
        Project persisted = new Project();
        persisted.setProjectId(1002L);
        when(projectService.findById(1002L)).thenReturn(persisted);
        stubCreateCloudResource();
        ProjectDTO dto = new ProjectDTO();
        dto.setProjectName("group workspace");

        Project result = service().createGroupChatProject(dto);

        assertThat(result.getEnterpriseId()).isEqualTo(10L);
        verify(workgroupNames).exists("group workspace", 88L, 10L);
        verify(projectService).existsNonWorkgroupProjectName("group workspace", 88L, 10L);
    }

    @Test
    void propagatesWorkspaceInitializationFailure() {
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

    @Test
    void derivesGithubCloneUrlWhenOnlyRepositoryFullNameIsProvided() throws Exception {
        Method method = ProjectApplicationService.class.getDeclaredMethod(
            "normalizeRepoUrl", String.class, String.class, String.class);
        method.setAccessible(true);

        Object derived = method.invoke(null, null, "beyonai/customer-leads", "github");
        Object explicit = method.invoke(null, "https://github.example/customer-leads.git",
            "beyonai/customer-leads", "github");
        Object nonGithub = method.invoke(null, null, "group/customer-leads", "gitlab");

        assertThat(derived).isEqualTo("https://github.com/beyonai/customer-leads.git");
        assertThat(explicit).isEqualTo("https://github.example/customer-leads.git");
        assertThat(nonGithub).isNull();
    }

    private void stubCreateCloudResource() {
        SsResource cloudResource = new SsResource();
        cloudResource.setResourceId(9001L);
        when(datasetApplicationService.createDataset(any())).thenReturn(cloudResource);
    }

    private ProjectApplicationService service() {
        ProjectApplicationService service = new ProjectApplicationService();
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "workgroupNames", workgroupNames);
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
