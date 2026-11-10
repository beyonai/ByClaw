package com.iwhalecloud.byai.state.interfaces.controller.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserApplicationService;
import com.iwhalecloud.byai.state.application.service.upload.GlobalFileUploadValidator;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.ChangedFileDiffVo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

@ExtendWith(MockitoExtension.class)
class FileBrowserControllerTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    @Mock
    private FileBrowserApplicationService fileBrowserService;

    @Mock
    private ByaiSystemConfigService systemConfigService;

    private FileBrowserController controller;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);
        controller = new FileBrowserController();
        ReflectionTestUtils.setField(controller, "fileBrowserService", fileBrowserService);
        ReflectionTestUtils.setField(controller, "globalFileUploadValidator",
            new GlobalFileUploadValidator(systemConfigService));
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        org.springframework.context.i18n.LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void getChangedFileDiffDelegatesRequiredParameters() {
        ChangedFileDiffVo diff = new ChangedFileDiffVo();
        when(fileBrowserService.getChangedFileDiff("session-1", "file-1")).thenReturn(diff);

        ResponseUtil<ChangedFileDiffVo> response = controller.getChangedFileDiff("session-1", "file-1");

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).isSameAs(diff);
        verify(fileBrowserService).getChangedFileDiff("session-1", "file-1");
    }

    @Test
    void getChangedFileDiffRejectsBlankParameters() {
        try (var messages = new com.iwhalecloud.byai.common.i18n.I18nTestScope(java.util.Locale.SIMPLIFIED_CHINESE)) {
            org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.SIMPLIFIED_CHINESE);
            ResponseUtil<ChangedFileDiffVo> response = controller.getChangedFileDiff("", "file-1");

            assertThat(response.isSuccess()).isFalse();
            assertThat(response.getMsg()).isEqualTo("sessionId 不能为空");
            org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
            assertThat(controller.getChangedFileDiff("", "file-1").getMsg()).isEqualTo("sessionId is required");
            verify(fileBrowserService, never()).getChangedFileDiff("", "file-1");
        }
    }

    @Test
    void uploadRejectsTheWholeBatchBeforeWritingAnyFile() {
        when(systemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"maxFileSize\":512}");
        MultipartFile smallFile = mock(MultipartFile.class);
        MultipartFile largeFile = mock(MultipartFile.class);
        when(smallFile.getSize()).thenReturn(1L);
        when(largeFile.getSize()).thenReturn(512L * 1024 * 1024 + 1);

        ResponseUtil response = controller.upload(new MultipartFile[]{smallFile, largeFile}, 42L, "/by/.shared/");

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getMsg()).contains("512MB");
        verifyNoInteractions(fileBrowserService);
    }

    @Test
    void uploadAllowsExactLimitWithoutLimitingTheBatchTotal() throws Exception {
        when(systemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"maxFileSize\":512}");
        MultipartFile firstFile = mock(MultipartFile.class);
        MultipartFile secondFile = mock(MultipartFile.class);
        when(firstFile.getSize()).thenReturn(512L * 1024 * 1024);
        when(secondFile.getSize()).thenReturn(300L * 1024 * 1024);
        MultipartFile[] files = {firstFile, secondFile};

        ResponseUtil response = controller.upload(files, 42L, "/by/.shared/");

        assertThat(response.isSuccess()).isTrue();
        verify(fileBrowserService).upload("user001", 42L, "/by/.shared/", files);
    }
    @Test
    void uploadPreservesStructuredQuotaForTheGlobalHandler() throws Exception {
        MultipartFile file = mock(MultipartFile.class);
        MultipartFile[] files = {file};
        var failure = com.iwhalecloud.byai.state.common.exception.NasQuotaExceededException.from(
            java.util.Map.of("data", java.util.Map.of("errorType", "NAS_QUOTA_EXCEEDED", "quotaBytes", 1024L)));
        org.mockito.Mockito.doThrow(failure).when(fileBrowserService).upload("user001", 42L, "/", files);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.upload(files, 42L, "/"))
            .isSameAs(failure);
    }

    @Test
    void knowledgeCopyAlsoPreservesStructuredQuota() throws Exception {
        var transfer = mock(com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserKnowledgeTransferApplicationService.class);
        ReflectionTestUtils.setField(controller, "knowledgeTransferApplicationService", transfer);
        var request = new com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSaveToKnowledgeRequest();
        var failure = com.iwhalecloud.byai.state.common.exception.NasQuotaExceededException.from(
            java.util.Map.of("data", java.util.Map.of("errorType", "NAS_QUOTA_EXCEEDED")));
        when(transfer.saveToKnowledge("user001", request)).thenThrow(failure);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.saveToKnowledge(request)).isSameAs(failure);
    }

    @Test
    void rangeDownloadRelaysStatusAndClosesUpstreamWithoutUsingLegacyProvider() throws Exception {
        var transfers = mock(com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserTransferApplicationService.class);
        ReflectionTestUtils.setField(controller, "transfers", transfers);
        when(transfers.supportsRange()).thenReturn(true);
        var upstream = mock(feign.Response.class);
        var body = mock(feign.Response.Body.class);
        when(upstream.status()).thenReturn(206);
        when(upstream.headers()).thenReturn(java.util.Map.of("content-range", java.util.List.of("bytes 4-7/8"),
            "content-length", java.util.List.of("4"), "etag", java.util.List.of("\"v1\"")));
        when(upstream.body()).thenReturn(body);
        when(body.asInputStream()).thenReturn(new java.io.ByteArrayInputStream(new byte[]{4, 5, 6, 7}));
        when(transfers.download("user001", 42L, "/by/large.bin", "bytes=4-", "Mon, 02 Nov 2026 00:00:00 GMT")).thenReturn(upstream);
        var result = controller.download(42L, "/by/large.bin", "bytes=4-", "Mon, 02 Nov 2026 00:00:00 GMT");
        assertThat(result.getStatusCode().value()).isEqualTo(206);
        assertThat(result.getHeaders().getFirst("Content-Range")).isEqualTo("bytes 4-7/8");
        assertThat(result.getHeaders().getETag()).isEqualTo("\"v1\"");
        try (var input = result.getBody().getInputStream()) {
            assertThat(input.readAllBytes()).containsExactly(4, 5, 6, 7);
        }
        verify(upstream).close();
        verifyNoInteractions(fileBrowserService);
    }

    @Test
    void unsatisfiedRangeDoesNotFallBackToFullLegacyDownload() {
        var transfers = mock(com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserTransferApplicationService.class);
        ReflectionTestUtils.setField(controller, "transfers", transfers);
        when(transfers.supportsRange()).thenReturn(true);
        var upstream = mock(feign.Response.class);
        when(upstream.status()).thenReturn(416);
        when(upstream.headers()).thenReturn(java.util.Map.of("content-range", java.util.List.of("bytes */8"),"content-length",java.util.List.of("32")));
        when(transfers.download("user001", 42L, "/by/large.bin", "bytes=20-", null)).thenReturn(upstream);
        var result = controller.download(42L, "/by/large.bin", "bytes=20-", null);
        assertThat(result.getStatusCode().value()).isEqualTo(416);
        assertThat(result.getHeaders().getFirst("Content-Range")).isEqualTo("bytes */8");
        assertThat(result.getHeaders().getContentLength()).isEqualTo(0);
        verify(upstream).close();
        verifyNoInteractions(fileBrowserService);
    }

    @Test
    void uploadPreservesDetectedWriteConflictForTheGlobalHandler() throws Exception {
        MultipartFile file = mock(MultipartFile.class);
        MultipartFile[] files = {file};
        var failure = new com.iwhalecloud.byai.state.common.exception.StorageWriteConflictException(
            423, "file_write_in_progress");
        org.mockito.Mockito.doThrow(failure).when(fileBrowserService).upload("user001", 42L, "/", files);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.upload(files, 42L, "/"))
            .isSameAs(failure);
    }

}
