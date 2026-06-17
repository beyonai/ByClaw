package com.iwhalecloud.byai.gateway.sandbox.workspace;

import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.workspace.model.SandboxFsInitContext;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
@DisabledOnOs(OS.WINDOWS)
class SandboxWorkspaceBootstrapInitializerTest {

    @TempDir
    java.nio.file.Path tempDir;

    @Test
    void initialize_writesTemplateJsonAndIdentity() {
        UserFS userFS = mock(UserFS.class);
        SandboxWorkspaceBootstrapInitializer initializer = new SandboxWorkspaceBootstrapInitializer(userFS);

        SandboxFsInitContext ctx = SandboxFsInitContext.builder()
            .userCode("user001")
            .templateJson("{}")
            .userInfo(Map.of("name", "Alice"))
            .build();

        initializer.initialize(ctx);

        verify(userFS).write(any(MultipartFile.class), eq("/.openclaw/openclaw.json"));
        verify(userFS).write(any(MultipartFile.class), eq("/.openclaw/identity/by_user_info.json"));
    }

    @Test
    void initialize_skipsTemplateUploadWhenTemplateJsonMissing() {
        UserFS userFS = mock(UserFS.class);
        SandboxWorkspaceBootstrapInitializer initializer = new SandboxWorkspaceBootstrapInitializer(userFS);

        SandboxFsInitContext ctx = SandboxFsInitContext.builder()
            .userCode("user001")
            .userInfo(Map.of("name", "Alice"))
            .build();

        initializer.initialize(ctx);

        verify(userFS, never()).write(any(MultipartFile.class), eq("/.openclaw/openclaw.json"));
        verify(userFS).write(any(MultipartFile.class), eq("/.openclaw/identity/by_user_info.json"));
    }

    @Test
    void initialize_writesMountedWorkspaceBeforeUserFsFallback() throws Exception {
        UserFS userFS = mock(UserFS.class);
        SandboxWorkspaceBootstrapInitializer initializer = new SandboxWorkspaceBootstrapInitializer(userFS);

        SandboxFsInitContext ctx = SandboxFsInitContext.builder()
            .userCode("user001")
            .workspaceTargetPath(tempDir.toString())
            .templateJson("{\"profile\":\"xs\"}")
            .userInfo(Map.of("name", "Alice"))
            .build();

        initializer.initialize(ctx);

        assertThat(tempDir.resolve(".openclaw/openclaw.json"))
            .hasContent("{\"profile\":\"xs\"}");
        assertThat(tempDir.resolve(".openclaw/identity/by_user_info.json"))
            .exists();
        assertThat(tempDir.resolve(".sessions"))
            .isDirectory();
        assertThat(Files.getPosixFilePermissions(tempDir.resolve(".sessions")))
            .containsAll(Set.of(
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.GROUP_WRITE,
                PosixFilePermission.OTHERS_WRITE));
        verify(userFS, never()).write(any(MultipartFile.class), any(String.class));
    }
}
