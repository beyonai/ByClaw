package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.state.domain.recorder.model.RecorderOwner;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class RecorderBycliPathResolver {

    private static final Path DAEMON_ROOT = Path.of("/by/.bycli");
    private static final String STORAGE_ERROR = "bycli_storage_unavailable";

    private final SandboxProperties sandboxProperties;
    private final Path explicitFileRoot;

    @Autowired
    public RecorderBycliPathResolver(SandboxProperties sandboxProperties) {
        this.sandboxProperties = sandboxProperties;
        this.explicitFileRoot = null;
    }

    RecorderBycliPathResolver(Path fileRoot) {
        this.sandboxProperties = null;
        this.explicitFileRoot = fileRoot;
    }

    public RecorderBycliPaths resolve(RecorderOwner owner, String sessionId, String draftId) {
        if (owner == null) {
            throw unavailable("recorder owner is required");
        }
        String userCode = safeSegment(owner.userCode(), "userCode");
        String safeSessionId = safeSegment(sessionId, "sessionId");
        String safeDraftId = safeSegment(draftId, "draftId");
        Path hostRoot = hostRoot();
        Path backendRoot = hostRoot.resolve("byclaw-" + userCode).resolve("by/.bycli").normalize();
        Path daemonRoot = DAEMON_ROOT.normalize();
        Path backendPath = backendRoot.resolve(".recorder-drafts").resolve(safeSessionId).resolve(safeDraftId + ".js").normalize();
        Path daemonPath = daemonRoot.resolve(".recorder-drafts").resolve(safeSessionId).resolve(safeDraftId + ".js").normalize();
        if (!backendPath.startsWith(backendRoot) || !daemonPath.startsWith(daemonRoot)) {
            throw unavailable("recorder draft path escapes bycli storage");
        }
        return new RecorderBycliPaths(backendPath, daemonPath);
    }

    Path backendSessionDirectory(RecorderOwner owner, String sessionId) {
        return resolve(owner, sessionId, "draft").backendPath().getParent();
    }

    Path fileRoot() {
        return hostRoot();
    }

    void validateBackendPath(RecorderOwner owner, Path backendPath) {
        if (owner == null || backendPath == null) {
            throw unavailable("recorder backend path and owner are required");
        }
        String userCode = safeSegment(owner.userCode(), "userCode");
        Path configuredRoot = hostRoot();
        Path ownerRoot = configuredRoot.resolve("byclaw-" + userCode).normalize();
        Path normalizedPath = backendPath.toAbsolutePath().normalize();
        if (!ownerRoot.startsWith(configuredRoot) || !normalizedPath.startsWith(ownerRoot)) {
            throw unavailable("recorder backend path escapes configured storage");
        }
        try {
            Path realConfiguredRoot = projectedRealPath(configuredRoot);
            Path realOwnerRoot = projectedRealPath(ownerRoot);
            Path realBackendPath = projectedRealPath(normalizedPath);
            if (!realOwnerRoot.startsWith(realConfiguredRoot) || !realBackendPath.startsWith(realOwnerRoot)) {
                throw unavailable("recorder backend path escapes physical storage");
            }
        } catch (IOException | SecurityException e) {
            throw new RecorderSaveException(STORAGE_ERROR, "cannot verify recorder backend storage", e);
        }
    }

    private Path hostRoot() {
        String configured = sandboxProperties == null ? null : sandboxProperties.getVolume().getFileRoot();
        try {
            Path root = explicitFileRoot != null ? explicitFileRoot : configured == null ? null : Path.of(configured);
            if (root == null || !root.isAbsolute()) {
                throw unavailable("absolute sandbox volume fileRoot is required");
            }
            return root.normalize();
        } catch (InvalidPathException e) {
            throw new RecorderSaveException(STORAGE_ERROR, "invalid sandbox volume fileRoot", e);
        }
    }

    private Path projectedRealPath(Path path) throws IOException {
        Path normalized = path.toAbsolutePath().normalize();
        Path existingAncestor = normalized;
        while (existingAncestor != null && !Files.exists(existingAncestor, LinkOption.NOFOLLOW_LINKS)) {
            existingAncestor = existingAncestor.getParent();
        }
        if (existingAncestor == null) {
            throw new IOException("no existing ancestor for recorder storage path");
        }
        Path realAncestor = existingAncestor.toRealPath();
        return realAncestor.resolve(existingAncestor.relativize(normalized)).normalize();
    }

    private String safeSegment(String value, String field) {
        if (value == null || value.isBlank() || ".".equals(value) || "..".equals(value)) {
            throw unavailable(field + " is not a safe path segment");
        }
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            if (character == '/' || character == '\\' || Character.isISOControl(character)) {
                throw unavailable(field + " is not a safe path segment");
            }
        }
        try {
            Path segment = Path.of(value);
            if (segment.isAbsolute() || segment.getNameCount() != 1) {
                throw unavailable(field + " is not a safe path segment");
            }
        } catch (InvalidPathException e) {
            throw new RecorderSaveException(STORAGE_ERROR, field + " is not a safe path segment", e);
        }
        return value;
    }

    private RecorderSaveException unavailable(String message) {
        return new RecorderSaveException(STORAGE_ERROR, message);
    }
}
