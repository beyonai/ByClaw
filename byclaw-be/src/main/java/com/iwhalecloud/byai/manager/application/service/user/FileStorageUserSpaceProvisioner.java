package com.iwhalecloud.byai.manager.application.service.user;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Provisions per-user directories for mounted filesystem storage.
 */
@Service
public class FileStorageUserSpaceProvisioner {

    private static final String PRIVATE_WORKSPACE_DIR = "by";

    @Value("${file.storage.local.path:${byclaw.sandbox.volume.file-root:/tmp/byclaw-storage}}")
    private String fileRoot;

    public Path ensureUserSpace(String bucketOrRoot) {
        if (StringUtils.isBlank(bucketOrRoot)) {
            throw new IllegalArgumentException("User file storage root cannot be blank");
        }
        if (StringUtils.isBlank(fileRoot)) {
            throw new IllegalArgumentException("file.storage.local.path cannot be blank");
        }

        Path root = Path.of(fileRoot).normalize();
        if (!root.isAbsolute()) {
            throw new IllegalArgumentException("file.storage.local.path must be absolute: " + fileRoot);
        }

        Path userRoot = root.resolve(bucketOrRoot).normalize();
        if (!userRoot.startsWith(root)) {
            throw new IllegalArgumentException("Path traversal detected: " + bucketOrRoot);
        }

        Path privateWorkspace = userRoot.resolve(PRIVATE_WORKSPACE_DIR).normalize();
        try {
            Files.createDirectories(privateWorkspace);
            return privateWorkspace;
        }
        catch (IOException e) {
            throw new IllegalStateException("Create user file storage root failed: " + privateWorkspace, e);
        }
    }
}
