package com.iwhalecloud.byai.state.application.service.dataset;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileDownload;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.Data;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.DirOrFile;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KbImportResult;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantProjectCloudAccessService;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeFileCopyRequest;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DatasetApplicationServiceCopyTest extends I18nTestSupport {
    private DatasetApplicationService service;
    private SsResourceService resources;
    private AuthApplicationService auth;
    private FeignPythonBuildService qa;
    private SsResource source;
    private SsResource target;
    private KnowledgeFileCopyRequest request;
    private TrackingInputStream input;
    private DirOrFile sourceFile;
    private PythonBuildResponse<KbImportResult> imported;
    private List<DirOrFile> targetEntries;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(7L);
        login.setUserCode("member");
        login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        resources = mock(SsResourceService.class);
        auth = mock(AuthApplicationService.class);
        qa = mock(FeignPythonBuildService.class);
        service = new DatasetApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", resources);
        ReflectionTestUtils.setField(service, "authApplicationService", auth);
        ReflectionTestUtils.setField(service, "feignPythonBuildService", qa);
        source = resource(100L, "KG_CLOUD", "source-cloud");
        source.setCreateBy(8L);
        target = resource(200L, "KG_DOC", "target-kb");
        target.setCreateBy(7L);
        when(resources.findById(100L)).thenReturn(source);
        when(resources.findById(200L)).thenReturn(target);
        when(auth.hasResourceAccessPermission(source)).thenReturn(true);
        when(auth.hasResourceManagePermission(target)).thenReturn(true);
        request = new KnowledgeFileCopyRequest();
        request.setSourceResourceId(100L);
        request.setSourceFilePath("/source/guide.md");
        request.setTargetResourceId(200L);
        request.setTargetDirectoryPath("/dest");
        sourceFile = entry("/source/guide.md", "file");
        sourceFile.setSize(4L);
        targetEntries = List.of();
        when(qa.listDir(any(), anyLong())).thenAnswer(invocation -> {
            KbListDir query = invocation.getArgument(0);
            Data data = new Data();
            data.setData("/source".equals(query.getDirectoryPath()) ? List.of(sourceFile) : targetEntries);
            return response(data);
        });
        input = new TrackingInputStream("body");
        when(qa.fileDownload(any(), anyLong())).thenReturn(input);
        imported = response(importResult("/dest/guide.md"));
        when(qa.importKnowledgeItem(any(), any())).thenAnswer(invocation -> imported);
    }

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void copiesOriginalBytesWithIndependentTargetIdentityAndCleansTemporaryFile() throws Exception {
        AtomicReference<MultipartFile> staged = new AtomicReference<>();
        Map<String, String> headers = Map.of("x-user-code", "spoofed", "X-CHAT-SESSION-ID", "session-1",
            FeignPythonBuildService.RESOURCE_ID_HEADER, "100");
        when(qa.importKnowledgeItem(any(), any())).thenAnswer(invocation -> {
            KbFileImport upload = invocation.getArgument(0);
            Map<String, String> forwarded = invocation.getArgument(1);
            assertThat(upload.getKnCode()).isEqualTo("target-kb");
            assertThat(upload.getFilePath()).isEqualTo("/dest/guide.md");
            assertThat(upload.getProcessFrontMatter()).isFalse();
            assertThat(upload.isSkipIfDuplicate()).isFalse();
            assertThat(forwarded).containsEntry("X-USER-CODE", "member")
                .containsEntry(FeignPythonBuildService.RESOURCE_ID_HEADER, "200")
                .containsEntry("X-CHAT-SESSION-ID", "session-1").doesNotContainKey("x-user-code");
            staged.set(upload.getMultipartFile());
            try (InputStream bytes = staged.get().getInputStream()) {
                assertThat(bytes.readAllBytes()).isEqualTo("body".getBytes(StandardCharsets.UTF_8));
            }
            return imported;
        });

        var result = service.copyKnowledgeFile(request, headers);

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getSourceResourceId()).isEqualTo(100L);
        assertThat(result.getTargetResourceId()).isEqualTo(200L);
        assertThat(result.getTargetFilePath()).isEqualTo("/dest/guide.md");
        assertThat(result.getFileSize()).isEqualTo(4L);
        assertThat(input.closed).isTrue();
        assertThatThrownBy(() -> staged.get().getInputStream()).isInstanceOf(IOException.class);
        assertThat(headers).containsEntry("x-user-code", "spoofed");
        ArgumentCaptor<KbFileDownload> download = ArgumentCaptor.forClass(KbFileDownload.class);
        verify(qa).fileDownload(download.capture(), eq(100L));
        assertThat(download.getValue().getKnCode()).isEqualTo("source-cloud");
        assertThat(download.getValue().getFilePath()).isEqualTo("/source/guide.md");
        verify(auth, never()).hasResourceManagePermission(source);
        verify(qa, never()).deleteKnowledgeItem(any(), any());
        verify(qa, never()).fileToMarkdownIndex(any(), any());
    }

    @Test
    void supportsCopyWithinTheSameDirectoryWithANewName() {
        request.setTargetResourceId(100L);
        request.setTargetDirectoryPath("/source");
        request.setTargetFileName("guide-copy.md");
        imported = response(importResult("/source/guide-copy.md"));

        var result = service.copyKnowledgeFile(request, Map.of());

        assertThat(result.getTargetResourceId()).isEqualTo(100L);
        assertThat(result.getTargetFilePath()).isEqualTo("/source/guide-copy.md");
        assertThat(result.getFileName()).isEqualTo("guide-copy.md");
    }

    @Test
    void defaultsToRootAndSupportsNonAsciiFileNamesAndNormalizedPaths() {
        request.setSourceFilePath("source\\\\制度.md");
        sourceFile.setName("/source/制度.md");
        request.setTargetDirectoryPath(null);
        imported = response(importResult("/制度.md"));

        var result = service.copyKnowledgeFile(request, null);

        assertThat(result.getSourceFilePath()).isEqualTo("/source/制度.md");
        assertThat(result.getTargetFilePath()).isEqualTo("/制度.md");
    }

    @Test
    void projectCloudTargetRequiresMembershipRatherThanResourceManagement() {
        target.setResourceBizType("KG_CLOUD");
        when(auth.hasResourceManagePermission(target)).thenReturn(false);
        when(auth.hasResourceAccessPermission(target)).thenReturn(true);

        assertThat(service.copyKnowledgeFile(request, Map.of()).isSuccess()).isTrue();

        verify(auth, never()).hasResourceManagePermission(target);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void actualProjectPermissionAllowsMembersAndRejectsRevokedMembership(boolean member) {
        Project project = new Project();
        project.setProjectId(12L);
        project.setCloudResourceId(100L);
        project.setCreateBy(8L);
        project.setDeleteFlag("0");
        ProjectService projects = mock(ProjectService.class);
        TenantProjectCloudAccessService tenantAccess = mock(TenantProjectCloudAccessService.class);
        when(projects.findByCloudResourceId(100L)).thenReturn(List.of(project));
        when(tenantAccess.canRead(project)).thenReturn(member);
        AuthApplicationService actualAuth = new AuthApplicationService();
        ReflectionTestUtils.setField(actualAuth, "projectService", projects);
        ReflectionTestUtils.setField(actualAuth, "tenantProjectCloudAccessService", tenantAccess);
        ReflectionTestUtils.setField(service, "authApplicationService", actualAuth);

        if (member) {
            assertThat(service.copyKnowledgeFile(request, Map.of()).isSuccess()).isTrue();
        } else {
            assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
                .isInstanceOf(IllegalArgumentException.class);
            verifyNoInteractions(qa);
        }
    }

    @Test
    void sourceWithoutReadPermissionIsRejectedBeforeAnyKnowledgeServiceCall() {
        when(auth.hasResourceAccessPermission(source)).thenReturn(false);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(qa);
    }

    @Test
    void viewOrUsePermissionOnOrdinaryTargetDoesNotAllowWriting() {
        when(auth.hasResourceManagePermission(target)).thenReturn(false);
        when(auth.hasResourceAccessPermission(target)).thenReturn(true);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(qa);
    }

    @Test
    void cloudTargetOutsideTheProjectIsRejectedEvenForAResourceManager() {
        target.setResourceBizType("KG_CLOUD");
        when(auth.hasResourceAccessPermission(target)).thenReturn(false);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(qa);
    }

    @ParameterizedTest
    @ValueSource(strings = {"KG_DB", "TOOLKIT", "DIG_EMPLOYEE", ""})
    void nonDocumentSourceResourcesAreRejected(String type) {
        source.setResourceBizType(type);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(qa);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void deletedResourcesOnEitherSideAreRejected(boolean sourceDeleted) {
        (sourceDeleted ? source : target).setResourceStatus(-1);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(qa);
    }

    @Test
    void copyingOntoTheOriginalPathIsRejectedWithoutSideEffects() {
        request.setTargetResourceId(100L);
        request.setTargetDirectoryPath("//source/");

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(resources, qa);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "/", "/source/", "/../guide.md", "/source/./guide.md", "..\\guide.md",
        "/a\u0000.md", "/a.md\u0000"})
    void invalidSourcePathsAreRejectedBeforeLookup(String path) {
        request.setSourceFilePath(path);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(resources, qa);
    }

    @ParameterizedTest
    @ValueSource(strings = {"../other", "/dest/./nested", "/dest\u0000"})
    void invalidTargetDirectoriesAreRejectedBeforeLookup(String path) {
        request.setTargetDirectoryPath(path);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(resources, qa);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", ".", "..", "../other.md", "dir\\other.md", "bad\n.md", "a.md\n", "archive.ZIP"})
    void invalidTargetFileNamesCannotBecomePathsOrArchiveExtraction(String name) {
        request.setTargetFileName(name);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(resources, qa);
    }

    @Test
    void zipSourcesAreNotSilentlyExtractedDuringCopy() {
        request.setSourceFilePath("/source/archive.zip");
        request.setTargetFileName("archive.bin");

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verifyNoInteractions(resources, qa);
    }

    @Test
    void anonymousAndLegacyOpenApiIdentityCannotCopy() {
        CurrentUserHolder.getLoginInfo().setUserId(0L);
        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(resources, qa);
    }

    @ParameterizedTest
    @ValueSource(strings = {"file", "directory"})
    void existingTargetFileOrDirectoryIsNeverOverwritten(String type) {
        targetEntries = List.of(entry("/dest/guide.md", type));

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verify(qa, never()).fileDownload(any(), anyLong());
        verify(qa, never()).importKnowledgeItem(any(), any());
        verify(qa, never()).deleteKnowledgeItem(any(), any());
    }

    @Test
    void sourceDirectoryCannotBeCopiedAsAFile() {
        sourceFile.setType("directory");

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verify(qa, never()).fileDownload(any(), anyLong());
        verify(qa, never()).importKnowledgeItem(any(), any());
    }

    @Test
    void missingTargetDirectoryFailsBeforeDownloading() {
        doReturn(failure("directory not found")).when(qa).listDir(any(), eq(200L));

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(BaseException.class).hasMessageContaining("directory not found");

        verify(qa, never()).fileDownload(any(), anyLong());
    }

    @Test
    void metadataSizeLimitRejectsBeforeDownloading() {
        ReflectionTestUtils.setField(service, "maxCopyFileSize", "3B");

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        verify(qa, never()).fileDownload(any(), anyLong());
    }

    @Test
    void enforcesActualDownloadSizeEvenIfMetadataIsWrongAndClosesTheStream() {
        ReflectionTestUtils.setField(service, "maxCopyFileSize", "3B");
        sourceFile.setSize(1L);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(IllegalArgumentException.class);

        assertThat(input.closed).isTrue();
        verify(qa, never()).importKnowledgeItem(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"envelope", "null", "empty", "item-failed", "wrong-path", "wrong-summary", "null-response"})
    void invalidOrFailedImportResultsCannotReportSuccessAndAlwaysCleanUp(String mode) {
        switch (mode) {
            case "envelope" -> imported = failure("target path already exists");
            case "null" -> imported.setResultObject(null);
            case "empty" -> imported.getResultObject().setData(List.of());
            case "item-failed" -> {
                imported.getResultObject().getData().get(0).setSuccess(false);
                imported.getResultObject().getData().get(0).setError("cannot store file");
            }
            case "wrong-path" -> imported.getResultObject().getData().get(0).setFilePath("/other.md");
            case "wrong-summary" -> imported.getResultObject().getSummary().setFailed(1);
            case "null-response" -> imported = null;
            default -> throw new IllegalArgumentException(mode);
        }

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of())).isInstanceOf(BaseException.class);

        ArgumentCaptor<KbFileImport> uploaded = ArgumentCaptor.forClass(KbFileImport.class);
        verify(qa).importKnowledgeItem(uploaded.capture(), any());
        assertThat(input.closed).isTrue();
        assertThatThrownBy(() -> uploaded.getValue().getMultipartFile().getInputStream()).isInstanceOf(IOException.class);
        verify(qa, never()).deleteKnowledgeItem(any(), any());
    }

    @Test
    void networkFailureDuringImportDoesNotLeaveAStagedFile() {
        when(qa.importKnowledgeItem(any(), any())).thenThrow(new BaseException("upload failed"));

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of())).hasMessage("upload failed");

        ArgumentCaptor<KbFileImport> uploaded = ArgumentCaptor.forClass(KbFileImport.class);
        verify(qa).importKnowledgeItem(uploaded.capture(), any());
        assertThatThrownBy(() -> uploaded.getValue().getMultipartFile().getInputStream()).isInstanceOf(IOException.class);
    }

    @Test
    void failedDownloadClosesItsStreamAndNeverStartsAnImport() throws Exception {
        AtomicBoolean closed = new AtomicBoolean();
        InputStream broken = new InputStream() {
            @Override public int read() throws IOException { throw new IOException("download interrupted"); }
            @Override public void close() { closed.set(true); }
        };
        when(qa.fileDownload(any(), anyLong())).thenReturn(broken);

        assertThatThrownBy(() -> service.copyKnowledgeFile(request, Map.of()))
            .isInstanceOf(BaseException.class).hasMessageContaining("download interrupted");

        assertThat(closed).isTrue();
        verify(qa, never()).importKnowledgeItem(any(), any());
    }

    @Test
    void preservesPostProcessingWarningsWithoutPretendingTheFileWasNotCreated() {
        imported.getResultObject().setPostProcessErrors(List.of("metadata callback delayed"));

        var result = service.copyKnowledgeFile(request, Map.of());

        assertThat(result.isSuccess()).isTrue();
        assertThat(result.getPostProcessErrors()).containsExactly("metadata callback delayed");
    }

    private SsResource resource(long id, String type, String code) {
        SsResource resource = new SsResource();
        resource.setResourceId(id);
        resource.setResourceBizType(type);
        resource.setResourceCode(code);
        resource.setOwnerType("enterprise");
        resource.setComAcctId(1L);
        resource.setResourceStatus(2);
        return resource;
    }

    private DirOrFile entry(String path, String type) {
        DirOrFile item = new DirOrFile();
        item.setName(path);
        item.setType(type);
        return item;
    }

    private KbImportResult importResult(String path) {
        KbImportResult result = new KbImportResult();
        KbImportResult.Item item = new KbImportResult.Item();
        item.setFilePath(path);
        item.setSuccess(true);
        result.setData(List.of(item));
        return result;
    }

    private <T> PythonBuildResponse<T> response(T value) {
        PythonBuildResponse<T> result = new PythonBuildResponse<>();
        result.setResultCode("0");
        result.setResultObject(value);
        return result;
    }

    private <T> PythonBuildResponse<T> failure(String message) {
        PythonBuildResponse<T> result = new PythonBuildResponse<>();
        result.setResultCode("-1");
        result.setResultMsg(message);
        return result;
    }

    private static final class TrackingInputStream extends ByteArrayInputStream {
        private boolean closed;

        TrackingInputStream(String value) { super(value.getBytes(StandardCharsets.UTF_8)); }

        @Override
        public void close() throws IOException {
            closed = true;
            super.close();
        }
    }
}
