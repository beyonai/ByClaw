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
}
