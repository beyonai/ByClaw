package com.iwhalecloud.byai.state.application.service.recorder;

import com.sun.jna.Library;
import com.sun.jna.LastErrorException;
import com.sun.jna.Native;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Locale;
import java.util.UUID;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

@Component
public class LinuxRecorderDirectoryProvisioner implements RecorderDirectoryProvisioner {

    private static final Logger log = LoggerFactory.getLogger(LinuxRecorderDirectoryProvisioner.class);

    private static final int O_RDONLY = 0;
    private static final int O_WRONLY = 1;
    private static final int O_CREAT = 0100;
    private static final int O_EXCL = 0200;
    private static final int O_DIRECTORY = 00200000;
    private static final int O_NOFOLLOW = 00400000;
    private static final int O_CLOEXEC = 02000000;
    private static final int DIRECTORY_OPEN_FLAGS = O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC;
    private static final int TEMPORARY_FILE_OPEN_FLAGS = O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC;
    private static final int OWNER_DIRECTORY_MODE = 0700;
    private static final int OWNER_FILE_MODE = 0600;
    private static final int ENOENT = 2;
    private static final int EEXIST = 17;

    private final boolean linux;
    private final Supplier<LibC> libcSupplier;

    public LinuxRecorderDirectoryProvisioner() {
        this(System.getProperty("os.name"), () -> Native.load("c", LibC.class));
    }

    LinuxRecorderDirectoryProvisioner(String osName, Supplier<LibC> libcSupplier) {
        this.linux = osName != null && osName.toLowerCase(Locale.ROOT).contains("linux");
        this.libcSupplier = libcSupplier;
    }

    @Override
    public void ensureDirectories(Path fileRoot, Path relativeDirectory) {
        if (!linux) {
            throw unavailable("secure recorder directory creation requires Linux");
        }
        if (fileRoot == null || !fileRoot.isAbsolute() || relativeDirectory == null || relativeDirectory.isAbsolute()) {
            throw unavailable("invalid recorder directory path");
        }
        LibC libc;
        try {
            libc = libcSupplier.get();
        } catch (RuntimeException | LinkageError e) {
            throw new RecorderSaveException("bycli_storage_unavailable", "native recorder storage unavailable", e);
        }
        int currentFd = openRoot(libc, fileRoot);
        try {
            for (Path rawSegment : relativeDirectory) {
                if (".".equals(rawSegment.toString()) || "..".equals(rawSegment.toString())) {
                    throw unavailable("invalid recorder directory segment");
                }
            }
            for (Path segmentPath : relativeDirectory.normalize()) {
                String segment = segmentPath.toString();
                if (segment.isBlank() || ".".equals(segment) || "..".equals(segment)) {
                    throw unavailable("invalid recorder directory segment");
                }
                int nextFd = openOrCreateDirectory(libc, currentFd, segment);
                closeOnce(libc, currentFd);
                currentFd = nextFd;
            }
        } finally {
            closeOnce(libc, currentFd);
        }
    }

