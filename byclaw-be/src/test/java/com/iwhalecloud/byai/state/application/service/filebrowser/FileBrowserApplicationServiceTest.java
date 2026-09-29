package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.impl.LocalStorageService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.ChangedFileDiffVo;

@ExtendWith(MockitoExtension.class)
class FileBrowserApplicationServiceTest {

    @Mock
    private FileBrowserProviderFactory providerFactory;

    @Mock
    private ByClawSkillResourceApplicationService skillResourceApplicationService;

    @Mock
    private UserFS userFS;

    private FileBrowserApplicationService service;

    @TempDir
    Path tempDir;

    @BeforeEach
    void setUp() {
        service = new FileBrowserApplicationService(providerFactory, skillResourceApplicationService, userFS,
            new ObjectMapper());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "/"})
    void renameSessionDirectoryMovesWholeTreeAfterPathNormalization(String trailingSlash) throws Exception {
        // 使用真实本地存储覆盖应用层去除目录斜杠后的完整调用链，防止再次留下空目录副本。
        LocalStorageService storage = new LocalStorageService();
        ReflectionTestUtils.setField(storage, "basePath", tempDir.toString());
        when(providerFactory.getProvider()).thenReturn(new MinioFileBrowserProvider(storage));
        Path session = tempDir.resolve("byclaw-adminvip/by/.sessions/20088980");
        Path source = session.resolve("wechat-analytics");
        Files.createDirectories(source.resolve("publish-data/empty"));
        Files.writeString(source.resolve("publish-data/report.md"), "report");

        service.rename("adminvip", 20044197L,
            "/by/.sessions/20088980/wechat-analytics" + trailingSlash, "wechat-analytics2");

        assertThat(source).doesNotExist();
        Path target = session.resolve("wechat-analytics2");
        assertThat(Files.readString(target.resolve("publish-data/report.md"))).isEqualTo("report");
        assertThat(target.resolve("publish-data/empty")).isDirectory();
        assertThat(service.list("adminvip", 20044197L, "/by/.sessions/20088980/", null))
            .extracting(item -> item.getName()).containsExactly("wechat-analytics2");
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "/"})
    void deleteSessionDirectoryRemovesContentsAfterPathNormalization(String trailingSlash) throws Exception {
        // 覆盖抓包中的无斜杠目录路径，以及带斜杠路径经过应用层规范化的情况。
        LocalStorageService storage = new LocalStorageService();
        ReflectionTestUtils.setField(storage, "basePath", tempDir.toString());
        when(providerFactory.getProvider()).thenReturn(new MinioFileBrowserProvider(storage));
        Path session = tempDir.resolve("byclaw-adminvip/by/.sessions/20088980");
        Path source = session.resolve("wechat-analytics");
        Files.createDirectories(source.resolve("publish-data/empty"));
        Files.writeString(source.resolve("publish-data/report.md"), "report");
        Files.createDirectories(session.resolve("wechat-analytics1"));

        service.delete("adminvip", 20044197L,
            List.of("/by/.sessions/20088980/wechat-analytics" + trailingSlash));

        assertThat(source).doesNotExist();
        assertThat(session.resolve("wechat-analytics1")).isDirectory();
        assertThat(service.list("adminvip", 20044197L, "/by/.sessions/20088980/", null))
            .extracting(item -> item.getName()).containsExactly("wechat-analytics1");
    }

    @Test
    void getChangedFileDiffReadsCurrentUserFileChangeSnapshot() {
        String json = """
            {
              "version": 1,
              "uuid": "4feccd51-76ae-48d9-9f08-2bcd6693b89a",
              "sessionId": "11194452",
              "filePath": "fibonacci.js",
              "changeType": "modified",
              "changed": true,
              "binary": false,
              "originalContent": "const value = 1;",
              "modifiedContent": "const value = 2;"
            }
            """;
        String path = "/by/.file_changes/11194452/files/4feccd51-76ae-48d9-9f08-2bcd6693b89a.json";
        when(userFS.read(path)).thenReturn(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));

        ChangedFileDiffVo result = service.getChangedFileDiff("11194452",
            "4feccd51-76ae-48d9-9f08-2bcd6693b89a");

        assertThat(result.getOriginalContent()).isEqualTo("const value = 1;");
        assertThat(result.getModifiedContent()).isEqualTo("const value = 2;");
        verify(userFS).read(path);
    }

    @Test
    void getChangedFileDiffRejectsUnsafePathSegments() {
        assertThatThrownBy(() -> service.getChangedFileDiff("../other", "file"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("sessionId is invalid");
    }

    @Test
    void getChangedFileDiffRejectsMismatchedSnapshotIdentity() {
        String json = "{\"uuid\":\"other\",\"sessionId\":\"11194452\"}";
        when(userFS.read("/by/.file_changes/11194452/files/requested.json"))
            .thenReturn(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));

        assertThatThrownBy(() -> service.getChangedFileDiff("11194452", "requested"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("文件变更详情与请求参数不匹配");
    }
}
