package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.SeekableByteChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.OpenOption;
import java.nio.file.Path;
import java.nio.file.SecureDirectoryStream;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.BasicFileAttributeView;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class RecorderDraftStore {

    private static final Set<PosixFilePermission> FILE_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ,
        PosixFilePermission.OWNER_WRITE
    );
    private static final Set<OpenOption> TEMPORARY_FILE_OPTIONS = Set.of(
        StandardOpenOption.CREATE_NEW,
        StandardOpenOption.WRITE,
        LinkOption.NOFOLLOW_LINKS
    );

    private final RecorderBycliPathResolver pathResolver;
    private final RecorderDirectoryProvisioner directoryProvisioner;
    private final SecureMove secureMove;
    private final Runnable beforeSecureWrite;
    private final Runnable beforeSecureDelete;

    @Autowired
    public RecorderDraftStore(
        RecorderBycliPathResolver pathResolver,
        RecorderDirectoryProvisioner directoryProvisioner
    ) {
        this(pathResolver, directoryProvisioner, SecureDirectoryStream::move, () -> {}, () -> {});
    }

    RecorderDraftStore(RecorderBycliPathResolver pathResolver) {
        this(pathResolver, new LinuxRecorderDirectoryProvisioner());
    }

    RecorderDraftStore(
        RecorderBycliPathResolver pathResolver,
        SecureMove secureMove,
        Runnable beforeSecureWrite,
        Runnable beforeSecureDelete
    ) {
        this(pathResolver, new LinuxRecorderDirectoryProvisioner(), secureMove, beforeSecureWrite, beforeSecureDelete);
    }

    RecorderDraftStore(
        RecorderBycliPathResolver pathResolver,
        RecorderDirectoryProvisioner directoryProvisioner,
        SecureMove secureMove,
        Runnable beforeSecureWrite,
        Runnable beforeSecureDelete
    ) {
        this.pathResolver = pathResolver;
        this.directoryProvisioner = directoryProvisioner;
        this.secureMove = secureMove;
        this.beforeSecureWrite = beforeSecureWrite;
        this.beforeSecureDelete = beforeSecureDelete;
    }

    public RecorderBycliPaths write(RecorderOwner owner, String sessionId, String draftId, String source) {
        RecorderBycliPaths paths = pathResolver.resolve(owner, sessionId, draftId);
        Path target = paths.backendPath();
        Path directory = target.getParent();
        try {
            pathResolver.validateBackendPath(owner, target);
            Path fileRoot = pathResolver.fileRoot();
            directoryProvisioner.ensureDirectories(fileRoot, fileRoot.relativize(directory));
            beforeSecureWrite.run();
            writeWithSecureHandle(owner, target, source);
            return paths;
        } catch (RecorderSaveException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            throw unavailable("failed to write recorder draft", e);
        }
    }

    public void deleteSession(RecorderOwner owner, String sessionId) {
        Path sessionDirectory = pathResolver.backendSessionDirectory(owner, sessionId);
        pathResolver.validateBackendPath(owner, sessionDirectory);
        beforeSecureDelete.run();
        try {
            deleteWithSecureHandle(owner, sessionDirectory);
        } catch (NoSuchFileException ignored) {
            // An already removed session is a successful cleanup.
        } catch (IOException | RuntimeException e) {
            throw unavailable("failed to delete recorder drafts", e);
        }
    }

    private void writeWithSecureHandle(RecorderOwner owner, Path target, String source) throws IOException {
        Path directory = target.getParent();
        String temporaryName = ".draft-" + UUID.randomUUID() + ".tmp";
        Path temporary = Path.of(temporaryName);
        Path targetName = target.getFileName();
        try (SecurePath securePath = openSecurePath(owner, directory)) {
            SecureDirectoryStream<Path> secureDirectory = securePath.directory();
            try {
                writeTemporary(secureDirectory, temporary, source);
                try {
                    secureMove.move(secureDirectory, temporary, secureDirectory, targetName);
                } catch (AtomicMoveNotSupportedException e) {
                    throw unavailable("atomic recorder draft move is unavailable", e);
                }
                setPermissions(secureDirectory, targetName, FILE_PERMISSIONS);
            } finally {
                deleteTemporary(secureDirectory, temporary);
            }
        }
    }

    private void writeTemporary(SecureDirectoryStream<Path> directory, Path temporary, String source) throws IOException {
        byte[] content = source.getBytes(StandardCharsets.UTF_8);
        try (SeekableByteChannel channel = directory.newByteChannel(temporary, TEMPORARY_FILE_OPTIONS)) {
            setPermissions(directory, temporary, FILE_PERMISSIONS);
            ByteBuffer buffer = ByteBuffer.wrap(content);
            while (buffer.hasRemaining()) {
                channel.write(buffer);
            }
        }
    }

    private void deleteWithSecureHandle(RecorderOwner owner, Path sessionDirectory) throws IOException {
        Path recorderDrafts = sessionDirectory.getParent();
        Path sessionName = sessionDirectory.getFileName();
        try (SecurePath securePath = openSecurePath(owner, recorderDrafts)) {
            SecureDirectoryStream<Path> parent = securePath.directory();
            try (SecureDirectoryStream<Path> session = parent.newDirectoryStream(sessionName, LinkOption.NOFOLLOW_LINKS)) {
                deleteContents(session);
            }
            parent.deleteDirectory(sessionName);
        }
    }

    private void deleteContents(SecureDirectoryStream<Path> directory) throws IOException {
        for (Path entry : directory) {
            Path name = entry.getFileName();
            BasicFileAttributeView view = directory.getFileAttributeView(
                name,
                BasicFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS
            );
            BasicFileAttributes attributes = view.readAttributes();
            if (attributes.isDirectory()) {
                try (SecureDirectoryStream<Path> child = directory.newDirectoryStream(name, LinkOption.NOFOLLOW_LINKS)) {
                    deleteContents(child);
                }
                directory.deleteDirectory(name);
            } else {
                directory.deleteFile(name);
            }
        }
    }

    private SecurePath openSecurePath(RecorderOwner owner, Path directory) throws IOException {
        Path fileRoot = pathResolver.fileRoot();
        pathResolver.validateBackendPath(owner, directory);
        DirectoryStream<Path> rootStream = Files.newDirectoryStream(fileRoot);
        if (!(rootStream instanceof SecureDirectoryStream<?> rawSecureRoot)) {
            rootStream.close();
            throw unavailable("secure recorder storage handles are unavailable", null);
        }
        @SuppressWarnings("unchecked")
        SecureDirectoryStream<Path> secureRoot = (SecureDirectoryStream<Path>) rawSecureRoot;
        List<DirectoryStream<Path>> opened = new ArrayList<>();
        opened.add(secureRoot);
        SecureDirectoryStream<Path> current = secureRoot;
        try {
            Path relative = fileRoot.relativize(directory.toAbsolutePath().normalize());
            for (Path segment : relative) {
                SecureDirectoryStream<Path> next = current.newDirectoryStream(segment, LinkOption.NOFOLLOW_LINKS);
                opened.add(next);
                current = next;
            }
            return new SecurePath(opened, current);
        } catch (IOException | RuntimeException e) {
            closeAll(opened);
            throw e;
        }
    }

    private void deleteTemporary(SecureDirectoryStream<Path> directory, Path temporary) {
        try {
            directory.deleteFile(temporary);
        } catch (NoSuchFileException ignored) {
            // The atomic move consumed the temporary file.
        } catch (IOException ignored) {
            // The secure directory handle prevents cleanup from escaping its directory.
        }
    }

    private void setPermissions(
        SecureDirectoryStream<Path> directory,
        Path path,
        Set<PosixFilePermission> permissions
    ) {
        try {
            PosixFileAttributeView view = directory.getFileAttributeView(
                path,
                PosixFileAttributeView.class,
                LinkOption.NOFOLLOW_LINKS
            );
            if (view != null) {
                view.setPermissions(permissions);
            }
        } catch (UnsupportedOperationException | IOException ignored) {
            // Owner-only permissions are best effort on non-POSIX filesystems.
        }
    }

    private RecorderSaveException unavailable(String message, Throwable cause) {
        return new RecorderSaveException("bycli_storage_unavailable", message, cause);
    }

    private static void closeAll(List<DirectoryStream<Path>> streams) {
        for (int index = streams.size() - 1; index >= 0; index--) {
            try {
                streams.get(index).close();
            } catch (IOException ignored) {
                // Preserve the original failure.
            }
        }
    }

    @FunctionalInterface
    interface SecureMove {
        void move(
            SecureDirectoryStream<Path> sourceDirectory,
            Path sourcePath,
            SecureDirectoryStream<Path> targetDirectory,
            Path targetPath
        ) throws IOException;
    }

    private record SecurePath(
        List<DirectoryStream<Path>> streams,
        SecureDirectoryStream<Path> directory
    ) implements AutoCloseable {

        @Override
        public void close() {
            closeAll(streams);
        }
    }
}
