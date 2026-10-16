package com.iwhalecloud.byai.state.application.service.filebrowser;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.DatasetBuild;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSaveToKnowledgeRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class FileBrowserKnowledgeTransferApplicationServiceTest {
    private final FileBrowserApplicationService files = mock(FileBrowserApplicationService.class);
    private final DatasetApplicationService datasets = mock(DatasetApplicationService.class);
    private final SsResourceService resources = mock(SsResourceService.class);
    private final AuthApplicationService auth = mock(AuthApplicationService.class);
    private final FileBrowserKnowledgeTransferApplicationService service =
        new FileBrowserKnowledgeTransferApplicationService(files, datasets, resources, auth);
    private final SsResource target = new SsResource();
    private Object previousMessages;

    @BeforeEach
    void setup() {
        previousMessages = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messages = new StaticMessageSource();
        messages.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        target.setResourceId(20L);
        target.setOwnerType("personal");
        target.setResourceBizType("KG_DOC");
        target.setResourceStatus(2);
        when(resources.findById(20L)).thenReturn(target);
        when(auth.hasResourceManagePermission(target)).thenReturn(true);
    }

    @AfterEach
    void cleanup() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessages);
    }

    @Test
    void localizesRequiredSourceResourceForTheRequestLocale() {
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("i18n.messages");
        messages.setDefaultEncoding("UTF-8");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        Locale previousLocale = LocaleContextHolder.getLocale();
        try {
            var invalid = request("/session/report.md");
            invalid.setResourceId(null);
            LocaleContextHolder.setLocale(Locale.US);
            assertThatThrownBy(() -> service.saveToKnowledge("alice", invalid))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("resourceId is required");
            LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
            assertThatThrownBy(() -> service.saveToKnowledge("alice", invalid))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("resourceId 不能为空");
        } finally {
            LocaleContextHolder.setLocale(previousLocale);
        }
    }

    @Test
    void rejectsEnterpriseCloudDeletedAndUnmanagedTargetsBeforeReadingSource() {
        for (String owner : List.of("enterprise", "unknown")) {
            target.setOwnerType(owner);
            assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/report.md")))
                .isInstanceOf(IllegalArgumentException.class);
        }
        target.setOwnerType("personal");
        target.setResourceBizType("KG_CLOUD");
        assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/report.md")))
            .isInstanceOf(IllegalArgumentException.class);
        target.setResourceBizType("KG_DOC");
        target.setResourceStatus(-1);
        assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/report.md")))
            .isInstanceOf(IllegalArgumentException.class);
        target.setResourceStatus(2);
        when(auth.hasResourceManagePermission(target)).thenReturn(false);
        assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/report.md")))
            .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(files, datasets);
    }

    @Test
    void importsDefaultPersonalFileAndBuildsTheReturnedPathWithOverwriteOptions() throws Exception {
        target.setOwnerType("personal_default");
        source("/session/report.md", false);
        UploadResult imported = imported("/chosen/canonical-report.md");
        when(datasets.uploadFiles(any(), eq(20L), eq("/chosen"), anyString(), eq(true), eq(true), eq(false), anyMap()))
            .thenReturn(imported);
        var request = request("/session/report.md");
        request.setOverwrite(true);
        request.setProcessFrontMatter(true);
        var result = service.saveToPersonalKnowledge("alice", request);
        assertThat(result.getUploadedFileCount()).isEqualTo(1);
        assertThat(result.getBuildSubmittedCount()).isEqualTo(1);
        ArgumentCaptor<DatasetBuild> build = ArgumentCaptor.forClass(DatasetBuild.class);
        verify(datasets).build(build.capture(), anyMap());
        assertThat(build.getValue().getDirectoryPath()).isEqualTo("/chosen/canonical-report.md");
        assertThat(build.getValue().getResourceId()).isEqualTo(20L);
    }

    @Test
    void preservesNestedAndEmptyFoldersAndContinuesAfterAFileFails() throws Exception {
        source("/session/reports", true);
        when(files.listForTransfer("alice", 10L, "/session/reports/"))
            .thenReturn(List.of(item("/session/reports/bad.md", false), item("/session/reports/sub", true)));
        when(files.download("alice", 10L, "/session/reports/bad.md"))
            .thenThrow(new IllegalStateException("read failed"));
        when(files.listForTransfer("alice", 10L, "/session/reports/sub/"))
            .thenReturn(List.of(item("/session/reports/sub/good.md", false), item("/session/reports/sub/empty", true)));
        when(files.download("alice", 10L, "/session/reports/sub/good.md"))
            .thenReturn(new ByteArrayInputStream(new byte[]{1}));
        when(datasets.uploadFiles(any(), eq(20L), eq("/chosen/reports/sub"), anyString(), anyBoolean(), anyBoolean(), eq(false), anyMap()))
            .thenReturn(imported("/chosen/reports/sub/good.md"));
        var result = service.saveToPersonalKnowledge("alice", request("/session/reports"));
        assertThat(result.getCreatedFolderCount()).isEqualTo(3);
        assertThat(result.getUploadedFileCount()).isEqualTo(1);
        assertThat(result.getBuildSubmittedCount()).isEqualTo(1);
        assertThat(result.getFailedItems()).extracting(UploadItem::getFilePath).containsExactly("/session/reports/bad.md");
    }

    @Test
    void reportsImportAndBuildFailuresSeparatelyAndKeepsPostProcessWarnings() throws Exception {
        source("/session/bundle.zip", false);
        UploadResult imported = imported("/chosen/a.md");
        UploadItem failed = new UploadItem();
        failed.setFilePath("/chosen/b.exe");
        failed.setError("unsupported");
        imported.getFailedItems().add(failed);
        imported.getPostProcessErrors().add("metadata failed");
        when(datasets.uploadFiles(any(), anyLong(), anyString(), anyString(), anyBoolean(), anyBoolean(), eq(false), anyMap()))
            .thenReturn(imported);
        doThrow(new IllegalStateException("build service unavailable")).when(datasets).build(any(), anyMap());
        var result = service.saveToPersonalKnowledge("alice", request("/session/bundle.zip"));
        assertThat(result.getUploadedFileCount()).isEqualTo(1);
        assertThat(result.getBuildSubmittedCount()).isZero();
        assertThat(result.getFailedItems()).containsExactly(failed);
        assertThat(result.getBuildFailedItems()).extracting(UploadItem::getFilePath).containsExactly("/chosen/a.md");
        assertThat(result.getPostProcessErrors()).containsExactly("metadata failed");
        verify(datasets, times(1)).build(any(), anyMap());
    }

    @Test
    void refusesMissingSourcesAndTraversalBeforeWriting() {
        assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/missing.md")))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/../private.md")))
            .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(datasets);
    }

    @Test
    void directoryReadFailuresAreNotReportedAsEmptyFolderSuccess() {
        source("/session/reports", true);
        when(files.listForTransfer("alice", 10L, "/session/reports/"))
            .thenThrow(new IllegalStateException("sandbox unavailable"));
        assertThatThrownBy(() -> service.saveToPersonalKnowledge("alice", request("/session/reports")))
            .isInstanceOf(IllegalStateException.class);
        verify(datasets, never()).build(any(), anyMap());
    }

    @Test
    void legacySaveDoesNotStartBuilds() throws Exception {
        when(files.download("alice", 10L, "/session/report.md"))
            .thenReturn(new ByteArrayInputStream(new byte[]{1}));
        when(datasets.uploadFiles(any(), anyLong(), anyString(), anyString(), anyBoolean(), anyBoolean(), eq(false), anyMap()))
            .thenReturn(imported("/chosen/report.md"));
        service.saveToKnowledge("alice", request("/session/report.md"));
        verify(datasets, never()).build(any(), anyMap());
    }

    private void source(String path, boolean directory) {
        when(files.listForTransfer("alice", 10L, "/session/")).thenReturn(List.of(item(path, directory)));
        if (!directory) when(files.download("alice", 10L, path))
            .thenReturn(new ByteArrayInputStream(new byte[]{1}));
    }

    private FileBrowserItemVo item(String path, boolean directory) {
        FileBrowserItemVo item = new FileBrowserItemVo();
        item.setPath(path);
        item.setName(path.substring(path.lastIndexOf('/') + 1));
        item.setDir(directory);
        return item;
    }

    private UploadResult imported(String path) {
        UploadResult result = new UploadResult();
        UploadItem item = new UploadItem();
        item.setFilePath(path);
        item.setSuccess(true);
        result.getUploadItems().add(item);
        return result;
    }

    private FileBrowserSaveToKnowledgeRequest request(String path) {
        FileBrowserSaveToKnowledgeRequest request = new FileBrowserSaveToKnowledgeRequest();
        request.setResourceId(10L);
        request.setTargetResourceId(20L);
        request.setSourcePath(path);
        request.setSourceDir(false);
        request.setTargetDirectoryPath("/chosen");
        return request;
    }
}
