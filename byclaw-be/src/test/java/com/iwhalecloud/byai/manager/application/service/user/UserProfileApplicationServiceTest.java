package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.io.IOException;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.users.UserProfileResponse;
import com.iwhalecloud.byai.manager.dto.users.UserProfileUpdateRequest;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockMultipartFile;

class UserProfileApplicationServiceTest {

    private final UsersMapper mapper = mock(UsersMapper.class);
    private final UserAvatarApplicationService avatarService = mock(UserAvatarApplicationService.class);
    private final UserProfileApplicationService service = new UserProfileApplicationService(mapper, avatarService);
    private LoginInfo loginInfo;

    @BeforeEach
    void setUp() {
        if (TableInfoHelper.getTableInfo(Users.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), Users.class);
        }
        loginInfo = new LoginInfo();
        loginInfo.setUserId(1001L);
        loginInfo.setUserCode("tester");
        loginInfo.setUserName("旧名字");
        loginInfo.setAvatar("/avatars/old.png");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void updateChangesOnlyCurrentUsersNameAndSuppliedAvatar() throws Exception {
        activeUser();
        when(mapper.update(isNull(), any())).thenReturn(1);

        UserProfileResponse result = service.updateProfile(
            new UserProfileUpdateRequest("新名字", "/avatars/new.png"));

        assertThat(result).isEqualTo(new UserProfileResponse("新名字", "/avatars/new.png"));
        assertThat(loginInfo.getUserName()).isEqualTo("新名字");
        assertThat(loginInfo.getAvatar()).isEqualTo("/avatars/new.png");
        LambdaUpdateWrapper<Users> update = capturedUpdate();
        assertThat(update.getSqlSegment()).contains("user_id =", "state =");
        assertThat(update.getSqlSet()).contains("user_name=", "thumbnail_uri=", "update_date=")
            .doesNotContain("user_code", "pwd", "email", "phone", "org_id");
        assertThat(update.getParamNameValuePairs().values()).contains(1001L, "A", "新名字", "/avatars/new.png");
    }

    @Test
    void missingAvatarKeepsStoredAvatar() throws Exception {
        activeUser();
        when(mapper.update(isNull(), any())).thenReturn(1);

        UserProfileResponse result = service.updateProfile(new UserProfileUpdateRequest("新名字", null));

        assertThat(result.avatar()).isEqualTo("/avatars/old.png");
        assertThat(capturedUpdate().getSqlSet()).doesNotContain("thumbnail_uri=");
        verifyNoInteractions(avatarService);
    }

    @Test
    void blankAvatarAlsoKeepsStoredAvatar() throws Exception {
        activeUser();
        when(mapper.update(isNull(), any())).thenReturn(1);

        UserProfileResponse result = service.updateProfile(new UserProfileUpdateRequest("新名字", "  "));

        assertThat(result.avatar()).isEqualTo("/avatars/old.png");
        assertThat(capturedUpdate().getSqlSet()).doesNotContain("thumbnail_uri=");
    }

    @Test
    void missingLoginDoesNotReadOrUpdateAnyUser() {
        CurrentUserHolder.clearLoginInfo();

        assertThatThrownBy(() -> service.updateProfile(new UserProfileUpdateRequest("新名字", null)))
            .isInstanceOf(BaseException.class);
        verifyNoInteractions(mapper);
    }

    @Test
    void disabledUserCannotUpdateProfile() {
        Users user = new Users();
        user.setState("X");
        when(mapper.selectById(1001L)).thenReturn(user);

        assertThatThrownBy(() -> service.updateProfile(new UserProfileUpdateRequest("新名字", null)))
            .isInstanceOf(BaseException.class);
        assertThat(loginInfo.getUserName()).isEqualTo("旧名字");
    }

    @Test
    void failedUpdateDoesNotChangeLoginSnapshot() {
        activeUser();
        when(mapper.update(isNull(), any())).thenReturn(0);

        assertThatThrownBy(() -> service.updateProfile(
            new UserProfileUpdateRequest("新名字", "/avatars/new.png")))
            .isInstanceOf(BaseException.class);
        assertThat(loginInfo.getUserName()).isEqualTo("旧名字");
        assertThat(loginInfo.getAvatar()).isEqualTo("/avatars/old.png");
    }

    @Test
    void avatarFileOverridesAvatarStringAndUsesOneProfileUpdate() throws Exception {
        activeUser();
        when(mapper.update(isNull(), any())).thenReturn(1);
        MockMultipartFile file = new MockMultipartFile("avatarFile", "头像.png", "image/png", new byte[] {1, 2});
        when(avatarService.storeAvatar(file)).thenReturn("/avatars/uploaded.png");
        UserProfileUpdateRequest request = new UserProfileUpdateRequest("新名字", "/avatars/string.png");
        request.setAvatarFile(file);

        UserProfileResponse result = service.updateProfile(request);

        assertThat(result).isEqualTo(new UserProfileResponse("新名字", "/avatars/uploaded.png"));
        verify(avatarService).storeAvatar(file);
        assertThat(capturedUpdate().getParamNameValuePairs().values())
            .contains("/avatars/uploaded.png").doesNotContain("/avatars/string.png");
    }

    @Test
    void failedAvatarUploadDoesNotUpdateProfile() throws Exception {
        activeUser();
        MockMultipartFile file = new MockMultipartFile("avatarFile", "头像.png", "image/png", new byte[] {1});
        when(avatarService.storeAvatar(file)).thenThrow(new IOException("storage unavailable"));
        UserProfileUpdateRequest request = new UserProfileUpdateRequest("新名字", null);
        request.setAvatarFile(file);

        assertThatThrownBy(() -> service.updateProfile(request)).isInstanceOf(IOException.class);
        verify(mapper, never()).update(isNull(), any());
        assertThat(loginInfo.getUserName()).isEqualTo("旧名字");
    }

    @Test
    void emptyAvatarFileKeepsSavedAvatar() throws Exception {
        activeUser();
        when(mapper.update(isNull(), any())).thenReturn(1);
        UserProfileUpdateRequest request = new UserProfileUpdateRequest("新名字", null);
        request.setAvatarFile(new MockMultipartFile("avatarFile", "", "image/png", new byte[0]));

        assertThat(service.updateProfile(request).avatar()).isEqualTo("/avatars/old.png");
        verifyNoInteractions(avatarService);
        assertThat(capturedUpdate().getSqlSet()).doesNotContain("thumbnail_uri=");
    }

    private void activeUser() {
        Users user = new Users();
        user.setUserId(1001L);
        user.setState("A");
        user.setAvatar("/avatars/old.png");
        when(mapper.selectById(1001L)).thenReturn(user);
    }

    private LambdaUpdateWrapper<Users> capturedUpdate() {
        ArgumentCaptor<LambdaUpdateWrapper<Users>> captor = ArgumentCaptor.forClass(LambdaUpdateWrapper.class);
        verify(mapper).update(isNull(), captor.capture());
        return captor.getValue();
    }
}
