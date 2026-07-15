package com.iwhalecloud.byai.state.interfaces.controller.chat;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.exception.StorageQuotaExceededException;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;

class AssistantChatControllerUploadTest {

    @Test
    void uploadFilesPropagatesQuotaExceptionToGlobalHandler() throws Exception {
        AssistantChatApplicationService applicationService = mock(AssistantChatApplicationService.class);
        AssistantChatController controller = new AssistantChatController();
        ReflectionTestUtils.setField(controller, "assistantChatApplicationService", applicationService);
        MultipartFile[] files = {
            new MockMultipartFile("files", "quota.txt", "text/plain", "quota".getBytes())
        };
        doThrow(new StorageQuotaExceededException("quota exceeded")).when(applicationService)
            .uploadFiles(any(MultipartFile[].class), isNull(), anyString(), isNull());

        assertThatThrownBy(() -> controller.uploadFiles(files, null, "SUPER_AGENT", null))
            .isInstanceOf(StorageQuotaExceededException.class)
            .hasMessage("quota exceeded");
    }
}
