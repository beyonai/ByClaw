package com.iwhalecloud.byai.state.application.service.dataset;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
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

    @BeforeEach
    void setUp() {
        service = new DatasetApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "feignPythonBuildService", feignPythonBuildService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
    }

    @Test
    void downloadsProjectCloudFileWithoutKnowledgeResourcePermissionCheck() throws Exception {
        SsResource resource = new SsResource();
        resource.setResourceId(9001L);
        resource.setResourceCode("project-cloud");
        when(ssResourceService.findById(9001L)).thenReturn(resource);
        when(feignPythonBuildService.fileDownload(any(KbFileDownload.class), eq(9001L)))
            .thenReturn(new ByteArrayInputStream("cloud content".getBytes(StandardCharsets.UTF_8)));

        MockHttpServletResponse response = new MockHttpServletResponse();
        service.downloadProjectCloudFile(9001L, "/联网搜索API.md", response);

        assertThat(response.getContentAsByteArray()).isEqualTo("cloud content".getBytes(StandardCharsets.UTF_8));
        verify(authApplicationService, never()).hasResourceAccessPermission(any());
    }
}
