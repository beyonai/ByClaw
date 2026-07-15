package com.iwhalecloud.byai.state.interfaces.controller.storage;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.application.service.storage.UserStorageRecycleApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class UserStorageAdminControllerTest {

    @AfterEach
    void clearLoginInfo() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void platformManagerCanListRecyclePreviewFiles() {
        UserStorageRecycleApplicationService recycleService = mock(UserStorageRecycleApplicationService.class);
        when(recycleService.listPreviewFiles(7L, 11L, "/docs/")).thenReturn(List.of(new FileBrowserItemVo()));
        UserStorageAdminController controller = controller(recycleService);
        loginAs(UserType.PLAT_MAN);

        controller.recyclePreviewFiles(Map.of("userId", 7L, "recycleId", 11L, "path", "/docs/"));

        verify(recycleService).listPreviewFiles(7L, 11L, "/docs/");
    }

    @Test
    void ordinaryUserCannotListRecyclePreviewFiles() {
        UserStorageRecycleApplicationService recycleService = mock(UserStorageRecycleApplicationService.class);
        UserStorageAdminController controller = controller(recycleService);
        loginAs(UserType.ORD_USER);

        assertThatThrownBy(() -> controller.recyclePreviewFiles(
            Map.of("userId", 7L, "recycleId", 11L, "path", "/")))
            .isInstanceOf(AccessDeniedException.class)
            .hasMessageContaining("平台管理员");
        verifyNoInteractions(recycleService);
    }

    private UserStorageAdminController controller(UserStorageRecycleApplicationService recycleService) {
        UserStorageAdminController controller = new UserStorageAdminController();
        ReflectionTestUtils.setField(controller, "recycleService", recycleService);
        return controller;
    }

    private void loginAs(String userType) {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(userType);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(99L);
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }
}