    void writeFileAtomically(Path fileRoot, Path relativeDirectory, String targetName, String source) {
        if (!linux || fileRoot == null || !fileRoot.isAbsolute() || relativeDirectory == null || relativeDirectory.isAbsolute()
            || targetName == null || targetName.isBlank() || targetName.contains("/") || targetName.contains("\\")) {
            throw unavailable("invalid recorder file path");
        }
        LibC libc;
        try {
            libc = libcSupplier.get();
        } catch (RuntimeException | LinkageError e) {
            throw new RecorderSaveException("bycli_storage_unavailable", "native recorder storage unavailable", e);
        }
        ensureDirectories(fileRoot, relativeDirectory);
        int directoryFd = openRoot(libc, fileRoot);
        String temporaryName = ".draft-" + UUID.randomUUID() + ".tmp";
        boolean temporaryCreated = false;
        try {
            for (Path segmentPath : relativeDirectory.normalize()) {
                String segment = segmentPath.toString();
                if (segment.isBlank() || ".".equals(segment) || "..".equals(segment)) {
                    throw unavailable("invalid recorder directory segment");
                }
                int nextFd = requireOpened(libc.openat(directoryFd, segment, DIRECTORY_OPEN_FLAGS));
                closeOnce(libc, directoryFd);
                directoryFd = nextFd;
            }
            int fileFd = requireOpened(libc.openat(directoryFd, temporaryName, TEMPORARY_FILE_OPEN_FLAGS, OWNER_FILE_MODE));
            temporaryCreated = true;
            try {
                byte[] bytes = source.getBytes(StandardCharsets.UTF_8);
                int offset = 0;
                while (offset < bytes.length) {
                    byte[] remaining = java.util.Arrays.copyOfRange(bytes, offset, bytes.length);
                    int written = libc.write(fileFd, remaining, remaining.length);
                    if (written <= 0) {
                        throw unavailable("cannot write recorder draft securely");
                    }
                    offset += written;
                }
                libc.fsync(fileFd);
            } finally {
                closeOnce(libc, fileFd);
            }
            if (libc.renameat(directoryFd, temporaryName, directoryFd, targetName) < 0) {
                throw unavailable("cannot publish recorder draft securely");
            }
            temporaryCreated = false;
        } catch (LastErrorException e) {
            throw unavailable("cannot write recorder draft securely");
        } finally {
            if (temporaryCreated) {
                try {
                    libc.unlinkat(directoryFd, temporaryName, 0);
                } catch (LastErrorException e) {
                    log.warn("Failed to remove temporary recorder draft");
                }
            }
            closeOnce(libc, directoryFd);
        }
    }

    private int openRoot(LibC libc, Path fileRoot) {
        try {
            int fd = libc.open(fileRoot.toString(), DIRECTORY_OPEN_FLAGS);
            if (fd < 0) {
                throw unavailable("cannot open recorder storage root securely");
            }
            return fd;
        } catch (LastErrorException e) {
            throw unavailable("cannot open recorder storage root securely");
        }
    }

    private int openOrCreateDirectory(LibC libc, int parentFd, String segment) {
        try {
            return requireOpened(libc.openat(parentFd, segment, DIRECTORY_OPEN_FLAGS));
        } catch (LastErrorException openFailure) {
            if (openFailure.getErrorCode() != ENOENT) {
                throw unavailable("unsafe recorder directory path");
            }
            createDirectory(libc, parentFd, segment);
            try {
                return requireOpened(libc.openat(parentFd, segment, DIRECTORY_OPEN_FLAGS));
            } catch (LastErrorException reopenFailure) {
                throw unavailable("unsafe recorder directory path");
            }
        }
    }

    private void createDirectory(LibC libc, int parentFd, String segment) {
        try {
            if (libc.mkdirat(parentFd, segment, OWNER_DIRECTORY_MODE) < 0) {
                throw unavailable("cannot create recorder directory securely");
            }
        } catch (LastErrorException e) {
            if (e.getErrorCode() != EEXIST) {
                throw unavailable("cannot create recorder directory securely");
            }
        }
    }

    private int requireOpened(int fd) {
        if (fd < 0) {
            throw unavailable("unsafe recorder directory path");
        }
        return fd;
    }

    private void closeOnce(LibC libc, int fd) {
        try {
            libc.close(fd);
        } catch (LastErrorException e) {
            log.warn("Failed to close recorder directory handle");
        }
    }

    private RecorderSaveException unavailable(String message) {
        return new RecorderSaveException("bycli_storage_unavailable", message);
    }

    interface LibC extends Library {
        int open(String path, int flags) throws LastErrorException;

        int openat(int directoryFd, String path, int flags) throws LastErrorException;

        int openat(int directoryFd, String path, int flags, int mode) throws LastErrorException;

        int mkdirat(int directoryFd, String path, int mode) throws LastErrorException;

        int close(int fd) throws LastErrorException;

        int write(int fd, byte[] buffer, int count) throws LastErrorException;

        int fsync(int fd) throws LastErrorException;

        int renameat(int oldDirectoryFd, String oldPath, int newDirectoryFd, String newPath) throws LastErrorException;

        int unlinkat(int directoryFd, String path, int flags) throws LastErrorException;
    }
}
