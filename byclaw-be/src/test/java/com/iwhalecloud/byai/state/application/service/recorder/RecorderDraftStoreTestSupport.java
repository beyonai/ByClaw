package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Comparator;
import java.util.Set;

public final class RecorderDraftStoreTestSupport {

    private RecorderDraftStoreTestSupport() {
    }

    public static RecorderDraftStore forFileRoot(Path fileRoot) {
        return new TestRecorderDraftStore(new RecorderBycliPathResolver(fileRoot));
    }

    private static final class TestRecorderDraftStore extends RecorderDraftStore {
        private static final Set<PosixFilePermission> DIRECTORY_PERMISSIONS = Set.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE,
            PosixFilePermission.OWNER_EXECUTE
        );
        private static final Set<PosixFilePermission> FILE_PERMISSIONS = Set.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE
        );

        private final RecorderBycliPathResolver resolver;

        private TestRecorderDraftStore(RecorderBycliPathResolver resolver) {
            super(resolver, (root, relative) -> {});
            this.resolver = resolver;
        }

        @Override
        public RecorderBycliPaths write(RecorderOwner owner, String sessionId, String draftId, String source) {
            RecorderBycliPaths paths = resolver.resolve(owner, sessionId, draftId);
            Path target = paths.backendPath();
            Path temporary = null;
            try {
                resolver.validateBackendPath(owner, target);
                Files.createDirectories(target.getParent());
                setPermissions(target.getParent(), DIRECTORY_PERMISSIONS);
                temporary = Files.createTempFile(target.getParent(), ".draft-", ".tmp");
                Files.writeString(temporary, source, StandardCharsets.UTF_8);
                setPermissions(temporary, FILE_PERMISSIONS);
                Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
                setPermissions(target, FILE_PERMISSIONS);
                return paths;
            } catch (AtomicMoveNotSupportedException e) {
                throw new RecorderSaveException("bycli_storage_unavailable", "atomic move unavailable", e);
            } catch (IOException e) {
                throw new RecorderSaveException("bycli_storage_unavailable", "test draft storage unavailable", e);
            } finally {
                if (temporary != null) {
                    try {
                        Files.deleteIfExists(temporary);
                    } catch (IOException ignored) {
                    }
                }
            }
        }

        @Override
        public void deleteSession(RecorderOwner owner, String sessionId) {
            Path directory = resolver.backendSessionDirectory(owner, sessionId);
            resolver.validateBackendPath(owner, directory);
            if (!Files.exists(directory)) {
                return;
            }
            try (var paths = Files.walk(directory)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) {
                    Files.deleteIfExists(path);
                }
            } catch (IOException e) {
                throw new RecorderSaveException("bycli_storage_unavailable", "test draft cleanup unavailable", e);
            }
        }

        private void setPermissions(Path path, Set<PosixFilePermission> permissions) {
            try {
                Files.setPosixFilePermissions(path, permissions);
            } catch (UnsupportedOperationException | IOException ignored) {
            }
        }
    }
}
