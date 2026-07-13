package com.iwhalecloud.byai.state.application.service.dataset;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeFileSearch;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileSearchRequest;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationContext;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class DatasetApplicationServiceTest {

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private AuthApplicationService authApplicationService;

    @Mock
    private FeignPythonBuildService feignPythonBuildService;

    private DatasetApplicationService service;

    @BeforeAll
    static void initI18n() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("dataset.default.personal.delete.not.allowed", Locale.getDefault(),
            "dataset.default.personal.delete.not.allowed");
        ApplicationContext applicationContext = org.mockito.Mockito.mock(ApplicationContext.class);
        org.mockito.Mockito.when(applicationContext.getBean(org.springframework.context.MessageSource.class))
            .thenReturn(messageSource);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    @BeforeEach
    void setUp() {
        service = new DatasetApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "feignPythonBuildService", feignPythonBuildService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
    }

    @Test
    void createFolder_allowsDefaultPersonalDatasetWhenCurrentUserCanManage() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(feignPythonBuildService.createDirectory(any())).thenReturn(successResponse());

        Folder folder = new Folder();
        folder.setResourceId(100L);
        folder.setDirectoryName("reports");
        folder.setDirectoryPath("/2026");

        service.createFolder(folder);

        ArgumentCaptor<com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate> captor =
            ArgumentCaptor.forClass(com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate.class);
        verify(feignPythonBuildService).createDirectory(captor.capture());
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getDirectoryPath()).isEqualTo("/2026/reports");
    }

    @Test
    void deleteDataset_rejectsDefaultPersonalDataset() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThatThrownBy(() -> service.deleteDataset(100L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("dataset.default.personal.delete.not.allowed");

        verify(authApplicationService, never()).hasResourceManagePermission(any());
        verify(feignPythonBuildService, never()).deleteKnowledgeBase(any());
    }

    @Test
    void searchKnowledgeFiles_mapsResourceIdsToKnCodesAndBack() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);

        KnowledgeFileSearchItem item = new KnowledgeFileSearchItem();
        item.setKnCode("personal-kb");
        item.setFilePath("/hr/renewal.md");
        item.setScore(94.2D);
        item.setMetadata(Map.of("status", Map.of("valueType", "string", "value", "active")));
        KnowledgeFileSearchResult qaResult = new KnowledgeFileSearchResult();
        qaResult.setData(List.of(item));
        PythonBuildResponse<KnowledgeFileSearchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.searchKnowledgeFiles(any())).thenReturn(response);

        KnowledgeFileSearchRequest request = new KnowledgeFileSearchRequest();
        request.setResourceIdList(List.of(100L));
        request.setQuery("续签流程");
        request.setWhere(Map.of("eq", Map.of("fieldName", "status", "value", "active")));
        request.setMetadataFieldList(List.of("status", "tags"));
        request.setTopK(10);
        request.setSearchMode("mixedRecall");

        KnowledgeFileSearchResult result = service.searchKnowledgeFiles(request);

        ArgumentCaptor<KbKnowledgeFileSearch> captor = ArgumentCaptor.forClass(KbKnowledgeFileSearch.class);
        verify(feignPythonBuildService).searchKnowledgeFiles(captor.capture());
        assertThat(captor.getValue().getKnCodeList()).containsExactly("personal-kb");
        assertThat(captor.getValue().getWhere()).isEqualTo(request.getWhere());
        assertThat(captor.getValue().getMetadataFieldList()).containsExactly("status", "tags");
        assertThat(result.getData()).hasSize(1);
        assertThat(result.getData().get(0).getKnCode()).isEqualTo("100");
        assertThat(result.getData().get(0).getFilePath()).isEqualTo("/hr/renewal.md");
    }

    private SsResource defaultPersonalDataset() {
        SsResource resource = new SsResource();
        resource.setResourceId(100L);
        resource.setResourceCode("personal-kb");
        resource.setResourceName("Default personal knowledge base");
        resource.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        resource.setCreateBy(1L);
        return resource;
    }

    private PythonBuildResponse<Void> successResponse() {
        PythonBuildResponse<Void> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        return response;
    }
}
