package com.iwhalecloud.byai.manager.interfaces.controller.user;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;

import com.iwhalecloud.byai.manager.application.service.user.UserAvatarApplicationService;
import com.iwhalecloud.byai.manager.interfaces.controller.files.FilesController;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

/**
 * 用户头像上传必须由用户接口接收 multipart 文件。
 */
class UserAvatarControllerTest {

    @Test
    void uploadAvatarRequiresFilePart() throws Exception {
        MockMvcBuilders.standaloneSetup(new UserController()).build()
            .perform(multipart("/system/user/uploadAvatar"))
            .andExpect(status().isBadRequest());
    }

    @Test
    void uploadAvatarReturnsSavedUrlInData() throws Exception {
        UserController controller = new UserController();
        UserAvatarApplicationService service = mock(UserAvatarApplicationService.class);
        ReflectionTestUtils.setField(controller, "userAvatarApplicationService", service);
        MockMultipartFile file = new MockMultipartFile("file", "头像.png", "image/png", new byte[] {1});
        String url = "/commonFile/preview?style=minio&bucketName=byai-icon&filePath=/user/avatar.png";
        when(service.uploadAvatar(file)).thenReturn(url);

        MockMvcBuilders.standaloneSetup(controller).build()
            .perform(multipart("/system/user/uploadAvatar").file(file))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data").value(url));
        verify(service).uploadAvatar(file);
    }

    @Test
    void commonFileDoesNotExposeUserAvatarUpload() throws Exception {
        MockMvcBuilders.standaloneSetup(new FilesController()).build()
            .perform(multipart("/commonFile/uploadUserAvatar"))
            .andExpect(status().isNotFound());
    }
}
