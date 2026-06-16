package com.iwhalecloud.byai.gateway.sandbox.workspace;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.workspace.model.SandboxFsInitContext;

/**
 * Initializes sandbox bootstrap files in workspace storage during sandbox launch.
 */
@Component
public class SandboxWorkspaceBootstrapInitializer {

    private static final Logger log = LoggerFactory.getLogger(SandboxWorkspaceBootstrapInitializer.class);
    private static final Set<PosixFilePermission> SHARED_DIR_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ,
        PosixFilePermission.OWNER_WRITE,
        PosixFilePermission.OWNER_EXECUTE,
        PosixFilePermission.GROUP_READ,
        PosixFilePermission.GROUP_WRITE,
        PosixFilePermission.GROUP_EXECUTE,
        PosixFilePermission.OTHERS_READ,
        PosixFilePermission.OTHERS_WRITE,
        PosixFilePermission.OTHERS_EXECUTE
    );

    private final UserFS userFS;

    public SandboxWorkspaceBootstrapInitializer(UserFS userFS) {
        this.userFS = userFS;
    }

    public void initialize(SandboxFsInitContext ctx) {
        String relativePath = resolveBootstrapRelativePath();
        prepareSharedWorkspaceDirectories(ctx);
        if (StringUtils.isNotBlank(ctx.getTemplateJson())) {
            byte[] jsonBytes = ctx.getTemplateJson().getBytes(StandardCharsets.UTF_8);
            writeBootstrapFile(ctx, "openclaw.json", jsonBytes, relativePath + "/openclaw.json");
        }
        else {
            log.warn("Template JSON is empty or null; skipping template upload");
        }

        if (ctx.getUserInfo() != null) {
            byte[] json = JSON.toJSONString(ctx.getUserInfo()).getBytes(StandardCharsets.UTF_8);
            writeBootstrapFile(ctx, "by_user_info.json", json, relativePath + "/identity/by_user_info.json");
        }
    }

    private String resolveBootstrapRelativePath() {
        return "/.openclaw";
    }

    private MultipartFile toMultipartFile(String filename, byte[] bytes) {
        return new ByteArrayMultipartFile(filename, bytes);
    }

    private void prepareSharedWorkspaceDirectories(SandboxFsInitContext ctx) {
        if (ctx == null || StringUtils.isBlank(ctx.getWorkspaceTargetPath())) {
            return;
        }
        Path workspaceRoot = Path.of(ctx.getWorkspaceTargetPath()).normalize();
        createSharedDirectory(workspaceRoot);
        createSharedDirectory(workspaceRoot.resolve(".sessions"));
    }

    private void createSharedDirectory(Path directory) {
        try {
            Files.createDirectories(directory);
            Files.setPosixFilePermissions(directory, SHARED_DIR_PERMISSIONS);
        }
        catch (UnsupportedOperationException e) {
            log.debug("POSIX permissions are not supported for sandbox workspace directory: {}", directory);
        }
        catch (IOException | RuntimeException e) {
            log.warn("Failed to prepare sandbox shared workspace directory: {}", directory, e);
        }
    }

    private void writeBootstrapFile(SandboxFsInitContext ctx, String filename, byte[] bytes, String relativeFilePath) {
        if (writeWorkspaceFile(ctx, bytes, relativeFilePath)) {
            return;
        }
        userFS.write(toMultipartFile(filename, bytes), relativeFilePath);
    }

    private boolean writeWorkspaceFile(SandboxFsInitContext ctx, byte[] bytes, String relativeFilePath) {
        if (ctx == null || StringUtils.isBlank(ctx.getWorkspaceTargetPath()) || bytes == null
            || StringUtils.isBlank(relativeFilePath)) {
            return false;
        }
        String normalizedRelativePath = StringUtils.stripStart(relativeFilePath, "/");
        Path target = Path.of(ctx.getWorkspaceTargetPath()).resolve(normalizedRelativePath).normalize();
        try {
            Files.createDirectories(target.getParent());
            Files.write(target, bytes);
            log.info("Sandbox bootstrap file written to mounted workspace: {}", target);
            return true;
        }
        catch (IOException | RuntimeException e) {
            log.warn("Failed to write sandbox bootstrap file to mounted workspace, fallback to UserFS. target={}",
                target, e);
            return false;
        }
    }

    private static final class ByteArrayMultipartFile implements MultipartFile {

        private final String filename;
        private final byte[] bytes;

        private ByteArrayMultipartFile(String filename, byte[] bytes) {
            this.filename = filename;
            this.bytes = bytes;
        }

        @Override
        public String getName() {
            return filename;
        }

        @Override
        public String getOriginalFilename() {
            return filename;
        }

        @Override
        public String getContentType() {
            return "application/json";
        }

        @Override
        public boolean isEmpty() {
            return bytes == null || bytes.length == 0;
        }

        @Override
        public long getSize() {
            return bytes == null ? 0L : bytes.length;
        }

        @Override
        public byte[] getBytes() {
            return bytes == null ? new byte[0] : bytes.clone();
        }

        @Override
        public ByteArrayInputStream getInputStream() {
            return new ByteArrayInputStream(getBytes());
        }

        @Override
        public void transferTo(java.io.File dest) {
            throw new UnsupportedOperationException("transferTo is not supported");
        }
    }
}
