package com.iwhalecloud.byai.state.application.service.dataset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.mock;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.springframework.context.support.StaticMessageSource;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import org.mockito.ArgumentCaptor;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;

@ExtendWith(MockitoExtension.class)
class DatasetApplicationServiceProjectCloudDownloadTest {

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private AuthApplicationService authApplicationService;

    @Mock
    private FeignPythonBuildService feignPythonBuildService;

    private DatasetApplicationService service;
    private Object originalMessageSource;

    @BeforeEach
    void setUp() {
        originalMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        service = new DatasetApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "feignPythonBuildService", feignPythonBuildService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
    }

    @AfterEach
    void restoreMessages() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }

    @Test
    void invitedTenantMemberCanListAndDownloadWithoutPlatformMembership() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserId(10000077L);
        login.setUserCode("member");
        CurrentUserHolder.setLoginInfo(login);
        Project project = new Project();
        project.setProjectId(11246210L);
        project.setEnterpriseId(11237409L);
        project.setCreateBy(10000118L);
        project.setDeleteFlag("0");
        project.setCloudResourceId(11246212L);
        SsResource cloud = new SsResource();
        cloud.setResourceId(11246212L);
        cloud.setResourceCode("project-cloud");
        cloud.setResourceBizType("KG_CLOUD");
        ProjectService projects = mock(ProjectService.class);
        ProjectMemberService members = mock(ProjectMemberService.class);
        TenantProjectCloudAccessService tenantCloud = mock(TenantProjectCloudAccessService.class);
        AuthApplicationService actualAuth = new AuthApplicationService();
        ReflectionTestUtils.setField(actualAuth, "projectService", projects);
        ReflectionTestUtils.setField(actualAuth, "projectMemberService", members);
        ReflectionTestUtils.setField(actualAuth, "tenantProjectCloudAccessService", tenantCloud);
        ReflectionTestUtils.setField(service, "authApplicationService", actualAuth);
        when(projects.findByCloudResourceId(11246212L)).thenReturn(List.of(project));
        when(tenantCloud.canRead(project)).thenReturn(true);
        when(ssResourceService.findById(11246212L)).thenReturn(cloud);
        PythonBuildResponse<Data> result = new PythonBuildResponse<>();
        result.setResultCode("0");
        result.setResultObject(new Data());
        when(feignPythonBuildService.listDir(any(KbListDir.class), eq(11246212L))).thenReturn(result);
        when(feignPythonBuildService.fileDownload(any(KbFileDownload.class), eq(11246212L)))
            .thenReturn(new ByteArrayInputStream(new byte[] { 42 }));
        DirAndFileQo request = new DirAndFileQo();
        request.setResourceId(11246212L);
        request.setDirectoryPath("/");

        assertThat(service.queryDirAndFileByLevel(request)).isEmpty();
        MockHttpServletResponse response = new MockHttpServletResponse();
        service.download(11246212L, "/file.md", response);
        assertThat(response.getContentAsByteArray()).containsExactly((byte) 42);

        when(tenantCloud.canRead(project)).thenReturn(false);
        assertThatThrownBy(() -> service.queryDirAndFileByLevel(request))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.access.denied");
        assertThatThrownBy(() -> service.download(11246212L, "/file.md", new MockHttpServletResponse()))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.access.denied");
        verify(feignPythonBuildService).listDir(any(KbListDir.class), eq(11246212L));
        verify(feignPythonBuildService).fileDownload(any(KbFileDownload.class), eq(11246212L));
        verifyNoInteractions(members);
    }

    @Test
    void downloadsProjectCloudFileThroughSharedReadPermissionCheck() throws Exception {
        SsResource resource = new SsResource();
        resource.setResourceId(9001L);
        resource.setResourceCode("project-cloud");
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(9001L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        when(feignPythonBuildService.fileDownload(any(KbFileDownload.class), eq(9001L)))
            .thenReturn(new ByteArrayInputStream("cloud content".getBytes(StandardCharsets.UTF_8)));

        MockHttpServletResponse response = new MockHttpServletResponse();
        service.download(9001L, "/联网搜索API.md", response);

        assertThat(response.getContentAsByteArray()).isEqualTo("cloud content".getBytes(StandardCharsets.UTF_8));
        verify(authApplicationService).hasResourceAccessPermission(resource);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"KG_CLOUD", "KG_DOC"})
    void directoryUsesSharedPermissionAndBoundKnowledgeCode(String resourceType) {
        SsResource resource = new SsResource();
        resource.setResourceId(9001L);
        resource.setResourceBizType(resourceType);
        resource.setResourceCode("project-cloud");
        when(ssResourceService.findById(9001L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        PythonBuildResponse<Data> result = new PythonBuildResponse<>();
        result.setResultCode("0");
        result.setResultObject(new Data());
        when(feignPythonBuildService.listDir(any(KbListDir.class), eq(9001L))).thenReturn(result);
        DirAndFileQo request = new DirAndFileQo();
        request.setResourceId(9001L);
        request.setResourceCode("another-project");
        request.setDirectoryPath("/");

        assertThat(service.queryDirAndFileByLevel(request)).isEmpty();

        verify(authApplicationService).hasResourceAccessPermission(resource);
        ArgumentCaptor<KbListDir> query = ArgumentCaptor.forClass(KbListDir.class);
        verify(feignPythonBuildService).listDir(query.capture(), eq(9001L));
        assertThat(query.getValue().getKnCode()).isEqualTo("project-cloud");
    }

    @Test
    void codeOnlyDirectoryQueryCannotBypassCloudPermission() {
        SsResource resource = new SsResource();
        resource.setResourceId(9001L);
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findByCode("project-cloud"))
            .thenReturn(List.of(resource));
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(false);
        DirAndFileQo request = new DirAndFileQo();
        request.setResourceCode("project-cloud");
        request.setDirectoryPath("/");

        assertThatThrownBy(() -> service.queryDirAndFileByLevel(request))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.access.denied");
        verifyNoInteractions(feignPythonBuildService);
    }

    @Test
    void deniedReadNeverListsOrDownloadsFromQa() {
        SsResource resource = new SsResource();
        resource.setResourceId(9001L);
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(9001L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(false);
        DirAndFileQo request = new DirAndFileQo();
        request.setResourceId(9001L);
        request.setDirectoryPath("/");

        assertThatThrownBy(() -> service.queryDirAndFileByLevel(request))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.access.denied");
        assertThatThrownBy(() -> service.download(9001L, "/file.md", new MockHttpServletResponse()))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.access.denied");
        verifyNoInteractions(feignPythonBuildService);
    }
}
