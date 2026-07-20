package com.iwhalecloud.byai.state.domain.file.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.file.FilesMapper;
import feign.Response;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class FileServiceTest {

    private static final Long FILE_ID = 10011721L;

    @Mock
    private FilesMapper filesMapper;

    @Mock
    private FilesApplicationService filesApplicationService;

    private FileService fileService;

    @BeforeEach
    void setUp() {
        fileService = new FileService();
        ReflectionTestUtils.setField(fileService, "filesMapper", filesMapper);
        ReflectionTestUtils.setField(fileService, "filesApplicationService", filesApplicationService);
    }

    @Test
    void downloadFiles_readsStoredFileAndBuildsDownloadResponse() throws Exception {
        byte[] content = "template attachment".getBytes(StandardCharsets.UTF_8);
        Files file = new Files();
        file.setFileId(FILE_ID);
        file.setFileName("report.xlsx");
        file.setFileUrl(
            "/commonFile/preview?style=minio&bucketName=byclaw-adminvip&filePath=chat/100/report.xlsx");
        when(filesMapper.selectById(FILE_ID)).thenReturn(file);
        when(filesApplicationService.openCommonFileInputStream("byclaw-adminvip", "chat/100/report.xlsx"))
            .thenReturn(new ByteArrayInputStream(content));

        OpenFileDownloadDTO request = new OpenFileDownloadDTO();
        request.setFileId(FILE_ID);

        try (Response response = fileService.downloadFiles(request)) {
            assertThat(response).isNotNull();
            assertThat(response.status()).isEqualTo(200);
            assertThat(response.headers().get("Content-Disposition"))
                .containsExactly("attachment;filename=report.xlsx");
            assertThat(response.body().asInputStream().readAllBytes()).isEqualTo(content);
        }

        verify(filesMapper).selectById(FILE_ID);
        verify(filesApplicationService).openCommonFileInputStream("byclaw-adminvip", "chat/100/report.xlsx");
    }

    @Test
    void downloadFiles_returnsNullWhenFileRecordDoesNotExist() {
        when(filesMapper.selectById(FILE_ID)).thenReturn(null);
        OpenFileDownloadDTO request = new OpenFileDownloadDTO();
        request.setFileId(FILE_ID);

        assertThat(fileService.downloadFiles(request)).isNull();
    }
}
