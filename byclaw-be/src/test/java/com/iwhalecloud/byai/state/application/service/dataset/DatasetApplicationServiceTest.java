package com.iwhalecloud.byai.state.application.service.dataset;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.knowledge.Folder;
import com.iwhalecloud.byai.common.feign.request.knowledge.FolderDelete;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileRenameRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeUploadConflictCheckRequest;
import com.iwhalecloud.byai.manager.dto.resource.RemoveFileDto;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileToMarkdownIndex;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbBuildResult;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileRead;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileMetadataGet;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileMetadataUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbEntityDiscovery;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbEntityEnrich;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbGlob;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeFileSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeMetadataSearch;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemReferences;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeItemsMove;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeSearch;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileReadResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileMetadataResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbFileUpdateResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeFileSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemReferencesResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeEntityBatchResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeItemsMoveResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBuildResult;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeSearchResult;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeMetadataSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeBuildResultRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeReadFileRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileMetadataRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileMetadataUpdateRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeEntityDiscoveryRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeEntityEnrichRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeGlobRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemReferencesRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeItemsMoveRequest;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;

import java.util.*;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.mock.web.MockMultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
@DisabledOnOs(OS.WINDOWS)
@ExtendWith(MockitoExtension.class)
class DatasetApplicationServiceTest {

