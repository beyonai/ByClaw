package com.iwhalecloud.byai.gateway.sandbox.workspace;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.workspace.model.SandboxFsInitContext;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class SandboxWorkspaceBootstrapInitializerTest {

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
}
