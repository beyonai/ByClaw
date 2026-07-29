package com.iwhalecloud.byai.state.application.service.recorder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sun.jna.LastErrorException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;

@DisabledOnOs(OS.WINDOWS)
class LinuxRecorderDirectoryProvisionerTest {

    @Test
    void createsMissingDirectoriesRelativeToTrustedDirectoryDescriptors() throws Exception {
        FakeLibC libc = new FakeLibC();
        LinuxRecorderDirectoryProvisioner provisioner = new LinuxRecorderDirectoryProvisioner("Linux", () -> libc);

        provisioner.ensureDirectories(
            Path.of("/mnt/byclaw-file"),
            Path.of("byclaw-alice/by/.bycli/.recorder-drafts/session")
        );

        assertThat(libc.openedRoot).isEqualTo("/mnt/byclaw-file");
        assertThat(libc.rootFlags).isEqualTo(02600000);
        assertThat(libc.openatFlags).containsOnly(02600000);
        assertThat(libc.created).containsExactly(
            "byclaw-alice", "by", ".bycli", ".recorder-drafts", "session"
        );
        assertThat(libc.createdModes).containsOnly(0700);
        assertThat(libc.closed).hasSize(6);
    }

    @Test
    void symlinkOrUnsafeSegmentFailsClosedWithoutCreatingDirectories() {
        FakeLibC libc = new FakeLibC();
        libc.failSegment = "byclaw-alice";
        libc.failErrno = 40;
        LinuxRecorderDirectoryProvisioner provisioner = new LinuxRecorderDirectoryProvisioner("Linux", () -> libc);

        assertThatThrownBy(() -> provisioner.ensureDirectories(
            Path.of("/mnt/byclaw-file"),
            Path.of("byclaw-alice/by/.bycli/.recorder-drafts/session")
        )).isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(libc.created).isEmpty();
    }

    @Test
    void eexistRaceReopensWithNoFollowAndRejectsSymlinkWinner() {
        FakeLibC libc = new FakeLibC();
        libc.eexistSegment = "byclaw-alice";
        libc.reopenFailSegment = "byclaw-alice";
        LinuxRecorderDirectoryProvisioner provisioner = new LinuxRecorderDirectoryProvisioner("Linux", () -> libc);

        assertThatThrownBy(() -> provisioner.ensureDirectories(
            Path.of("/mnt/byclaw-file"),
            Path.of("byclaw-alice/by/.bycli/.recorder-drafts/session")
        )).isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(libc.mkdirAttempts).containsExactly("byclaw-alice");
        assertThat(libc.openatFlags).containsOnly(02600000);
        assertThat(libc.attempts.get("byclaw-alice")).isEqualTo(2);
    }

    @Test
    void unsupportedOperatingSystemFailsClosedBeforeLoadingLibc() {
        LinuxRecorderDirectoryProvisioner provisioner = new LinuxRecorderDirectoryProvisioner(
            "Mac OS X",
            () -> { throw new AssertionError("libc must not load"); }
        );

        assertThatThrownBy(() -> provisioner.ensureDirectories(Path.of("/tmp/root"), Path.of("owner/by")))
            .isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");
    }

    @Test
    void parentTraversalFailsClosedBeforeAnyNativeDirectoryCreation() {
        FakeLibC libc = new FakeLibC();
        LinuxRecorderDirectoryProvisioner provisioner = new LinuxRecorderDirectoryProvisioner("Linux", () -> libc);

        assertThatThrownBy(() -> provisioner.ensureDirectories(
            Path.of("/mnt/byclaw-file"),
            Path.of("owner/../other")
        )).isInstanceOf(RecorderSaveException.class)
            .hasFieldOrPropertyWithValue("code", "bycli_storage_unavailable");

        assertThat(libc.created).isEmpty();
    }

    @Test
    void atomicallyWritesDraftThroughTrustedDirectoryDescriptors() {
        FakeLibC libc = new FakeLibC();
        LinuxRecorderDirectoryProvisioner provisioner = new LinuxRecorderDirectoryProvisioner("Linux", () -> libc);

        provisioner.writeFileAtomically(
            Path.of("/mnt/byclaw-file"),
            Path.of("byclaw-alice/by/.bycli/.recorder-drafts/session"),
            "draft.js",
            "source"
        );

        assertThat(libc.written).isEqualTo("source");
        assertThat(libc.fsynced).isTrue();
        assertThat(libc.renamedFrom).startsWith(".draft-");
        assertThat(libc.renamedFrom).endsWith(".tmp");
        assertThat(libc.renamedTo).isEqualTo("draft.js");
    }

    private static final class FakeLibC implements LinuxRecorderDirectoryProvisioner.LibC {
        private final Map<String, Integer> attempts = new HashMap<>();
        private final List<String> created = new ArrayList<>();
        private final List<Integer> createdModes = new ArrayList<>();
        private final List<String> mkdirAttempts = new ArrayList<>();
        private final List<Integer> closed = new ArrayList<>();
        private final List<Integer> openatFlags = new ArrayList<>();
        private String written = "";
        private boolean fsynced;
        private String renamedFrom;
        private String renamedTo;
        private String openedRoot;
        private int rootFlags;
        private String failSegment;
        private int failErrno;
        private String eexistSegment;
        private String reopenFailSegment;
        private int nextFd = 10;

        @Override
        public int open(String path, int flags) {
            openedRoot = path;
            rootFlags = flags;
            return nextFd++;
        }

        @Override
        public int openat(int directoryFd, String path, int flags) {
            openatFlags.add(flags);
            int attempt = attempts.merge(path, 1, Integer::sum);
            if (path.equals(failSegment)) {
                throw new LastErrorException(failErrno);
            }
            if (path.equals(reopenFailSegment) && attempt > 1) {
                throw new LastErrorException(40);
            }
            if (attempt == 1) {
                throw new LastErrorException(2);
            }
            return nextFd++;
        }

        @Override
        public int openat(int directoryFd, String path, int flags, int mode) {
            return nextFd++;
        }

        @Override
        public int mkdirat(int directoryFd, String path, int mode) {
            mkdirAttempts.add(path);
            if (path.equals(eexistSegment)) {
                throw new LastErrorException(17);
            }
            created.add(path);
            createdModes.add(mode);
            return 0;
        }

        @Override
        public int close(int fd) {
            closed.add(fd);
            return 0;
        }

        @Override
        public int write(int fd, byte[] buffer, int count) {
            written += new String(buffer, 0, count, StandardCharsets.UTF_8);
            return count;
        }

        @Override
        public int fsync(int fd) {
            fsynced = true;
            return 0;
        }

        @Override
        public int renameat(int oldDirectoryFd, String oldPath, int newDirectoryFd, String newPath) {
            renamedFrom = oldPath;
            renamedTo = newPath;
            return 0;
        }

        @Override
        public int unlinkat(int directoryFd, String path, int flags) {
            return 0;
        }
    }
}
