package com.iwhalecloud.byai.state.interfaces.controller.chat;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.state.application.service.chat.ChatFileArtifactApplicationService;
import com.iwhalecloud.byai.state.application.service.fs.FsOperationApplicationService.FsDownload;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ChatFileArtifactControllerTest {

    @Mock
    private ChatFileArtifactApplicationService applicationService;

    @Test
    void downloadUsesUtf8FileNameAndNoSniffHeader() throws Exception {
        StreamingResponseBody body = outputStream -> outputStream.write("pptx".getBytes(StandardCharsets.UTF_8));
        when(applicationService.download(101L, "/.sessions/101/output/团队周报.pptx"))
            .thenReturn(new FsDownload("团队周报.pptx", "application/octet-stream", body));
        ChatFileArtifactController controller = new ChatFileArtifactController(applicationService);

        ResponseEntity<StreamingResponseBody> response = controller.download(101L,
            "/.sessions/101/output/团队周报.pptx");

        assertThat(response.getHeaders().getFirst(HttpHeaders.CONTENT_DISPOSITION))
            .contains("filename*=UTF-8''%E5%9B%A2%E9%98%9F%E5%91%A8%E6%8A%A5.pptx");
        assertThat(response.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        response.getBody().writeTo(outputStream);
        assertThat(outputStream.toString(StandardCharsets.UTF_8)).isEqualTo("pptx");
    }
}
