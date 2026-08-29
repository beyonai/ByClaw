package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
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

    @BeforeEach
    void setUp() {
        service = new FileBrowserApplicationService(providerFactory, skillResourceApplicationService, userFS,
            new ObjectMapper());
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
