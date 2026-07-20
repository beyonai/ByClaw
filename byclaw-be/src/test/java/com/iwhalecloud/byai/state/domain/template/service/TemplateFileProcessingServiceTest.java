package com.iwhalecloud.byai.state.domain.template.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.manager.dto.resource.UploadItem;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.session.dto.TemplateMessagesCopyRequestDto;
import feign.Request;
import feign.Response;
import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

@ExtendWith(MockitoExtension.class)
class TemplateFileProcessingServiceTest {

    private static final Long ORIGINAL_FILE_ID = 10011721L;

    private static final Long NEW_FILE_ID = 20023456L;

    private static final Long SESSION_ID = 30034567L;

    @Mock
    private FileService fileService;

    @Mock
    private AssistantChatApplicationService assistantChatApplicationService;

    private TemplateFileProcessingService processingService;

    @BeforeEach
    void setUp() {
        processingService = new TemplateFileProcessingService();
        ReflectionTestUtils.setField(processingService, "fileService", fileService);
        ReflectionTestUtils.setField(processingService, "assistantChatApplicationService",
            assistantChatApplicationService);
    }

    @Test
    void processFilesInMessages_downloadsAndReuploadsReferencedFile() throws Exception {
        byte[] content = "template attachment".getBytes(StandardCharsets.UTF_8);
        when(fileService.downloadFiles(any(OpenFileDownloadDTO.class))).thenReturn(downloadResponse(content));

        UploadItem uploadItem = new UploadItem();
        uploadItem.setFileId(NEW_FILE_ID);
        uploadItem.setFileName("report.xlsx");
        uploadItem.setFileUrl("/commonFile/preview?bucketName=new-bucket&filePath=new/report.xlsx");
        SessionUploadResult uploadResult = new SessionUploadResult();
        uploadResult.setSessionId(SESSION_ID);
        uploadResult.getUploadItems().add(uploadItem);
        when(assistantChatApplicationService.uploadFiles(any(MultipartFile[].class), eq(SESSION_ID), isNull(),
            isNull())).thenReturn(uploadResult);

        ByaiMessageHotDto message = new ByaiMessageHotDto();
        message.setMessageContent("attachment message");
        message.setRelatedResources("{\"fileId\":\"" + ORIGINAL_FILE_ID + "\"}");

        Map<String, TemplateMessagesCopyRequestDto.FileInfo> mappings = processingService
            .processFilesInMessages(List.of(message), String.valueOf(SESSION_ID));

        assertThat(mappings).containsOnlyKeys(String.valueOf(ORIGINAL_FILE_ID));
        TemplateMessagesCopyRequestDto.FileInfo mappedFile = mappings.get(String.valueOf(ORIGINAL_FILE_ID));
        assertThat(mappedFile.getFileId()).isEqualTo(String.valueOf(NEW_FILE_ID));
        assertThat(mappedFile.getFileName()).isEqualTo("report.xlsx");
        assertThat(mappedFile.getFileSize()).isEqualTo((long) content.length);
        assertThat(mappedFile.getFileUrl()).isEqualTo(uploadItem.getFileUrl());

        ArgumentCaptor<OpenFileDownloadDTO> downloadCaptor = ArgumentCaptor.forClass(OpenFileDownloadDTO.class);
        verify(fileService).downloadFiles(downloadCaptor.capture());
        assertThat(downloadCaptor.getValue().getFileId()).isEqualTo(ORIGINAL_FILE_ID);

        ArgumentCaptor<MultipartFile[]> uploadCaptor = ArgumentCaptor.forClass(MultipartFile[].class);
        verify(assistantChatApplicationService).uploadFiles(uploadCaptor.capture(), eq(SESSION_ID), isNull(), isNull());
        assertThat(uploadCaptor.getValue()).hasSize(1);
        assertThat(uploadCaptor.getValue()[0].getOriginalFilename()).endsWith("_report.xlsx");
        assertThat(uploadCaptor.getValue()[0].getBytes()).isEqualTo(content);
    }

    private Response downloadResponse(byte[] content) {
        Map<String, Collection<String>> headers = Map.of(
            "Content-Disposition", Collections.singletonList("attachment;filename=report.xlsx"),
            "Content-Type", Collections.singletonList("application/octet-stream"));
        return Response.builder().status(200).reason("OK").headers(headers).body(content)
            .request(Request.create(Request.HttpMethod.GET, "/files/download?fileId=" + ORIGINAL_FILE_ID,
                Collections.emptyMap(), null, null, null))
            .build();
    }
}
