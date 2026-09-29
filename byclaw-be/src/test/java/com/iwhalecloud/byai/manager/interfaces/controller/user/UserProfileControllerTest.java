package com.iwhalecloud.byai.manager.interfaces.controller.user;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.iwhalecloud.byai.manager.application.service.user.UserProfileApplicationService;
import com.iwhalecloud.byai.manager.dto.users.UserProfileResponse;
import com.iwhalecloud.byai.manager.dto.users.UserProfileUpdateRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.mockito.ArgumentCaptor;

class UserProfileControllerTest {

    @Test
    void updateProfileAcceptsFormWithoutAvatarFile() throws Exception {
        UserController controller = new UserController();
        UserProfileApplicationService service = mock(UserProfileApplicationService.class);
        ReflectionTestUtils.setField(controller, "userProfileApplicationService", service);
        when(service.updateProfile(any())).thenReturn(new UserProfileResponse("张三", "/avatars/current.png"));

        MockMvcBuilders.standaloneSetup(controller).build()
            .perform(multipart("/system/user/updateProfile").param("userName", "张三"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.userName").value("张三"))
            .andExpect(jsonPath("$.data.avatar").value("/avatars/current.png"));
        ArgumentCaptor<UserProfileUpdateRequest> request = ArgumentCaptor.forClass(UserProfileUpdateRequest.class);
        verify(service).updateProfile(request.capture());
        assertThat(request.getValue().getUserName()).isEqualTo("张三");
        assertThat(request.getValue().getAvatar()).isNull();
        assertThat(request.getValue().getAvatarFile()).isNull();
    }

    @Test
    void updateProfileAcceptsAvatarStringAndFileTogether() throws Exception {
        UserController controller = new UserController();
        UserProfileApplicationService service = mock(UserProfileApplicationService.class);
        ReflectionTestUtils.setField(controller, "userProfileApplicationService", service);
        MockMultipartFile file = new MockMultipartFile("avatarFile", "头像.png", "image/png", new byte[] {1});
        when(service.updateProfile(any())).thenReturn(new UserProfileResponse("张三", "/avatars/uploaded.png"));

        MockMvcBuilders.standaloneSetup(controller).build()
            .perform(multipart("/system/user/updateProfile").file(file)
                .param("userName", "张三").param("avatar", "/avatars/old.png"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.data.avatar").value("/avatars/uploaded.png"));
        ArgumentCaptor<UserProfileUpdateRequest> request = ArgumentCaptor.forClass(UserProfileUpdateRequest.class);
        verify(service).updateProfile(request.capture());
        assertThat(request.getValue().getAvatar()).isEqualTo("/avatars/old.png");
        assertThat(request.getValue().getAvatarFile()).isNotNull();
        assertThat(request.getValue().getAvatarFile().getBytes()).isEqualTo(file.getBytes());
    }

    @Test
    void updateProfileRejectsMissingUserName() throws Exception {
        MockMvcBuilders.standaloneSetup(new UserController()).build()
            .perform(multipart("/system/user/updateProfile").param("avatar", "/avatars/current.png"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void updateProfileRejectsInvalidUserName() throws Exception {
        MockMvcBuilders.standaloneSetup(new UserController()).build()
            .perform(multipart("/system/user/updateProfile").param("userName", "张 三"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void updateProfileRejectsOversizedAvatar() throws Exception {
        MockMvcBuilders.standaloneSetup(new UserController()).build()
            .perform(multipart("/system/user/updateProfile")
                .param("userName", "张三").param("avatar", "x".repeat(401)))
            .andExpect(status().isBadRequest());
    }

    @Test
    void updateProfileRejectsJsonBody() throws Exception {
        MockMvcBuilders.standaloneSetup(new UserController()).build()
            .perform(post("/system/user/updateProfile")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"userName\":\"张三\"}"))
            .andExpect(status().isUnsupportedMediaType());
    }
}
