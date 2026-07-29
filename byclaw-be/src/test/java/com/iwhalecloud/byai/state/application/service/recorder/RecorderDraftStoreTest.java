package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.FileSystems;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
@DisabledOnOs(OS.WINDOWS)
class RecorderDraftStoreTest {

    @TempDir
    Path tempDir;

    @Test
    void writesUtf8AtomicallyToBackendPathAndReturnsPairedPaths() throws Exception {
        RecorderDraftStore store = RecorderDraftStoreTestSupport.forFileRoot(tempDir);
        RecorderOwner owner = new RecorderOwner(42L, "AbC_001");

        RecorderBycliPaths paths = store.write(owner, "session_1", "draft_0", "你好 source");

        assertThat(paths.backendPath()).isEqualTo(tempDir.resolve(
            "byclaw-AbC_001/by/.bycli/.recorder-drafts/session_1/draft_0.js"
        ));
        assertThat(paths.daemonPath()).isEqualTo(Path.of(
            "/by/.bycli/.recorder-drafts/session_1/draft_0.js"
        ));
        assertThat(Files.readString(paths.backendPath())).isEqualTo("你好 source");
    }

    @Test
    void sessionDirectoryAndDraftFileAreOwnerOnlyOnPosix() throws Exception {
        RecorderDraftStore store = RecorderDraftStoreTestSupport.forFileRoot(tempDir);

        Path draft = store.write(new RecorderOwner(1L, "alice"), "session-1", "draft-1", "source").backendPath();

        assertThat(draft.normalize()).startsWith(tempDir.toAbsolutePath().normalize());
        assertThat(draft.getFileName().toString()).endsWith(".js");
        if (FileSystems.getDefault().supportedFileAttributeViews().contains("posix")) {
            assertThat(Files.getPosixFilePermissions(draft.getParent())).isEqualTo(Set.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.OWNER_EXECUTE
            ));
            assertThat(Files.getPosixFilePermissions(draft)).isEqualTo(Set.of(
                PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE
            ));
        }
    }

    @Test
    void deleteSessionOnlyDeletesThatOwnersBackendDirectory() throws Exception {
        RecorderDraftStore store = RecorderDraftStoreTestSupport.forFileRoot(tempDir);
        RecorderOwner alice = new RecorderOwner(1L, "alice");
        RecorderOwner bob = new RecorderOwner(2L, "bob");
        RecorderBycliPaths alicePaths = store.write(alice, "shared-session", "draft", "alice");
        RecorderBycliPaths bobPaths = store.write(bob, "shared-session", "draft", "bob");

        store.deleteSession(alice, "shared-session");

        assertThat(alicePaths.backendPath()).doesNotExist();
        assertThat(bobPaths.backendPath()).exists();
        assertThat(alicePaths.daemonPath()).isEqualTo(bobPaths.daemonPath());
    }

    @Test
    void writeRejectsOwnerRootSymlinkThatEscapesFileRoot() throws Exception {
        Path fileRoot = tempDir.resolve("file-root");
        Path outside = tempDir.resolve("outside");
        Files.createDirectories(fileRoot);
        Files.createDirectories(outside);
        Files.createSymbolicLink(fileRoot.resolve("byclaw-alice"), outside);
        RecorderDraftStore store = RecorderDraftStoreTestSupport.forFileRoot(fileRoot);

        assertThatThrownBy(() -> store.write(new RecorderOwner(1L, "alice"), "session", "draft", "secret"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(outside.resolve("by/.bycli/.recorder-drafts/session/draft.js")).doesNotExist();
    }

    @Test
    void deleteSessionRejectsNestedSymlinkThatEscapesOwnerRoot() throws Exception {
        Path fileRoot = tempDir.resolve("file-root");
        Path recorderParent = fileRoot.resolve("byclaw-alice/by/.bycli");
        Path outside = tempDir.resolve("outside");
        Path outsideSession = outside.resolve("session");
        Files.createDirectories(recorderParent);
        Files.createDirectories(outsideSession);
        Path victim = outsideSession.resolve("victim.js");
        Files.writeString(victim, "keep");
        Files.createSymbolicLink(recorderParent.resolve(".recorder-drafts"), outside);
        RecorderDraftStore store = RecorderDraftStoreTestSupport.forFileRoot(fileRoot);

        assertThatThrownBy(() -> store.deleteSession(new RecorderOwner(1L, "alice"), "session"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(victim).exists();
    }

    @Test
    @EnabledOnOs(OS.LINUX)
    void secureWriteDoesNotFollowDirectorySwappedAfterValidation() throws Exception {
        Path fileRoot = tempDir.resolve("file-root");
        Path outside = tempDir.resolve("outside");
        Files.createDirectories(fileRoot);
        assumeSecureDirectoryStreams(fileRoot);
        Files.createDirectories(outside);
        Path recorderDrafts = fileRoot.resolve("byclaw-alice/by/.bycli/.recorder-drafts");
        AtomicBoolean swapped = new AtomicBoolean();
        RecorderDraftStore store = new RecorderDraftStore(
            new RecorderBycliPathResolver(fileRoot),
            SecureDirectoryStream::move,
            () -> swapForSymlink(recorderDrafts, outside, swapped),
            () -> {}
        );

        assertThatThrownBy(() -> store.write(new RecorderOwner(1L, "alice"), "session", "draft", "secret"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(swapped).isTrue();
        assertThat(outside.resolve("session/draft.js")).doesNotExist();
    }

    @Test
    @EnabledOnOs(OS.LINUX)
    void secureDeleteDoesNotFollowDirectorySwappedAfterValidation() throws Exception {
        Path fileRoot = tempDir.resolve("file-root");
        Path outside = tempDir.resolve("outside");
        Files.createDirectories(fileRoot);
        assumeSecureDirectoryStreams(fileRoot);
        Files.createDirectories(outside.resolve("session"));
        Path victim = outside.resolve("session/victim.js");
        Files.writeString(victim, "keep");
        Path recorderDrafts = fileRoot.resolve("byclaw-alice/by/.bycli/.recorder-drafts");
        AtomicBoolean swapped = new AtomicBoolean();
        RecorderDraftStore store = new RecorderDraftStore(
            new RecorderBycliPathResolver(fileRoot),
            SecureDirectoryStream::move,
            () -> {},
            () -> swapForSymlink(recorderDrafts, outside, swapped)
        );
        store.write(new RecorderOwner(1L, "alice"), "session", "draft", "source");

        assertThatThrownBy(() -> store.deleteSession(new RecorderOwner(1L, "alice"), "session"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(swapped).isTrue();
        assertThat(victim).exists();
    }

    @Test
    void atomicMoveUnsupportedFailsClosedWithoutPublishingDraft() throws Exception {
        Path fileRoot = tempDir.resolve("file-root");
        Files.createDirectories(fileRoot);
        assumeSecureDirectoryStreams(fileRoot);
        RecorderDraftStore store = new RecorderDraftStore(
            new RecorderBycliPathResolver(fileRoot),
            (source, sourcePath, target, targetPath) -> {
                throw new AtomicMoveNotSupportedException(sourcePath.toString(), targetPath.toString(), "unsupported");
            },
            () -> {},
            () -> {}
        );

        assertThatThrownBy(() -> store.write(new RecorderOwner(1L, "alice"), "session", "draft", "source"))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");
        assertThat(fileRoot.resolve("byclaw-alice/by/.bycli/.recorder-drafts/session/draft.js")).doesNotExist();
    }

    @Test
    void repeatedWriteAtomicallyReplacesExistingDraft() throws Exception {
        RecorderDraftStore store = RecorderDraftStoreTestSupport.forFileRoot(tempDir);
        RecorderOwner owner = new RecorderOwner(1L, "alice");
        store.write(owner, "session", "draft", "first");

        RecorderBycliPaths paths = store.write(owner, "session", "draft", "second");

        assertThat(Files.readString(paths.backendPath())).isEqualTo("second");
    }

    @Test
    @EnabledOnOs(OS.LINUX)
    void secureProviderAtomicallyReplacesExistingDraft() throws Exception {
        assumeSecureDirectoryStreams(tempDir);
        RecorderDraftStore store = new RecorderDraftStore(new RecorderBycliPathResolver(tempDir));
        RecorderOwner owner = new RecorderOwner(1L, "alice");
        store.write(owner, "session", "draft", "first");

        RecorderBycliPaths paths = store.write(owner, "session", "draft", "second");

        assertThat(Files.readString(paths.backendPath())).isEqualTo("second");
    }

    @Test
    @EnabledOnOs(OS.LINUX)
    void productionStoreWritesWhenProviderHasNoSecureDirectoryStreams() throws Exception {
        try (var stream = Files.newDirectoryStream(tempDir)) {
            Assumptions.assumeFalse(stream instanceof SecureDirectoryStream<?>);
        }
        RecorderDraftStore store = new RecorderDraftStore(new RecorderBycliPathResolver(tempDir));

        RecorderBycliPaths paths = store.write(new RecorderOwner(1L, "alice"), "session", "draft", "source");

        assertThat(Files.readString(paths.backendPath())).isEqualTo("source");
    }

    @Test
    void linuxProductionStoreCreatesWritesAndDeletesThroughSecureHandles() throws Exception {
        Assumptions.assumeTrue(System.getProperty("os.name").toLowerCase().contains("linux"));
        assumeSecureDirectoryStreams(tempDir);
        RecorderDraftStore store = new RecorderDraftStore(
            new RecorderBycliPathResolver(tempDir),
            new LinuxRecorderDirectoryProvisioner()
        );
        RecorderOwner owner = new RecorderOwner(1L, "alice");

        RecorderBycliPaths paths = store.write(owner, "session", "draft", "source");
        assertThat(Files.readString(paths.backendPath())).isEqualTo("source");

        store.deleteSession(owner, "session");
        assertThat(paths.backendPath()).doesNotExist();
        assertThat(paths.backendPath().getParent()).doesNotExist();
    }

    private void swapForSymlink(Path path, Path outside, AtomicBoolean swapped) {
        try {
            if (!Files.exists(path)) {
                return;
            }
            Files.move(path, path.resolveSibling(".recorder-drafts-safe"));
            Files.createSymbolicLink(path, outside);
            swapped.set(true);
        } catch (Exception e) {
            throw new AssertionError(e);
        }
    }

    private void assumeSecureDirectoryStreams(Path root) throws Exception {
        try (var stream = Files.newDirectoryStream(root)) {
            Assumptions.assumeTrue(stream instanceof SecureDirectoryStream<?>);
        }
    }
}
