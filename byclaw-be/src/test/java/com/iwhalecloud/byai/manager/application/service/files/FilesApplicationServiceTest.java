package com.iwhalecloud.byai.manager.application.service.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentMatcher;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.impl.WhaleAgentStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.manager.domain.customer.service.FilesService;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFilePathResolver;
import com.iwhalecloud.byai.manager.domain.file.service.CommonFileStorage;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.state.application.service.session.ByClawUserWorkspacePaths;

/**
 * 公共文件读写路径兼容测试：会话文件落在 UserFS 的 /by 根路径下，外部对象键不带 /by。
 */
class FilesApplicationServiceTest {

    private static final String BUCKET_NAME = "byclaw-0027003719";

    private static final String SESSION_FILE_PATH = "/.sessions/20079447/image(4).png";

    private static final String SESSION_FILE_URL = "/commonFile/preview?style=minio&bucketName=" + BUCKET_NAME
        + "&filePath=" + SESSION_FILE_PATH;

    private final FilesService filesService = mock(FilesService.class);

    private final CommonFileStorage commonFileStorage = mock(CommonFileStorage.class);

    private final FilesApplicationService filesApplicationService = new FilesApplicationService();

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(filesApplicationService, "filesService", filesService);
        ReflectionTestUtils.setField(filesApplicationService, "commonFileStorage", commonFileStorage);
        ReflectionTestUtils.setField(filesApplicationService, "commonFilePathResolver", new CommonFilePathResolver());
    }

    @Test
    void downloadFallsBackToUserFsRootPrefixWhenRawPathMissing() throws Exception {
        byte[] content = "image-bytes".getBytes(StandardCharsets.UTF_8);
        when(filesService.findById(20079507L)).thenReturn(sessionFiles(20079507L));
        doThrow(new IllegalStateException("object not exist")).when(commonFileStorage).read(any());
        doReturn(new ByteArrayInputStream(content)).when(commonFileStorage)
            .read(argThat(userFsLocation(WhaleAgentStorageService.SHARE_TYPE_PUBLIC)));

        MockHttpServletResponse response = new MockHttpServletResponse();
        filesApplicationService.download(response, 20079507L);

        assertThat(response.getContentAsByteArray()).isEqualTo(content);
        assertThat(response.getHeader("Content-Disposition"))
            .contains(URLEncoder.encode("image(4).png", StandardCharsets.UTF_8));
    }

    @Test
    void downloadReadsRawObjectPathWhenItExists() throws Exception {
        byte[] content = "image-bytes".getBytes(StandardCharsets.UTF_8);
        when(filesService.findById(20079507L)).thenReturn(sessionFiles(20079507L));
        when(commonFileStorage.read(any())).thenReturn(new ByteArrayInputStream(content));

        MockHttpServletResponse response = new MockHttpServletResponse();
        filesApplicationService.download(response, 20079507L);

        assertThat(response.getContentAsByteArray()).isEqualTo(content);
        verify(commonFileStorage, times(1)).read(any());
    }

    @Test
    void previewFallsBackToUserFsRootPrefixWhenRawPathMissing() throws Exception {
        byte[] content = "image-bytes".getBytes(StandardCharsets.UTF_8);
        doThrow(new IllegalStateException("object not exist")).when(commonFileStorage).read(any());
        doReturn(new ByteArrayInputStream(content)).when(commonFileStorage).read(argThat(userFsLocation("")));

        MockHttpServletResponse response = new MockHttpServletResponse();
        filesApplicationService.preview(response, "minio", BUCKET_NAME, SESSION_FILE_PATH);

        assertThat(response.getContentAsByteArray()).isEqualTo(content);
    }

    private static ArgumentMatcher<StorageLocation> userFsLocation(String shareType) {
        return location -> BUCKET_NAME.equals(location.getBucketOrRoot())
            && (ByClawUserWorkspacePaths.USER_FS_OBJECT_KEY_ROOT_PREFIX + SESSION_FILE_PATH).equals(location.getPath())
            && shareType.equals(location.getShareType());
    }

    private static Files sessionFiles(Long fileId) {
        Files files = new Files();
        files.setFileId(fileId);
        files.setFileName("image(4).png");
        files.setFileType(".png");
        files.setFileUrl(SESSION_FILE_URL);
        return files;
    }
}
