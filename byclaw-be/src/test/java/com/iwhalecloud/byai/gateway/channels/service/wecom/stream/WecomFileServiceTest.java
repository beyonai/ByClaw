package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomMsgType;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WecomFileServiceTest {

    private static final String IMAGE_URL = "https://ww-aibot-img-1258476243.cos.ap-guangzhou.myqcloud.com/EfXkjWE/7660046324382317372?sign=q-sign";

    @Test
    void downloadMessageFilesUsesUrlPathFileNameAndResponseContentType() throws Exception {
        AssistantChatApplicationService chatApplicationService = mock(AssistantChatApplicationService.class);
        WecomFileService service = serviceWithResponse(chatApplicationService, IMAGE_URL, "image/png");
        WecomCallbackMessage message = imageMessage(IMAGE_URL);
        AssistantChatDto chatDto = chatDto();

        service.downloadMessageFiles(message, chatDto);

        MultipartFile multipart = uploadedMultipart(chatApplicationService);
        assertThat(multipart.getOriginalFilename()).isEqualTo("7660046324382317372.png");
        assertThat(multipart.getContentType()).isEqualTo("image/png");
    }

    @Test
    void downloadMessageFilesFallsBackContentTypeFromMessageType() throws Exception {
        AssistantChatApplicationService chatApplicationService = mock(AssistantChatApplicationService.class);
        WecomFileService service = serviceWithResponse(chatApplicationService, IMAGE_URL, null);
        WecomCallbackMessage message = imageMessage(IMAGE_URL);
        AssistantChatDto chatDto = chatDto();

        service.downloadMessageFiles(message, chatDto);

        MultipartFile multipart = uploadedMultipart(chatApplicationService);
        assertThat(multipart.getOriginalFilename()).isEqualTo("7660046324382317372.png");
        assertThat(multipart.getContentType()).isEqualTo("image/png");
    }

    private WecomFileService serviceWithResponse(AssistantChatApplicationService chatApplicationService,
                                                 String url,
                                                 String contentType) throws Exception {
        when(chatApplicationService.uploadFiles(any(MultipartFile[].class), anyLong(), anyString(), anyLong()))
                .thenReturn(new SessionUploadResult());
        OkHttpClient httpClient = mock(OkHttpClient.class);
        Call call = mock(Call.class);
        when(httpClient.newCall(any(Request.class))).thenReturn(call);
        when(call.execute()).thenReturn(response(url, contentType));

        WecomFileService service = new WecomFileService(chatApplicationService);
        ReflectionTestUtils.setField(service, "httpClient", httpClient);
        return service;
    }

    private Response response(String url, String contentType) {
        ResponseBody body = ResponseBody.create(
                "plain image bytes".getBytes(),
                contentType == null ? null : MediaType.parse(contentType));
        Request request = new Request.Builder().url(url).build();
        return new Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body(body)
                .build();
    }

    private WecomCallbackMessage imageMessage(String url) {
        WecomCallbackMessage message = new WecomCallbackMessage();
        message.setMsgId("msg-001");
        message.setMsgType(WecomMsgType.IMAGE.getCode());
        message.setMediaUrl(url);
        return message;
    }

    private AssistantChatDto chatDto() {
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(100L);
        chatDto.setAgentId(200L);
        return chatDto;
    }

    private MultipartFile uploadedMultipart(AssistantChatApplicationService chatApplicationService) throws Exception {
        ArgumentCaptor<MultipartFile[]> captor = ArgumentCaptor.forClass(MultipartFile[].class);
        verify(chatApplicationService).uploadFiles(captor.capture(), anyLong(), anyString(), anyLong());
        return captor.getValue()[0];
    }
}
