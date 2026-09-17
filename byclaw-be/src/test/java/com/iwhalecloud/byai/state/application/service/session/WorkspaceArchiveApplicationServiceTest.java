package com.iwhalecloud.byai.state.application.service.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.ArchiveFS;
import com.iwhalecloud.byai.state.domain.session.dto.WorkspaceArchiveDto;

@ExtendWith(MockitoExtension.class)
class WorkspaceArchiveApplicationServiceTest {

    @Mock
    private ArchiveFS archiveFS;

    @Mock
    private ObjectMapper objectMapper;

    @InjectMocks
    private WorkspaceArchiveApplicationService service;

    @BeforeEach
    void setUp() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        loginInfo.setUserCode("alice");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void status_rejectsWhenUserCodeMismatchCurrentUser() {
        assertThatThrownBy(() -> service.status("bob", 10081764L, "cancel_auth"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("无权访问");
    }

    @Test
    void status_rejectsWhenNotLoggedIn() {
        CurrentUserHolder.clearLoginInfo();

        assertThatThrownBy(() -> service.status("alice", 10081764L, "cancel_auth"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("无权访问");
    }

    @Test
    void status_allowsWhenUserCodeMatchesCurrentUser() {
        when(archiveFS.list(anyString(), anyInt())).thenReturn(Collections.emptyList());

        WorkspaceArchiveDto dto = service.status("alice", 10081764L, "cancel_auth");

        assertThat(dto.getUserCode()).isEqualTo("alice");
        assertThat(dto.getResourceId()).isEqualTo(10081764L);
        assertThat(dto.getExists()).isFalse();
        verify(archiveFS).init();
    }

    @Test
    void delete_rejectsMismatchedUserCode() {
        assertThatThrownBy(() -> service.delete("other", 1L, "delete"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("无权访问");
    }

    @Test
    void download_rejectsMismatchedUserCode() {
        assertThatThrownBy(() -> service.download("bob", 1L, "cancel_auth"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("无权访问");
    }
}
