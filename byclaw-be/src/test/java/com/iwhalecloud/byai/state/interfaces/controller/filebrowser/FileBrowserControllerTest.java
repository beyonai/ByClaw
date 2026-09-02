package com.iwhalecloud.byai.state.interfaces.controller.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.filebrowser.FileBrowserApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.ChangedFileDiffVo;

@ExtendWith(MockitoExtension.class)
class FileBrowserControllerTest {

    @Mock
    private FileBrowserApplicationService fileBrowserService;

    private FileBrowserController controller;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);
        controller = new FileBrowserController();
        ReflectionTestUtils.setField(controller, "fileBrowserService", fileBrowserService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
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
        ResponseUtil<ChangedFileDiffVo> response = controller.getChangedFileDiff("", "file-1");

        assertThat(response.isSuccess()).isFalse();
        assertThat(response.getMsg()).isEqualTo("sessionId is required");
        verify(fileBrowserService, never()).getChangedFileDiff("", "file-1");
    }
}