    private static final Locale TEST_LOCALE = new Locale("zh", "CN");

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
        messageSource.addMessage("dataset.default.personal.delete.not.allowed", TEST_LOCALE,
            "dataset.default.personal.delete.not.allowed");
        messageSource.addMessage("dataset.metadata.search.resource.id.list.notempty", TEST_LOCALE,
            "Knowledge base resource identifier list cannot be empty");
        messageSource.addMessage("dataset.metadata.search.resource.id.notnull", TEST_LOCALE,
            "Knowledge base resource identifier cannot be empty");
        messageSource.addMessage("dataset.metadata.search.operation", TEST_LOCALE,
            "Search knowledge base file metadata");
        messageSource.addMessage("dataset.pythonbuild.operation.failed", TEST_LOCALE, "{0} failed: {1}");
        messageSource.addMessage("dataset.pythonbuild.operation.response.empty", TEST_LOCALE,
            "{0} failed: knowledge base service returned an empty response");
        messageSource.addMessage("user.permission.nopermission", TEST_LOCALE,
            "No permission to manage this resource");
        for (String key : List.of("dataset.cloud.access.denied", "dataset.file.rename.name.invalid",
            "dataset.file.rename.path.invalid", "dataset.cloud.item.manage.denied",
            "resource.lifecycle.status.invalid", "dataset.creator.immutable", "dataset.file.exists")) {
            messageSource.addMessage(key, Locale.getDefault(), key);
        }
        ApplicationContext applicationContext = org.mockito.Mockito.mock(ApplicationContext.class);
        org.mockito.Mockito.when(applicationContext.getBean(org.springframework.context.MessageSource.class))
            .thenReturn(messageSource);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
    }

    @BeforeEach
    void setUp() {
        LocaleContextHolder.setLocale(TEST_LOCALE);
        service = new DatasetApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "feignPythonBuildService", feignPythonBuildService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
    }

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void createFolder_allowsDefaultPersonalDatasetWhenCurrentUserCanManage() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(feignPythonBuildService.createDirectory(any(), any())).thenReturn(successResponse());

        Folder folder = new Folder();
        folder.setResourceId(100L);
        folder.setDirectoryName("reports");
        folder.setDirectoryPath("/2026");

        service.createFolder(folder, Collections.emptyMap());

        ArgumentCaptor<com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate> captor = ArgumentCaptor
            .forClass(com.iwhalecloud.byai.common.feign.request.pythonbuild.KbDirectoryCreate.class);
        verify(feignPythonBuildService).createDirectory(captor.capture(), any());
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getDirectoryPath()).isEqualTo("/2026/reports");
    }

    @Test
    void updateDatasetRejectsDeregisteredRecordsBeforeChangingContent() {
        SsResource resource = new SsResource();
        resource.setResourceId(100L);
        resource.setResourceBizType("KG_DOC");
        resource.setResourceStatus(-1);
        when(ssResourceService.findByIdForUpdate(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        com.iwhalecloud.byai.manager.dto.resource.DatasetDto request =
            new com.iwhalecloud.byai.manager.dto.resource.DatasetDto();
        request.setResourceId(100L);
        assertThatThrownBy(() -> service.updateDataset(request)).isInstanceOf(IllegalArgumentException.class);
        verify(ssResourceService, never()).updateResourceEntity(any());
        verifyNoInteractions(feignPythonBuildService);
    }

    @Test
    void deleteDataset_rejectsDefaultPersonalDataset() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findByIdForUpdate(100L)).thenReturn(resource);

        assertThatThrownBy(() -> service.deleteDataset(100L)).isInstanceOf(IllegalArgumentException.class)
            .hasMessage("dataset.default.personal.delete.not.allowed");

        verify(authApplicationService, never()).hasResourceManagePermission(any());
        verify(feignPythonBuildService, never()).deleteKnowledgeBase(any(), any());
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
        assertThat(result.getData().get(0).getKnCode()).isEqualTo("personal-kb");
        assertThat(result.getData().get(0).getResourceId()).isEqualTo(100L);
        assertThat(result.getData().get(0).getFilePath()).isEqualTo("/hr/renewal.md");
    }

    @Test
    void searchKnowledgeMetadata_mapsResourceIdsAndForwardsDslPagination() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);

        KnowledgeMetadataSearchItem item = new KnowledgeMetadataSearchItem();
        item.setKnCode("personal-kb");
        item.setFilePath("/制度/人事/续签流程.md");
        item.setMetadata(Map.of("status", Map.of("valueType", "string", "value", "active")));
        KnowledgeMetadataSearchResult qaResult = new KnowledgeMetadataSearchResult();
        qaResult.setData(List.of(item));
        qaResult.setTotal(1L);
        qaResult.setPageNum(1);
        qaResult.setPageSize(20);
        PythonBuildResponse<KnowledgeMetadataSearchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.searchKnowledgeMetadata(any())).thenReturn(response);

        KnowledgeMetadataSearchRequest request = new KnowledgeMetadataSearchRequest();
        request.setResourceIdList(List.of(100L));
        request.setWhere(Map.of("eq", Map.of("fieldName", "status", "value", "active")));
        request.setMetadataFieldList(List.of("status", "tags", "fileSignature"));
        request.setTopK(500);
        request.setPageNum(1);
        request.setPageSize(20);

        KnowledgeMetadataSearchResult result = service.searchKnowledgeMetadata(request);

        ArgumentCaptor<KbKnowledgeMetadataSearch> captor = ArgumentCaptor.forClass(KbKnowledgeMetadataSearch.class);
        verify(feignPythonBuildService).searchKnowledgeMetadata(captor.capture());
        assertThat(captor.getValue().getKnCodeList()).containsExactly("personal-kb");
        assertThat(captor.getValue().getWhere()).isEqualTo(request.getWhere());
        assertThat(captor.getValue().getMetadataFieldList()).containsExactly("status", "tags", "fileSignature");
        assertThat(captor.getValue().getTopK()).isEqualTo(500);
        assertThat(captor.getValue().getPageNum()).isEqualTo(1);
        assertThat(captor.getValue().getPageSize()).isEqualTo(20);
        assertThat(result.getData()).singleElement().satisfies(metadataItem -> {
            assertThat(metadataItem.getKnCode()).isEqualTo("personal-kb");
            assertThat(metadataItem.getResourceId()).isEqualTo(100L);
            assertThat(metadataItem.getFilePath()).isEqualTo("/制度/人事/续签流程.md");
        });
        assertThat(result.getTotal()).isEqualTo(1L);
        assertThat(result.getPageNum()).isEqualTo(1);
        assertThat(result.getPageSize()).isEqualTo(20);
    }

    @Test
    void searchKnowledgeMetadata_rejectsMissingResourceIdWithLocalizedMessage() {
        KnowledgeMetadataSearchRequest request = new KnowledgeMetadataSearchRequest();
        request.setResourceIdList(Collections.singletonList(null));

        assertThatThrownBy(() -> service.searchKnowledgeMetadata(request)).isInstanceOf(BaseException.class)
            .hasMessage("Knowledge base resource identifier cannot be empty");

        verifyNoInteractions(ssResourceService, authApplicationService, feignPythonBuildService);
    }

    @Test
    void searchKnowledgeMetadata_localizesKnowledgeServiceFailure() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        PythonBuildResponse<KnowledgeMetadataSearchResult> response = new PythonBuildResponse<>();
        response.setResultCode("-1");
        response.setResultMsg("remote validation failed");
        when(feignPythonBuildService.searchKnowledgeMetadata(any())).thenReturn(response);

        KnowledgeMetadataSearchRequest request = new KnowledgeMetadataSearchRequest();
        request.setResourceIdList(List.of(100L));
        request.setWhere(Map.of("eq", Map.of("fieldName", "status", "value", "active")));

        assertThatThrownBy(() -> service.searchKnowledgeMetadata(request)).isInstanceOf(BaseException.class)
            .hasMessage("Search knowledge base file metadata failed: remote validation failed");
    }

    @Test
    void searchKnowledgeMetadataByKnCode_preservesProtocolAfterCheckingResourceAccess() {
        KbKnowledgeMetadataSearch request = new KbKnowledgeMetadataSearch();
        request.setKnCodeList(List.of("2"));
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findByCode("2")).thenReturn(List.of(resource));
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        request.setWhere(Map.of("contains", Map.of("fieldName", "tags", "value", "contract")));
        request.setMetadataFieldList(List.of("status", "tags"));
        request.setPageNum(1);
        request.setPageSize(20);

        Map<String, Object> qaError = Map.of("errorCode", "DSL_VALIDATION_ERROR", "errorList",
            List.of(Map.of("path", "where.and[2]", "code", "TOO_MANY_CONDITIONS")));
        PythonBuildResponse<Object> response = new PythonBuildResponse<>();
        response.setResultCode("-1");
        response.setResultMsg("request validation failed");
        response.setResultObject(qaError);
        when(feignPythonBuildService.searchKnowledgeMetadataRaw(request)).thenReturn(response);

        PythonBuildResponse<Object> result = service.searchKnowledgeMetadataByKnCode(request);

        assertThat(result).isSameAs(response);
        assertThat(result.getResultObject()).isEqualTo(qaError);
        verify(feignPythonBuildService).searchKnowledgeMetadataRaw(request);
        verify(authApplicationService).hasResourceAccessPermission(resource);
    }

    @Test
    void buildResult_preservesQaKnCodeAndAddsResourceId() {
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
        assertThat(result.getKnCode()).isEqualTo("personal-kb");
        assertThat(result.getResourceId()).isEqualTo(100L);
        assertThat(result.getBuild().getStatus()).isEqualTo("complete");
    }

    @Test
    void readFile_preservesQaKnCodeAndAddsResourceId() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);

        KbFileReadResult qaResult = new KbFileReadResult();
        qaResult.setKnCode("personal-kb");
        qaResult.setFilePath("/制度/请假.md");
        qaResult.setData("# 请假制度");
        PythonBuildResponse<KbFileReadResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.readFile(any(), eq(100L))).thenReturn(response);

        KnowledgeReadFileRequest request = new KnowledgeReadFileRequest();
        request.setResourceId(100L);
        request.setFilePath("制度/请假.md");

        KbFileReadResult result = service.readFile(request);

        ArgumentCaptor<KbFileRead> captor = ArgumentCaptor.forClass(KbFileRead.class);
        verify(feignPythonBuildService).readFile(captor.capture(), eq(100L));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/制度/请假.md");
        assertThat(result.getKnCode()).isEqualTo("personal-kb");
        assertThat(result.getResourceId()).isEqualTo(100L);
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
        when(feignPythonBuildService.moveKnowledgeItems(any(), any())).thenReturn(response);

        KnowledgeItemsMoveRequest request = new KnowledgeItemsMoveRequest();
        request.setResourceId(100L);
        request.setSourcePath(List.of("/制度/考勤.pdf", "/制度/图片"));
        request.setTargetDirectoryPath("/归档/人事");

        KnowledgeItemsMoveResult result = service.moveKnowledgeItems(request, Collections.emptyMap());

        ArgumentCaptor<KbKnowledgeItemsMove> captor = ArgumentCaptor.forClass(KbKnowledgeItemsMove.class);
        verify(feignPythonBuildService).moveKnowledgeItems(captor.capture(), any());
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
        when(feignPythonBuildService.importKnowledgeItem(any(), any())).thenReturn(response);

        MockMultipartFile zip = new MockMultipartFile("files", "制度.zip", "application/zip", new byte[]{
            1, 2, 3
        });
        UploadResult result = service.uploadFiles(new MockMultipartFile[]{
            zip
        }, 100L, "/制度", null, null, false, false, Collections.emptyMap());

        ArgumentCaptor<KbFileImport> captor = ArgumentCaptor.forClass(KbFileImport.class);
        verify(feignPythonBuildService).importKnowledgeItem(captor.capture(), any());
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
    void updateKnowledgeFile_preservesQaKnCodeAndAddsResourceId() {
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
        when(feignPythonBuildService.updateKnowledgeItem(any(), any())).thenReturn(response);

        MockMultipartFile file = new MockMultipartFile("fileContent", "请假.md", "text/markdown", "# 请假制度".getBytes());
        KbFileUpdateResult result = service.updateKnowledgeFile(100L, "制度/请假.md", "", true, file,
            Collections.emptyMap());

        ArgumentCaptor<KbFileUpdate> captor = ArgumentCaptor.forClass(KbFileUpdate.class);
        verify(feignPythonBuildService).updateKnowledgeItem(captor.capture(), any());
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/制度/请假.md");
        assertThat(captor.getValue().getFileDescription()).isEmpty();
        assertThat(captor.getValue().getProcessFrontMatter()).isTrue();
        assertThat(captor.getValue().getMultipartFile()).isSameAs(file);
        assertThat(result.getData()).singleElement().satisfies(updated -> {
            assertThat(updated.getKnCode()).isEqualTo("personal-kb");
            assertThat(updated.getResourceId()).isEqualTo(100L);
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
    void updateKnowledgeFileMetadata_mapsResourceIdToKnCodeAndForwardsOperations() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);

        PythonBuildResponse<Map<String, Object>> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(Collections.emptyMap());

        Map<String, String> headers = new HashMap<>();
        headers.put(FeignPythonBuildService.RESOURCE_ID_HEADER, String.valueOf(100L));
        when(feignPythonBuildService.updateKnowledgeFileMetadata(any(), eq(headers))).thenReturn(response);

        KnowledgeFileMetadataUpdateRequest.MetadataOperation setStatus =
            new KnowledgeFileMetadataUpdateRequest.MetadataOperation();
        setStatus.setPropertyName("status");
        setStatus.setOperation("set");
        setStatus.setValueType("string");
        setStatus.setValue("active");

        KnowledgeFileMetadataUpdateRequest.MetadataOperation appendTags =
            new KnowledgeFileMetadataUpdateRequest.MetadataOperation();
        appendTags.setPropertyName("tags");
        appendTags.setOperation("append");
        appendTags.setValue(List.of("contract", "renewal"));

        KnowledgeFileMetadataUpdateRequest request = new KnowledgeFileMetadataUpdateRequest();
        request.setResourceId(100L);
        request.setFilePath("制度/人事/续签流程.md");
        request.setOperationList(List.of(setStatus, appendTags));

        Map<String, Object> result = service.updateKnowledgeFileMetadata(request, Collections.emptyMap());

        ArgumentCaptor<KbFileMetadataUpdate> captor = ArgumentCaptor.forClass(KbFileMetadataUpdate.class);
        verify(feignPythonBuildService).updateKnowledgeFileMetadata(captor.capture(), eq(headers));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/制度/人事/续签流程.md");
        assertThat(captor.getValue().getOperationList()).hasSize(2);
        assertThat(captor.getValue().getOperationList().get(0).getPropertyName()).isEqualTo("status");
        assertThat(captor.getValue().getOperationList().get(0).getOperation()).isEqualTo("set");
        assertThat(captor.getValue().getOperationList().get(0).getValueType()).isEqualTo("string");
        assertThat(captor.getValue().getOperationList().get(0).getValue()).isEqualTo("active");
        assertThat(captor.getValue().getOperationList().get(1).getPropertyName()).isEqualTo("tags");
        assertThat(captor.getValue().getOperationList().get(1).getOperation()).isEqualTo("append");
        assertThat(captor.getValue().getOperationList().get(1).getValue()).isEqualTo(List.of("contract", "renewal"));
        assertThat(result).isEmpty();
    }

    @Test
    void searchKnowledgeItems_forwardsLatestFilteringFields() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        KnowledgeSearchItem qaItem = new KnowledgeSearchItem();
        qaItem.setKnCode("personal-kb");
        KnowledgeSearchResult qaResult = new KnowledgeSearchResult();
        qaResult.setData(List.of(qaItem));
        PythonBuildResponse<KnowledgeSearchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.searchKnowledgeItems(any())).thenReturn(response);

        KnowledgeSearchRequest request = new KnowledgeSearchRequest();
        request.setResourceIdList(List.of(100L));
        request.setQuery("请假流程");
        request.setTopK(5);
        request.setSearchMode("mixedRecall");
        request.setWhere(Map.of("in", Map.of("fieldName", "fileType", "value", List.of("pdf"))));
        request.setMetadataFieldList(List.of("owner", "status"));
        request.setFileTypeList(List.of("pdf"));

        KnowledgeSearchResult result = service.searchKnowledgeItems(request);

        ArgumentCaptor<KbKnowledgeSearch> captor = ArgumentCaptor.forClass(KbKnowledgeSearch.class);
        verify(feignPythonBuildService).searchKnowledgeItems(captor.capture());
        assertThat(captor.getValue().getKnCodeList()).containsExactly("personal-kb");
        assertThat(captor.getValue().getWhere()).isEqualTo(request.getWhere());
        assertThat(captor.getValue().getMetadataFieldList()).containsExactly("owner", "status");
        assertThat(captor.getValue().getFileTypeList()).containsExactly("pdf");
        assertThat(result.getData()).hasSize(1);
        assertThat(result.getData().get(0).getKnCode()).isEqualTo("personal-kb");
        assertThat(result.getData().get(0).getResourceId()).isEqualTo(100L);
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
    void entityDiscovery_mapsResourceIdToKnCodeAndKeepsWholeKnowledgeBaseScope() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        KnowledgeEntityBatchResult qaResult = new KnowledgeEntityBatchResult();
        qaResult.setBatchId("ed-20260817-0001");
        qaResult.setScope("WHOLE_KB");
        qaResult.setTaskType("ENTITY_DISCOVERY");
        PythonBuildResponse<KnowledgeEntityBatchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);

        Map<String, String> headers = new HashMap<String, String>();
        headers.put(FeignPythonBuildService.RESOURCE_ID_HEADER, String.valueOf(100L));

        when(feignPythonBuildService.entityDiscovery(any(), eq(headers))).thenReturn(response);

        KnowledgeEntityDiscoveryRequest request = new KnowledgeEntityDiscoveryRequest();
        request.setResourceId(100L);
        request.setMaxEntities(12);
        request.setForce(true);
        request.setTags(List.of("organization", "ai"));
        request.setExtraParams(Map.of("source", "portal"));

        KnowledgeEntityBatchResult result = service.entityDiscovery(request, Collections.emptyMap());

        ArgumentCaptor<KbEntityDiscovery> captor = ArgumentCaptor.forClass(KbEntityDiscovery.class);
        verify(feignPythonBuildService).entityDiscovery(captor.capture(), eq(headers));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isNull();
        assertThat(captor.getValue().getDirectoryPath()).isNull();
        assertThat(captor.getValue().getTargetDirectoryPath()).isNull();
        assertThat(captor.getValue().getMaxEntities()).isEqualTo(12);
        assertThat(captor.getValue().getForce()).isTrue();
        assertThat(captor.getValue().getTags()).containsExactly("organization", "ai");
        assertThat(captor.getValue().getExtraParams()).containsEntry("source", "portal");
        assertThat(result.getResourceId()).isEqualTo(100L);
        assertThat(result.getBatchId()).isEqualTo("ed-20260817-0001");
    }

    @Test
    void entityDiscovery_forwardsNormalizedInputAndOutputDirectories() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        PythonBuildResponse<KnowledgeEntityBatchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(new KnowledgeEntityBatchResult());
        when(feignPythonBuildService.entityDiscovery(any(), any())).thenReturn(response);

        KnowledgeEntityDiscoveryRequest request = new KnowledgeEntityDiscoveryRequest();
        request.setResourceId(100L);
        request.setDirectoryPath("原始文档//人力资源/");
        request.setTargetDirectoryPath("领域知识//组织/");

        service.entityDiscovery(request, Collections.emptyMap());

        ArgumentCaptor<KbEntityDiscovery> captor = ArgumentCaptor.forClass(KbEntityDiscovery.class);
        verify(feignPythonBuildService).entityDiscovery(captor.capture(), any());
        assertThat(captor.getValue().getDirectoryPath()).isEqualTo("/原始文档/人力资源");
        assertThat(captor.getValue().getTargetDirectoryPath()).isEqualTo("/领域知识/组织");
    }

    @Test
    void entityEnrich_requiresManagePermissionAndNormalizesFilePath() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        KnowledgeEntityBatchResult qaResult = new KnowledgeEntityBatchResult();
        qaResult.setBatchId("ee-20260817-0001");
        PythonBuildResponse<KnowledgeEntityBatchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);

        Map<String, String> headers = new HashMap<String, String>();
        headers.put(FeignPythonBuildService.RESOURCE_ID_HEADER, String.valueOf(100L));

        when(feignPythonBuildService.entityEnrich(any(), eq(headers))).thenReturn(response);

        KnowledgeEntityEnrichRequest request = new KnowledgeEntityEnrichRequest();
        request.setResourceId(100L);
        request.setFilePath("KnowledgeEntity/OSOT.md");
        request.setTopK(20);


        KnowledgeEntityBatchResult result = service.entityEnrich(request, headers);

        ArgumentCaptor<KbEntityEnrich> captor = ArgumentCaptor.forClass(KbEntityEnrich.class);
        verify(feignPythonBuildService).entityEnrich(captor.capture(), eq(headers));
        assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
        assertThat(captor.getValue().getFilePath()).isEqualTo("/KnowledgeEntity/OSOT.md");
        assertThat(captor.getValue().getTopK()).isEqualTo(20);
        assertThat(result.getResourceId()).isEqualTo(100L);
    }

    @Test
    void entityEnrich_forwardsNormalizedDirectoryScope() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        KnowledgeEntityBatchResult qaResult = new KnowledgeEntityBatchResult();
        qaResult.setBatchId("ee-20260817-0002");
        qaResult.setScope("DIRECTORY");
        qaResult.setTargetPath("/领域知识/组织");
        qaResult.setCandidateCount(3);
        qaResult.setReturnedTaskCount(2);
        qaResult.setTasksTruncated(false);
        PythonBuildResponse<KnowledgeEntityBatchResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(qaResult);
        when(feignPythonBuildService.entityEnrich(any(), any())).thenReturn(response);

        KnowledgeEntityEnrichRequest request = new KnowledgeEntityEnrichRequest();
        request.setResourceId(100L);
        request.setDirectoryPath("领域知识//组织/");

        KnowledgeEntityBatchResult result = service.entityEnrich(request, Collections.emptyMap());

        ArgumentCaptor<KbEntityEnrich> captor = ArgumentCaptor.forClass(KbEntityEnrich.class);
        verify(feignPythonBuildService).entityEnrich(captor.capture(), any());
        assertThat(captor.getValue().getFilePath()).isNull();
        assertThat(captor.getValue().getDirectoryPath()).isEqualTo("/领域知识/组织");
        assertThat(result.getScope()).isEqualTo("DIRECTORY");
        assertThat(result.getTargetPath()).isEqualTo("/领域知识/组织");
        assertThat(result.getCandidateCount()).isEqualTo(3);
        assertThat(result.getReturnedTaskCount()).isEqualTo(2);
        assertThat(result.getTasksTruncated()).isFalse();
    }

    @Test
    void entityDiscovery_rejectsUserWithoutKnowledgeBaseManagePermission() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(false);
        KnowledgeEntityDiscoveryRequest request = new KnowledgeEntityDiscoveryRequest();
        request.setResourceId(100L);

        assertThatThrownBy(() -> service.entityDiscovery(request, Collections.emptyMap())).isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(feignPythonBuildService);
    }

    @Test
    void globKnowledgeItems_preservesQaFileSize() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        DirOrFile file = new DirOrFile();
        file.setKnCode("personal-kb");
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
            assertThat(item.getKnCode()).isEqualTo("personal-kb");
            assertThat(item.getResourceId()).isEqualTo(100L);
            assertThat(item.getDirectoryPath()).isEqualTo("/制度/人事/请假.pdf");
            assertThat(item.getSize()).isEqualTo(245760L);
        });
    }

    enum ContentOperation {
        CREATE_FOLDER, RENAME_FOLDER, DELETE_FOLDER, UPLOAD_FILE, RENAME_FILE, DELETE_FILE, CHECK_UPLOAD, BUILD_FILE, MOVE_ITEM, UPDATE_FILE, UPDATE_METADATA
    }

    @ParameterizedTest
    @EnumSource(value = ContentOperation.class, names = {"CREATE_FOLDER", "UPLOAD_FILE", "CHECK_UPLOAD", "BUILD_FILE"})
    void cloudContentAllowsReadableMembersWithoutResourceManagement(ContentOperation operation) throws Exception {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);

        invokeContentOperation(operation, true);

        verify(authApplicationService).hasResourceAccessPermission(resource);
        verify(authApplicationService, never()).hasResourceManagePermission(any());
    }

    @ParameterizedTest
    @EnumSource(ContentOperation.class)
    void cloudContentRejectsUsersOutsideProjectBeforeCallingKnowledgeService(ContentOperation operation) {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThatThrownBy(() -> invokeContentOperation(operation, false))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.access.denied");

        // 不回退资源管理权限，项目外管理员也不能绕过项目读取规则。
        verify(authApplicationService, never()).hasResourceManagePermission(any());
        verifyNoInteractions(feignPythonBuildService);
    }

    @ParameterizedTest
    @EnumSource(ContentOperation.class)
    void ordinaryKnowledgeContentStillRequiresManagement(ContentOperation operation) {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_DOC");
        when(ssResourceService.findById(100L)).thenReturn(resource);

        assertThatThrownBy(() -> invokeContentOperation(operation, false)).isInstanceOf(IllegalArgumentException.class);

        verify(authApplicationService).hasResourceManagePermission(resource);
        verify(authApplicationService, never()).hasResourceAccessPermission(any());
        verifyNoInteractions(feignPythonBuildService);
    }

    @ParameterizedTest
    @EnumSource(ContentOperation.class)
    void ordinaryKnowledgeManagersKeepContentOperations(ContentOperation operation) throws Exception {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_DOC");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);

        invokeContentOperation(operation, true);

        verify(authApplicationService).hasResourceManagePermission(resource);
        verify(authApplicationService, never()).hasResourceAccessPermission(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", ".", "..", "../outside.md", "sub/file.md", "sub\\file.md"})
    void fileRenameRejectsNamesThatCouldMoveOutOfOriginalDirectory(String name) {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.canManageAllProjectCloudItems(resource)).thenReturn(true);
        KnowledgeFileRenameRequest request = new KnowledgeFileRenameRequest();
        request.setResourceId(100L);
        request.setFilePath("/reports/old.md");
        request.setFileName(name);

        assertThatThrownBy(() -> service.renameKnowledgeFile(request, Collections.emptyMap()))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.file.rename.name.invalid");
        verifyNoInteractions(feignPythonBuildService);
    }

    @ParameterizedTest
    @EnumSource(value = ContentOperation.class, names = {"RENAME_FOLDER", "DELETE_FOLDER", "RENAME_FILE", "DELETE_FILE", "MOVE_ITEM", "UPDATE_FILE", "UPDATE_METADATA"})
    void itemCreatorCanRenameAndDeleteOwnItems(ContentOperation operation) throws Exception {
        prepareCloudItemOwner("member");
        try (var current = org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.class)) {
            current.when(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder::getCurrentUserCode).thenReturn("member");
            invokeContentOperation(operation, true);
        }
    }

    @ParameterizedTest
    @EnumSource(value = ContentOperation.class, names = {"RENAME_FOLDER", "DELETE_FOLDER", "RENAME_FILE", "DELETE_FILE", "MOVE_ITEM", "UPDATE_FILE", "UPDATE_METADATA"})
    void membersCannotRenameOrDeleteOtherUsersItems(ContentOperation operation) {
        prepareCloudItemOwner("other-member");
        try (var current = org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.class)) {
            current.when(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder::getCurrentUserCode).thenReturn("member");
            assertThatThrownBy(() -> invokeContentOperation(operation, false))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.item.manage.denied");
        }
        verify(feignPythonBuildService, never()).updateDirectory(any(), any());
        verify(feignPythonBuildService, never()).deleteDirectory(any(), any());
        verify(feignPythonBuildService, never()).deleteKnowledgeItem(any(), any());
        verify(feignPythonBuildService, never()).moveKnowledgeItems(any(), any());
    }

    @ParameterizedTest
    @EnumSource(value = ContentOperation.class, names = {"RENAME_FOLDER", "DELETE_FOLDER", "RENAME_FILE", "DELETE_FILE", "MOVE_ITEM", "UPDATE_FILE", "UPDATE_METADATA"})
    void projectCreatorOrAdminVipCanManageAllItemsWithoutOwnerMetadata(ContentOperation operation) throws Exception {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.canManageAllProjectCloudItems(resource)).thenReturn(true);
        invokeContentOperation(operation, true);
        verify(feignPythonBuildService, never()).listDir(any(), any());
    }

    @Test
    void missingCreatorDoesNotGrantOrdinaryMemberPermission() {
        prepareCloudItemOwner("");
        try (var current = org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.class)) {
            current.when(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder::getCurrentUserCode).thenReturn("member");
            assertThatThrownBy(() -> invokeContentOperation(ContentOperation.DELETE_FILE, false))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.cloud.item.manage.denied");
        }
        verify(feignPythonBuildService, never()).deleteKnowledgeItem(any(), any());
    }

    private void prepareCloudItemOwner(String ownerCode) {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        Data data = new Data();
        for (String path : List.of("/reports/", "/reports/old.md", "/reports/file.md")) {
            DirOrFile item = new DirOrFile();
            item.setName(path);
            item.setMetadata(Map.of("userCode", Map.of("value", ownerCode)));
            data.getData().add(item);
        }
        PythonBuildResponse<Data> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        response.setResultObject(data);
        when(feignPythonBuildService.listDir(any(), eq(100L))).thenReturn(response);
    }

    private void invokeContentOperation(ContentOperation operation, boolean allowRemote) throws Exception {
        Map<String, String> headers = Collections.emptyMap();
        Folder folder = new Folder();
        folder.setResourceId(100L);
        folder.setDirectoryPath("/reports/");
        folder.setDirectoryName("renamed");
        switch (operation) {
            case MOVE_ITEM:
                KnowledgeItemsMoveRequest moveRequest = new KnowledgeItemsMoveRequest();
                moveRequest.setResourceId(100L);
                moveRequest.setSourcePath(List.of("/reports/old.md"));
                moveRequest.setTargetDirectoryPath("/other/");
                PythonBuildResponse<KnowledgeItemsMoveResult> moveResponse = new PythonBuildResponse<>();
                moveResponse.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                if (allowRemote) when(feignPythonBuildService.moveKnowledgeItems(any(), any())).thenReturn(moveResponse);
                service.moveKnowledgeItems(moveRequest, headers);
                verify(feignPythonBuildService).moveKnowledgeItems(any(), any());
                break;
            case UPDATE_FILE:
                PythonBuildResponse<KbFileUpdateResult> updateResponse = new PythonBuildResponse<>();
                updateResponse.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                if (allowRemote) when(feignPythonBuildService.updateKnowledgeItem(any(), any())).thenReturn(updateResponse);
                service.updateKnowledgeFile(100L, "/reports/old.md", "", false,
                    new MockMultipartFile("fileContent", "old.md", "text/markdown", new byte[]{1}), headers);
                verify(feignPythonBuildService).updateKnowledgeItem(any(), any());
                break;
            case UPDATE_METADATA:
                KnowledgeFileMetadataUpdateRequest metadataRequest = new KnowledgeFileMetadataUpdateRequest();
                metadataRequest.setResourceId(100L);
                metadataRequest.setFilePath("/reports/old.md");
                PythonBuildResponse<Map<String, Object>> metadataResponse = new PythonBuildResponse<>();
                metadataResponse.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                if (allowRemote) when(feignPythonBuildService.updateKnowledgeFileMetadata(any(), any())).thenReturn(metadataResponse);
                service.updateKnowledgeFileMetadata(metadataRequest, headers);
                verify(feignPythonBuildService).updateKnowledgeFileMetadata(any(), any());
                break;
            case BUILD_FILE:
                if (allowRemote) {
                    when(feignPythonBuildService.fileToMarkdownIndex(any(), any())).thenReturn(successResponse());
                }
                DatasetBuild build = new DatasetBuild();
                build.setResourceId(100L);
                build.setDirectoryPath("/reports/other-member.md");
                service.build(build, headers);
                ArgumentCaptor<KbFileToMarkdownIndex> buildCaptor = ArgumentCaptor.forClass(KbFileToMarkdownIndex.class);
                verify(feignPythonBuildService).fileToMarkdownIndex(buildCaptor.capture(),
                    org.mockito.ArgumentMatchers.argThat(value -> "100".equals(value.get(FeignPythonBuildService.RESOURCE_ID_HEADER))));
                assertThat(buildCaptor.getValue().getFilePath()).isEqualTo("/reports/other-member.md");
                assertThat(buildCaptor.getValue().getKnCode()).isEqualTo("personal-kb");
                // 构建不查询条目创建人，也不要求项目创建人或 adminvip 身份。
                verify(feignPythonBuildService, never()).listDir(any(), any());
                verify(authApplicationService, never()).canManageAllProjectCloudItems(any());
                break;
            case CREATE_FOLDER:
                if (allowRemote) when(feignPythonBuildService.createDirectory(any(), any())).thenReturn(successResponse());
                service.createFolder(folder, headers);
                verify(feignPythonBuildService).createDirectory(any(), any());
                break;
            case RENAME_FOLDER:
                if (allowRemote) when(feignPythonBuildService.updateDirectory(any(), any())).thenReturn(successResponse());
                service.renameFolder(folder, headers);
                verify(feignPythonBuildService).updateDirectory(any(), any());
                break;
            case DELETE_FOLDER:
                if (allowRemote) when(feignPythonBuildService.deleteDirectory(any(), any())).thenReturn(successResponse());
                FolderDelete delete = new FolderDelete();
                delete.setResourceId(100L);
                delete.setDirectoryPath("/reports/");
                service.deleteFolder(delete, headers);
                verify(feignPythonBuildService).deleteDirectory(any(), any());
                break;
            case DELETE_FILE:
                if (allowRemote) when(feignPythonBuildService.deleteKnowledgeItem(any(), any())).thenReturn(successResponse());
                RemoveFileDto remove = new RemoveFileDto();
                remove.setResourceId(100L);
                remove.setDirectoryPath("/reports/file.md");
                service.removeFile(remove, headers);
                verify(feignPythonBuildService).deleteKnowledgeItem(any(), any());
                break;
            case UPLOAD_FILE:
                PythonBuildResponse<KbImportResult> uploaded = new PythonBuildResponse<>();
                uploaded.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                if (allowRemote) {
                    when(feignPythonBuildService.importKnowledgeItem(any(), any())).thenReturn(uploaded);
                    if ("KG_CLOUD".equals(ssResourceService.findById(100L).getResourceBizType())) {
                        PythonBuildResponse<Data> empty = new PythonBuildResponse<>();
                        empty.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                        when(feignPythonBuildService.listDir(any(), eq(100L))).thenReturn(empty);
                    }
                }
                service.uploadFiles(new MockMultipartFile[]{
                    new MockMultipartFile("files", "file.md", "text/markdown", "hello".getBytes())
                }, 100L, "/reports/", "", null, false, false, headers);
                verify(feignPythonBuildService).importKnowledgeItem(any(), any());
                break;
            case RENAME_FILE:
                PythonBuildResponse<KnowledgeItemsMoveResult> moved = new PythonBuildResponse<>();
                moved.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                if (allowRemote) when(feignPythonBuildService.moveKnowledgeItems(any(), any())).thenReturn(moved);
                KnowledgeFileRenameRequest rename = new KnowledgeFileRenameRequest();
                rename.setResourceId(100L);
                rename.setFilePath("/reports/old.md");
                rename.setFileName("new.md");
                service.renameKnowledgeFile(rename, headers);
                ArgumentCaptor<KbKnowledgeItemsMove> captor = ArgumentCaptor.forClass(KbKnowledgeItemsMove.class);
                verify(feignPythonBuildService).moveKnowledgeItems(captor.capture(),
                    org.mockito.ArgumentMatchers.argThat(value -> "100".equals(value.get(FeignPythonBuildService.RESOURCE_ID_HEADER))));
                assertThat(captor.getValue().getSourcePath()).containsExactly("/reports/old.md");
                assertThat(captor.getValue().getTargetFilePath()).isEqualTo("/reports/new.md");
                assertThat(captor.getValue().getKnCode()).isEqualTo("personal-kb");
                assertThat(captor.getValue().getOverwrite()).isFalse();
                break;
            case CHECK_UPLOAD:
                PythonBuildResponse<Data> listed = new PythonBuildResponse<>();
                listed.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
                if (allowRemote) when(feignPythonBuildService.listDir(any(), eq(100L))).thenReturn(listed);
                KnowledgeUploadConflictCheckRequest conflict = new KnowledgeUploadConflictCheckRequest();
                conflict.setResourceId(100L);
                conflict.setDirectoryPath("/reports/");
                conflict.setFileNames(List.of("file.md"));
                service.checkUploadFileConflicts(conflict);
                verify(feignPythonBuildService).listDir(any(), eq(100L));
                break;
            default:
                throw new AssertionError(operation);
        }
    }

    @Test
    void metadataCannotChangeCreatorEvenForManagers() {
        SsResource resource = defaultPersonalDataset();
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        KnowledgeFileMetadataUpdateRequest request = new KnowledgeFileMetadataUpdateRequest();
        request.setResourceId(100L);
        request.setFilePath("/a.md");
        KnowledgeFileMetadataUpdateRequest.MetadataOperation operation = new KnowledgeFileMetadataUpdateRequest.MetadataOperation();
        operation.setPropertyName("userCode");
        request.setOperationList(List.of(operation));
        assertThatThrownBy(() -> service.updateKnowledgeFileMetadata(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.creator.immutable");
        verifyNoInteractions(feignPythonBuildService);
    }

    @Test
    void rawCodeSearchChecksEveryResourceBeforeForwarding() {
        SsResource visible = defaultPersonalDataset();
        SsResource hidden = new SsResource();
        hidden.setResourceId(200L);
        hidden.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findByCode("visible")).thenReturn(List.of(visible));
        when(ssResourceService.findByCode("hidden")).thenReturn(List.of(hidden));
        when(authApplicationService.hasResourceAccessPermission(visible)).thenReturn(true);
        com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeMetadataSearch request =
            new com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeMetadataSearch();
        request.setKnCodeList(List.of("visible", "hidden"));
        assertThatThrownBy(() -> service.searchKnowledgeMetadataByKnCode(request)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(feignPythonBuildService);
    }

    @Test
    void forwardedCreatorComesFromServerNotCallerHeaders() {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        when(feignPythonBuildService.createDirectory(any(), any())).thenReturn(successResponse());
        try (var user = org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.class)) {
            user.when(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder::getCurrentUserCode).thenReturn("real-user");
            Folder folder = new Folder();
            folder.setResourceId(100L);
            folder.setDirectoryPath("/");
            folder.setDirectoryName("new");
            service.createFolder(folder, Map.of("x-user-code", "spoofed"));
            verify(feignPythonBuildService).createDirectory(any(), org.mockito.ArgumentMatchers.argThat(headers ->
                "real-user".equals(headers.get("X-USER-CODE")) && !headers.containsKey("x-user-code")));
        }
    }

    @Test
    void cloudOverwriteUpdatesExistingFileWithoutDeletingItsCreatorRecord() throws Exception {
        SsResource resource = prepareCloudConflict();
        when(authApplicationService.canManageAllProjectCloudItems(resource)).thenReturn(true);
        PythonBuildResponse<KbFileUpdateResult> response = new PythonBuildResponse<>();
        response.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        when(feignPythonBuildService.updateKnowledgeItem(any(), any())).thenReturn(response);
        service.uploadFiles(new MockMultipartFile[]{new MockMultipartFile("files", "old.md", "text/markdown", new byte[]{1})},
            100L, "/reports/", "", false, true, false, Map.of());
        verify(feignPythonBuildService).updateKnowledgeItem(any(), any());
        verify(feignPythonBuildService, never()).deleteKnowledgeItem(any(), any());
        verify(feignPythonBuildService, never()).importKnowledgeItem(any(), any());
    }

    @Test
    void cloudArchiveCannotOverwriteAnExistingFile() throws Exception {
        prepareCloudConflict();
        java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zip = new java.util.zip.ZipOutputStream(bytes)) {
            zip.putNextEntry(new java.util.zip.ZipEntry("old.md"));
            zip.write(new byte[]{1});
            zip.closeEntry();
        }
        MockMultipartFile archive = new MockMultipartFile("files", "files.zip", "application/zip", bytes.toByteArray());
        assertThatThrownBy(() -> service.uploadFiles(new MockMultipartFile[]{archive}, 100L, "/reports/", "", false,
            true, false, Map.of())).isInstanceOf(IllegalArgumentException.class).hasMessage("dataset.file.exists");
        verify(feignPythonBuildService, never()).importKnowledgeItem(any(), any());
    }

    private SsResource prepareCloudConflict() {
        SsResource resource = defaultPersonalDataset();
        resource.setResourceBizType("KG_CLOUD");
        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceAccessPermission(resource)).thenReturn(true);
        DirOrFile item = new DirOrFile();
        item.setName("/reports/old.md");
        item.setType("file");
        Data data = new Data();
        data.setData(List.of(item));
        PythonBuildResponse<Data> listing = new PythonBuildResponse<>();
        listing.setResultCode(PythonBuildResponse.RESPONSE_SUCCESS);
        listing.setResultObject(data);
        when(feignPythonBuildService.listDir(any(), eq(100L))).thenReturn(listing);
        return resource;
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
