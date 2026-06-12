package com.iwhalecloud.byai.gateway.sandbox.config;

import java.nio.file.Path;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SandboxVolumeBackendValidator implements ApplicationRunner {

    private static final Logger LOGGER = LoggerFactory.getLogger(SandboxVolumeBackendValidator.class);

    private final SandboxProperties sandboxProperties;

    @Value("${byclaw.sandbox.jdbc.enabled:true}")
    private boolean sandboxEnabled;

    public SandboxVolumeBackendValidator(SandboxProperties sandboxProperties) {
        this.sandboxProperties = sandboxProperties;
    }

    @Override
    public void run(ApplicationArguments args) {
        validate();
    }

    public void validate() {
        if (!sandboxEnabled) {
            LOGGER.info("Sandbox is disabled; skip sandbox runtime volume backend validation");
            return;
        }
        SandboxProperties.VolumeConfig volume = sandboxProperties.getVolume();
        String backend = normalizeBackend(volume == null ? null : volume.getBackend());
        if (SandboxProperties.VolumeConfig.BACKEND_FILE.equals(backend)) {
            validateFileBackend(volume);
            return;
        }
        if (SandboxProperties.VolumeConfig.BACKEND_MINIO_MOUNT.equals(backend)) {
            LOGGER.warn("Sandbox runtime volume backend is legacy minio-mount. "
                + "Use BYCLAW_SANDBOX_VOLUME_BACKEND=file with BYCLAW_SANDBOX_FILE_VOLUME_ROOT for NFS/SMB/CephFS.");
            return;
        }
        throw new IllegalStateException("Unsupported sandbox volume backend: " + backend
            + ". Supported values are minio-mount and file.");
    }

    private void validateFileBackend(SandboxProperties.VolumeConfig volume) {
        String fileRoot = StringUtils.trimToNull(volume == null ? null : volume.getFileRoot());
        if (fileRoot == null) {
            throw new IllegalStateException("byclaw.sandbox.volume.file-root is required when "
                + "BYCLAW_SANDBOX_VOLUME_BACKEND=file");
        }
        Path root = Path.of(fileRoot);
        if (!root.isAbsolute()) {
            throw new IllegalStateException("byclaw.sandbox.volume.file-root must be an absolute path: " + fileRoot);
        }
        String fileType = StringUtils.defaultIfBlank(volume.getFileType(), "bind").trim().toLowerCase();
        validateFileType(fileType);
        if ("cephfs".equals(fileType)) {
            LOGGER.info("Sandbox runtime volume backend=file, fileType=cephfs, fileRoot={}. "
                + "Ensure every OpenSandbox Docker node passes: findmnt {}", fileRoot, fileRoot);
        }
        else {
            LOGGER.info("Sandbox runtime volume backend=file, fileType={}, fileRoot={}", fileType, fileRoot);
        }
    }

    private void validateFileType(String fileType) {
        if (!"bind".equals(fileType) && !"nfs".equals(fileType) && !"smb".equals(fileType) && !"cephfs".equals(fileType)) {
            throw new IllegalStateException("Unsupported sandbox file volume type: " + fileType
                + ". Supported values are bind, nfs, smb, and cephfs.");
        }
    }

    private String normalizeBackend(String backend) {
        return StringUtils.defaultIfBlank(backend, SandboxProperties.VolumeConfig.BACKEND_MINIO_MOUNT)
            .trim()
            .toLowerCase();
    }
}
