package com.iwhalecloud.byai.state.application.service.dataset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

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
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
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

    @Test
    void directoryUsesSharedPermissionAndBoundKnowledgeCode() {
        SsResource resource = new SsResource();
        resource.setResourceId(9001L);
        resource.setResourceBizType("KG_CLOUD");
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
        when(ssResourceService.findByCodeAndBizType("project-cloud", "KG_CLOUD"))
            .thenReturn(List.of(resource));
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(false);
        DirAndFileQo request = new DirAndFileQo();
        request.setResourceCode("project-cloud");
        request.setDirectoryPath("/");

        assertThatThrownBy(() -> service.queryDirAndFileByLevel(request))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("user.permission.nopermission");
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
            .isInstanceOf(IllegalArgumentException.class).hasMessage("user.permission.nopermission");
        assertThatThrownBy(() -> service.download(9001L, "/file.md", new MockHttpServletResponse()))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("user.permission.nopermission");
        verifyNoInteractions(feignPythonBuildService);
    }
}
