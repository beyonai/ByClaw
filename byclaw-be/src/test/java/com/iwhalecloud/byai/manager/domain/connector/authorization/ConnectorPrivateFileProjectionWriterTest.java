package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConnectorPrivateFileProjectionWriterTest {

    @TempDir
    Path tempDir;

    @Test
    void replacesProjectionAtomicallyWithPrivatePermissions() throws Exception {
        Path target = Files.createDirectories(tempDir.resolve(".connector-auth/.model")).resolve("tts.json");
        Files.writeString(target, "old");
        ConnectorPrivateFileProjectionWriter writer = new ConnectorPrivateFileProjectionWriter();

        writer.write(target, "{\"revision\":\"new\"}");

        assertThat(Files.readString(target)).isEqualTo("{\"revision\":\"new\"}");
        if (Files.getFileAttributeView(target, java.nio.file.attribute.PosixFileAttributeView.class) != null) {
            assertThat(PosixFilePermissions.toString(Files.getPosixFilePermissions(target))).isEqualTo("rw-------");
        }
        try (var files = Files.list(target.getParent())) {
            assertThat(files.map(path -> path.getFileName().toString()).toList()).containsExactly("tts.json");
        }
    }

    @Test
    void rejectsSymbolicLinkTarget() throws Exception {
        Path directory = Files.createDirectories(tempDir.resolve(".connector-auth/.model"));
        Path outside = tempDir.resolve("outside.json");
        Files.writeString(outside, "outside");
        Path target = directory.resolve("tts.json");
        try {
            Files.createSymbolicLink(target, outside);
        } catch (UnsupportedOperationException e) {
            return;
        }
        ConnectorPrivateFileProjectionWriter writer = new ConnectorPrivateFileProjectionWriter();

        assertThatThrownBy(() -> writer.write(target, "secret"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("symbolic link");
        assertThat(Files.readString(outside)).isEqualTo("outside");
    }

    @Test
    void rejectsOversizedProjection() {
        Path target = tempDir.resolve("tts.json");
        ConnectorPrivateFileProjectionWriter writer = new ConnectorPrivateFileProjectionWriter();

        assertThatThrownBy(() -> writer.write(target, "x".repeat(64 * 1024 + 1)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("64 KiB");
    }
}
