package com.iwhalecloud.byai.manager.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class GitWorkspaceConfigTest {

    @TempDir
    Path tempDir;

    @Test
    void resolvesAndCreatesProjectReposDirectory() {
        GitWorkspaceConfig config = new GitWorkspaceConfig();
        ReflectionTestUtils.setField(config, "fileStorageLocalPath", tempDir.toString());

        String root = config.getRoot(1001L, "byclaw-user001");

        assertThat(Path.of(root)).isEqualTo(tempDir.resolve("byclaw-user001/by/projects/1001/repos"));
        assertThat(Path.of(root)).isDirectory();
    }

    @Test
    void reportsProjectReposCreationFailure() throws IOException {
        GitWorkspaceConfig config = new GitWorkspaceConfig();
        ReflectionTestUtils.setField(config, "fileStorageLocalPath", tempDir.toString());
        Files.createDirectories(tempDir.resolve("byclaw-user001"));
        Files.createDirectories(tempDir.resolve("byclaw-user001/by"));
        Files.createFile(tempDir.resolve("byclaw-user001/by/projects"));

        assertThatThrownBy(() -> config.getRoot(1001L, "byclaw-user001"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Failed to create git workspace root")
            .hasCauseInstanceOf(IOException.class);
    }
}
