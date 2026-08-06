package com.iwhalecloud.byai.state.application.service.dataset;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbBuildResult;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileMetadataGet;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbGlob;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeFileSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemReferences;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemsMove;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeSearch;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileMetadataResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileUpdateResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemReferencesResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemsMoveResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBuildResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeBuildResultRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileMetadataRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeGlobRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemReferencesRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemsMoveRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
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
import org.springframework.mock.web.MockMultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
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
        when(feignPythonBuildService.createDirectory(any(), eq(100L))).thenReturn(successResponse());

        Folder folder = new Folder();
        folder.setResourceId(100L);
        folder.setDirectoryName("reports");
        folder.setDirectoryPath("/2026");

        service.createFolder(folder);

        ArgumentCaptor<com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate> captor =
            ArgumentCaptor.forClass(com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate.class);
        verify(feignPythonBuildService).createDirectory(captor.capture(), eq(100L));
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

    @Test
    void buildResult_mapsResourceIdToKnCodeAndBack() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);

        KnowledgeBuildResult qaResult = new KnowledgeBuildResult();
        qaResult.setKnCode("personal-kb");
        qaResult.setFilePath("/slides/demo.pptx");
        KnowledgeBuildResult.BuildInfo buildInfo = new KnowledgeBuildResult.BuildInfo();
        buildInfo.setStatus("complete");
        qaResult.setBuild(buildInfo);
        PythonBuildResponse<KnowledgeBuildResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.buildResult(any(), eq(100L))).thenReturn(response);

        KnowledgeBuildResultRequest request = new KnowledgeBuildResultRequest();
        request.setResourceId(100L);
        request.setFilePath("slides/demo.pptx");
        request.setChunkPage(2);
        request.setChunkPageSize(10);
        request.setIncludeMarkdown(false);

        KnowledgeBuildResult result = service.buildResult(request);

        ArgumentCaptor<KbBuildResult> captor = ArgumentCaptor.forClass(KbBuildResult.class);
        verify(feignPythonBuildService).buildResult(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/slides/demo.pptx");
        assertThat(captor.getValue().getChunkPage()).isEqualTo(2);
        assertThat(captor.getValue().getChunkPageSize()).isEqualTo(10);
        assertThat(captor.getValue().getIncludeMarkdown()).isFalse();
        assertThat(result.getKnCode()).isEqualTo("100");
        assertThat(result.getBuild().getStatus()).isEqualTo("complete");
    }

    @Test
    void moveKnowledgeItems_mapsResourceIdToKnCodeAndReturnsBatchResult() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);

        KnowledgeItemsMoveResult qaResult = new KnowledgeItemsMoveResult();
        KnowledgeItemsMoveResult.Summary summary = new KnowledgeItemsMoveResult.Summary();
        summary.setTotal(2);
        summary.setSucceeded(1);
        summary.setFailed(1);
        qaResult.setSummary(summary);
        PythonBuildResponse<KnowledgeItemsMoveResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.moveKnowledgeItems(any(), eq(100L))).thenReturn(response);

        KnowledgeItemsMoveRequest request = new KnowledgeItemsMoveRequest();
        request.setResourceId(100L);
        request.setSourcePath(List.of("/制度/考勤.pdf", "/制度/图片"));
        request.setTargetDirectoryPath("/归档/人事");

        KnowledgeItemsMoveResult result = service.moveKnowledgeItems(request);

        ArgumentCaptor<KbKnowledgeItemsMove> captor = ArgumentCaptor.forClass(KbKnowledgeItemsMove.class);
        verify(feignPythonBuildService).moveKnowledgeItems(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getSourcePath()).containsExactly("/制度/考勤.pdf", "/制度/图片");
        assertThat(captor.getValue().getTargetDirectoryPath()).isEqualTo("/归档/人事");
        assertThat(captor.getValue().getTargetFilePath()).isNull();
        assertThat(captor.getValue().getOverwrite()).isFalse();
        assertThat(result.getSummary().getSucceeded()).isEqualTo(1);
        assertThat(result.getSummary().getFailed()).isEqualTo(1);
    }

    @Test
    void uploadFiles_usesDirectoryForZipAndKeepsPartialFailuresOutOfSuccessfulItems() throws Exception {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);

        KbImportResult.Item succeeded = new KbImportResult.Item();
        succeeded.setFilePath("/制度/考勤.md");
        succeeded.setSuccess(true);
        KbImportResult.Item failed = new KbImportResult.Item();
        failed.setFilePath("/制度/escape.md");
        failed.setSuccess(false);
        failed.setError("unsafe path");
        KbImportResult qaResult = new KbImportResult();
        qaResult.setData(List.of(succeeded, failed));
        qaResult.setPostProcessErrors(List.of("reference compensation failed"));
        PythonBuildResponse<KbImportResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.importKnowledgeItem(any(), eq(100L))).thenReturn(response);

        MockMultipartFile zip = new MockMultipartFile("files", "制度.zip", "application/zip",
            new byte[] {1, 2, 3});
        UploadResult result = service.uploadFiles(new MockMultipartFile[] {zip}, 100L, "/制度", null, null, false);

        ArgumentCaptor<KbFileImport> captor = ArgumentCaptor.forClass(KbFileImport.class);
        verify(feignPythonBuildService).importKnowledgeItem(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/制度");
        assertThat(captor.getValue().getProcessFrontMatter()).isNull();
        assertThat(result.getUploadItems()).extracting("filePath").containsExactly("/制度/考勤.md");
        assertThat(result.getFailedItems()).extracting("filePath").containsExactly("/制度/escape.md");
        assertThat(result.getSummary().getTotal()).isEqualTo(2);
        assertThat(result.getSummary().getSucceeded()).isEqualTo(1);
        assertThat(result.getSummary().getFailed()).isEqualTo(1);
        assertThat(result.getPostProcessErrors()).containsExactly("reference compensation failed");
    }

    @Test
    void updateKnowledgeFile_mapsResourceIdToKnCodeAndReturnsResourceId() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);

        KbFileUpdateResult.Item item = new KbFileUpdateResult.Item();
        item.setKnCode("personal-kb");
        item.setFilePath("/制度/请假.md");
        item.setSuccess(true);
        KbFileUpdateResult qaResult = new KbFileUpdateResult();
        qaResult.setData(List.of(item));
        PythonBuildResponse<KbFileUpdateResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.updateKnowledgeItem(any(), eq(100L))).thenReturn(response);

        MockMultipartFile file = new MockMultipartFile("fileContent", "请假.md", "text/markdown",
            "# 请假制度".getBytes());
        KbFileUpdateResult result = service.updateKnowledgeFile(100L, "制度/请假.md", "", true, file);

        ArgumentCaptor<KbFileUpdate> captor = ArgumentCaptor.forClass(KbFileUpdate.class);
        verify(feignPythonBuildService).updateKnowledgeItem(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/制度/请假.md");
        assertThat(captor.getValue().getFileDescription()).isEmpty();
        assertThat(captor.getValue().getProcessFrontMatter()).isTrue();
        assertThat(captor.getValue().getMultipartFile()).isSameAs(file);
        assertThat(result.getData()).singleElement().satisfies(updated -> {
            assertThat(updated.getKnCode()).isEqualTo("100");
            assertThat(updated.getFilePath()).isEqualTo("/制度/请假.md");
            assertThat(updated.getSuccess()).isTrue();
        });
    }

    @Test
    void getKnowledgeFileMetadata_mapsResourceIdToKnCodeAndPreservesMetadataValues() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);

        KbFileMetadataResult.MetadataValue subject = new KbFileMetadataResult.MetadataValue();
        subject.setValueType("string");
        subject.setValue("DataCloud平台需求确认会");
        KbFileMetadataResult.MetadataValue date = new KbFileMetadataResult.MetadataValue();
        date.setValueType("datetime");
        date.setValue("2026-05-25T00:00:00");
        KbFileMetadataResult qaResult = new KbFileMetadataResult();
        qaResult.setMetadata(Map.of("会议主题", subject, "会议日期", date));
        PythonBuildResponse<KbFileMetadataResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.getKnowledgeFileMetadata(any(), eq(100L))).thenReturn(response);

        KnowledgeFileMetadataRequest request = new KnowledgeFileMetadataRequest();
        request.setResourceId(100L);
        request.setFilePath("会议纪要/DataCloud平台需求确认会.md");
        request.setMetadataFieldList(List.of("会议主题", "会议日期"));

        KbFileMetadataResult result = service.getKnowledgeFileMetadata(request);

        ArgumentCaptor<KbFileMetadataGet> captor = ArgumentCaptor.forClass(KbFileMetadataGet.class);
        verify(feignPythonBuildService).getKnowledgeFileMetadata(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/会议纪要/DataCloud平台需求确认会.md");
        assertThat(captor.getValue().getMetadataFieldList()).containsExactly("会议主题", "会议日期");
        assertThat(result.getMetadata()).containsEntry("会议主题", subject).containsEntry("会议日期", date);
    }

    @Test
    void searchKnowledgeItems_forwardsLatestFilteringFields() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        PythonBuildResponse<KnowledgeSearchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(new KnowledgeSearchResult());
        when(feignPythonBuildService.searchKnowledgeItems(any())).thenReturn(response);

        KnowledgeSearchRequest request = new KnowledgeSearchRequest();
        request.setResourceIdList(List.of(100L));
        request.setQuery("请假流程");
        request.setTopK(5);
        request.setSearchMode("mixedRecall");
        request.setWhere(Map.of("in", Map.of("fieldName", "fileType", "value", List.of("pdf"))));
        request.setMetadataFieldList(List.of("owner", "status"));
        request.setFileTypeList(List.of("pdf"));

        service.searchKnowledgeItems(request);

        ArgumentCaptor<KbKnowledgeSearch> captor = ArgumentCaptor.forClass(KbKnowledgeSearch.class);
        verify(feignPythonBuildService).searchKnowledgeItems(captor.capture());
        assertThat(captor.getValue().getKnCodeList()).containsExactly("personal-kb");
        assertThat(captor.getValue().getWhere()).isEqualTo(request.getWhere());
        assertThat(captor.getValue().getMetadataFieldList()).containsExactly("owner", "status");
        assertThat(captor.getValue().getFileTypeList()).containsExactly("pdf");
    }

    @Test
    void knowledgeItemReferences_mapsResourceIdAndDefaultsDirection() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        PythonBuildResponse<KnowledgeItemReferencesResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(new KnowledgeItemReferencesResult());
        when(feignPythonBuildService.knowledgeItemReferences(any(), eq(100L))).thenReturn(response);

        KnowledgeItemReferencesRequest request = new KnowledgeItemReferencesRequest();
        request.setResourceId(100L);
        request.setFilePath("/制度/请假.md");
        service.knowledgeItemReferences(request);

        ArgumentCaptor<KbKnowledgeItemReferences> captor = ArgumentCaptor.forClass(KbKnowledgeItemReferences.class);
        verify(feignPythonBuildService).knowledgeItemReferences(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/制度/请假.md");
        assertThat(captor.getValue().getDirection()).isEqualTo("inbound");
    }

    @Test
    void globKnowledgeItems_preservesQaFileSize() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        DirOrFile file = new DirOrFile();
        file.setName("/制度/人事/请假.pdf");
        file.setType("file");
        file.setSize(245760L);
        Data qaResult = new Data();
        qaResult.setData(List.of(file));
        PythonBuildResponse<Data> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.glob(any(), eq(100L))).thenReturn(response);

        KnowledgeGlobRequest request = new KnowledgeGlobRequest();
        request.setResourceId(100L);
        request.setPathRule("/制度/*/*.pdf");
        var result = service.globKnowledgeItems(request);

        ArgumentCaptor<KbGlob> captor = ArgumentCaptor.forClass(KbGlob.class);
        verify(feignPythonBuildService).glob(captor.capture(), eq(100L));
        assertThat(captor.getValue().getPathRule()).isEqualTo("/制度/*/*.pdf");
        assertThat(result).singleElement().satisfies(item -> {
            assertThat(item.getDirectoryPath()).isEqualTo("/制度/人事/请假.pdf");
            assertThat(item.getSize()).isEqualTo(245760L);
        });
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
