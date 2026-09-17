package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.*;
import java.io.IOException;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;

@EnabledOnOs(OS.LINUX)
class LinuxMailDirectoryTest {
    @TempDir Path root;

    @Test
    void nativeLockWriteReadAtomicReplaceDeleteAndDescriptorCleanup() throws Exception {
        Path directory = privateDirectory("mail");
        long before = fdCount();
        for (int i = 0; i < 20; i++) {
            try (var anchor = open(directory); var lock = anchor.lock()) {
                try (var file = anchor.openPrivateTemp()) {
                    anchor.writeAndForce(file, "complete".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    anchor.moveAtomic(file, Path.of("qq-mail.json"));
                    anchor.validateIdentity(file, Path.of("qq-mail.json"));
                }
                assertThat(anchor.readPrivateIfExists(Path.of("qq-mail.json"), 64)).isEqualTo("complete".getBytes());
                assertThatThrownBy(() -> anchor.readPrivateIfExists(Path.of("qq-mail.json"), 3))
                    .isInstanceOf(IOException.class);
                anchor.deleteIfExists(Path.of("qq-mail.json"));
                anchor.deleteIfExists(Path.of("qq-mail.json"));
                assertThat(anchor.readPrivateIfExists(Path.of("qq-mail.json"), 64)).isNull();
            }
        }
        assertThat(fdCount()).isLessThanOrEqualTo(before);
    }

    @Test
    void rejectsSymlinksInsecureModesHardlinksAndTraversal() throws Exception {
        Path directory = privateDirectory("mail");
        Path external = Files.writeString(root.resolve("external"), "keep");
        Files.createSymbolicLink(directory.resolve("qq-mail.json"), external);
        try (var anchor = open(directory)) {
            assertThatThrownBy(() -> anchor.readPrivateIfExists(Path.of("qq-mail.json"), 64)).isInstanceOf(IOException.class);
            assertThatThrownBy(() -> anchor.deleteIfExists(Path.of("qq-mail.json"))).isInstanceOf(IOException.class);
            assertThatThrownBy(() -> anchor.readPrivateIfExists(Path.of("../external"), 64)).isInstanceOf(IOException.class);
            Files.delete(directory.resolve("qq-mail.json"));
            Files.writeString(directory.resolve("qq-mail.json"), "mode");
            Files.setPosixFilePermissions(directory.resolve("qq-mail.json"), PosixFilePermissions.fromString("rw-r--r--"));
            assertThatThrownBy(() -> anchor.deleteIfExists(Path.of("qq-mail.json"))).isInstanceOf(IOException.class);
            Files.setPosixFilePermissions(directory.resolve("qq-mail.json"), PosixFilePermissions.fromString("rw-------"));
            Files.createLink(directory.resolve("link"), directory.resolve("qq-mail.json"));
            assertThatThrownBy(() -> anchor.readPrivateIfExists(Path.of("qq-mail.json"), 64)).isInstanceOf(IOException.class);
        }
        assertThat(Files.readString(external)).isEqualTo("keep");
    }

    @Test
    void detectsParentReplacementBeforeAndAfterOpeningDescriptor() throws Exception {
        Path directory = privateDirectory("mail"), external = privateDirectory("external");
        var identity = identity(directory);
        try (var anchor = open(directory)) {
            Files.move(directory, root.resolve("old"));
            Files.createSymbolicLink(directory, external);
            assertThatThrownBy(anchor::openPrivateTemp).isInstanceOf(IOException.class);
            assertThatThrownBy(() -> LinuxMailDirectory.open(directory, identity,
                new MailAccountProjectionService.NioFileOperations(), java.nio.channels.FileChannel::write))
                .isInstanceOf(IOException.class);
        }
        try (var entries = Files.list(external)) { assertThat(entries.toList()).isEmpty(); }
    }

    @Test
    void lockSymlinkAndRenameTargetSymlinkFailWithoutDescriptorLeaks() throws Exception {
        Path directory = privateDirectory("mail");
        Path external = Files.writeString(root.resolve("external"), "keep");
        long before = fdCount();
        try (var anchor = open(directory)) {
            Files.createSymbolicLink(directory.resolve(".mail-projection.lock"), external);
            assertThatThrownBy(anchor::lock).isInstanceOf(IOException.class);
            Files.createSymbolicLink(directory.resolve("qq-mail.json"), external);
            try (var temp = anchor.openPrivateTemp()) {
                anchor.writeAndForce(temp, new byte[] { 1 });
                assertThatThrownBy(() -> anchor.moveAtomic(temp, Path.of("qq-mail.json"))).isInstanceOf(IOException.class);
                anchor.deleteIfExists(temp.path());
            }
        }
        assertThat(fdCount()).isLessThanOrEqualTo(before);
        assertThat(Files.readString(external)).isEqualTo("keep");
    }

    private Path privateDirectory(String name) throws Exception {
        return Files.createDirectory(root.resolve(name), PosixFilePermissions.asFileAttribute(
            PosixFilePermissions.fromString("rwx------")));
    }
    private LinuxMailDirectory open(Path path) throws Exception {
        return LinuxMailDirectory.open(path, identity(path), new MailAccountProjectionService.NioFileOperations(),
            java.nio.channels.FileChannel::write);
    }
    private MailAccountProjectionService.ParentIdentity identity(Path path) throws Exception {
        Map<String, Object> values = Files.readAttributes(path, "unix:dev,ino,fileKey", LinkOption.NOFOLLOW_LINKS);
        return new MailAccountProjectionService.ParentIdentity(values.get("fileKey"),
            ((Number) values.get("dev")).longValue(), ((Number) values.get("ino")).longValue());
    }
    private long fdCount() throws IOException {
        // Initialize the JDK random source before measuring native descriptor ownership.
        java.util.UUID.randomUUID();
        try (var files = Files.list(Path.of("/proc/self/fd"))) { return files.count(); }
    }
}
