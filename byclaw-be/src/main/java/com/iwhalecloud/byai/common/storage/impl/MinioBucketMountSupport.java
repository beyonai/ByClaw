package com.iwhalecloud.byai.common.storage.impl;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.config.MinioConfig;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.stream.Collectors;

@Component
public class MinioBucketMountSupport {

    private static final Logger LOGGER = LoggerFactory.getLogger(MinioBucketMountSupport.class);

    @Autowired
    private MinioConfig minioConfig;

    @Autowired
    private MinioMountHostExecutor minioMountHostExecutor;

    public void mountSingleBucketOnAllTargets(String storageType, String bucketName) {
        if (!shouldMount(storageType)) {
            LOGGER.info("当前配置不需要执行单桶MinIO挂载，跳过, storageType={}, mountEnabled={}, bucketName={}",
                storageType, minioConfig.getMount() == null ? null : minioConfig.getMount().getEnabled(), bucketName);
            return;
        }
        validateMountConfig();
        for (MinioConfig.Target target : minioConfig.getMount().getTargets()) {
            if (!Boolean.TRUE.equals(target.getEnabled())) {
                LOGGER.info("宿主机挂载配置已禁用，跳过处理, host={}, bucketName={}", target.getHost(), bucketName);
                continue;
            }
            try {
                mountSingleBucket(target, bucketName);
            } catch (Exception e) {
                LOGGER.error("MinIO bucket挂载失败，继续处理后续宿主机, host={}, bucketName={}, mountPath={}",
                    target.getHost(), bucketName, minioConfig.getMount().getPath(), e);
            }
        }
    }

    public String describeTargets() {
        if (minioConfig.getMount() == null || minioConfig.getMount().getTargets() == null) {
            return "";
        }
        return minioConfig.getMount().getTargets().stream()
            .map(target -> target.getHost() + ":" + (target.getPort() == null ? 22 : target.getPort())
                + "(" + target.getUser() + ",enabled=" + Boolean.TRUE.equals(target.getEnabled()) + ")")
            .collect(Collectors.joining(", "));
    }

    private void mountSingleBucket(MinioConfig.Target target, String bucketName) {
        String mountDirectory = resolveMountDirectory(bucketName);
        LOGGER.info("MinIO bucket挂载开始, host={}, bucketName={}, mountDirectory={}",
            target.getHost(), bucketName, mountDirectory);
        LOGGER.info("MinIO bucket准备完成，开始处理宿主机挂载目录, host={}, bucketName={}, mountDirectory={}, mapping={}=>{}",
            target.getHost(), bucketName, mountDirectory, bucketName, mountDirectory);

        minioMountHostExecutor.inspectRemoteDirectoryState(target, mountDirectory);
        boolean recoveredBrokenMountPoint = minioMountHostExecutor.ensureRemoteDirectoryExists(target, mountDirectory);
        LOGGER.info("宿主机挂载目录校验完成, host={}, bucketName={}, mountDirectory={}",
            target.getHost(), bucketName, mountDirectory);

        if (minioMountHostExecutor.isRemoteDirectoryMounted(target, mountDirectory)) {
            LOGGER.info("检测到宿主机挂载目录已存在有效挂载，跳过重复挂载, host={}, bucketName={}, mountDirectory={}",
                target.getHost(), bucketName, mountDirectory);
            return;
        }

        String command = buildMountCommand(bucketName, mountDirectory);
        LOGGER.info(
            "执行MinIO bucket挂载命令, host={}, bucketName={}, mountDirectory={}, endpoint={}, mapping={}=>{}, command={}",
            target.getHost(), bucketName, mountDirectory, buildMinioEndpoint(), bucketName, mountDirectory,
            minioMountHostExecutor.maskSensitiveCommand(command, minioConfig.getAccessKey(), minioConfig.getSecretKey()));
        minioMountHostExecutor.executeMountCommand(target, command, bucketName, mountDirectory);
        boolean mounted = minioMountHostExecutor.isRemoteDirectoryMounted(target, mountDirectory);
        if (!mounted) {
            String directoryState = minioMountHostExecutor.inspectRemoteDirectoryState(target, mountDirectory);
            throw new BaseException("MinIO bucket挂载命令执行完成，但未检测到有效挂载: "
                + bucketName + " -> " + mountDirectory + ", host=" + target.getHost()
                + ", directoryState=" + directoryState);
        }
        LOGGER.info("MinIO bucket挂载复核成功, host={}, bucketName={}, mountDirectory={}, mapping={}=>{}, mounted={}",
            target.getHost(), bucketName, mountDirectory, bucketName, mountDirectory, true);
        LOGGER.info("{}桶与{}目录已挂载成功, host={}", bucketName, mountDirectory, target.getHost());
        if (recoveredBrokenMountPoint) {
            LOGGER.info("对坏掉的{}挂载点重新挂载成功, host={}, bucketName={}, mountDirectory={}",
                mountDirectory, target.getHost(), bucketName, mountDirectory);
        }
    }

    private void validateMountConfig() {
        if (minioConfig.getMount() == null) {
            throw new BaseException("MinIO挂载配置不能为空，请检查 file.storage.minio.mount.*");
        }
        if (StringUtils.isBlank(minioConfig.getMount().getPath())) {
            throw new BaseException("MinIO挂载路径不能为空，请检查 file.storage.minio.mount.path");
        }
        if (StringUtils.isBlank(minioConfig.getHost())) {
            throw new BaseException("MinIO host不能为空，请检查 file.storage.minio.host");
        }
        if (minioConfig.getApi() == null || minioConfig.getApi().getPort() == null) {
            throw new BaseException("MinIO api端口不能为空，请检查 file.storage.minio.api.port");
        }
        if (StringUtils.isBlank(minioConfig.getAccessKey())) {
            throw new BaseException("MinIO accessKey不能为空，请检查 file.storage.minio.access_key");
        }
        if (StringUtils.isBlank(minioConfig.getSecretKey())) {
            throw new BaseException("MinIO secretKey不能为空，请检查 file.storage.minio.secret_key");
        }
        if (minioConfig.getMount().getTargets() == null || minioConfig.getMount().getTargets().isEmpty()) {
            throw new BaseException("MinIO挂载宿主机列表不能为空，请检查 file.storage.minio.mount.targets");
        }
    }

    private boolean shouldMount(String storageType) {
        return StringUtils.equalsIgnoreCase(StringUtils.trimToEmpty(storageType), "minio")
            && minioConfig.getMount() != null
            && Boolean.TRUE.equals(minioConfig.getMount().getEnabled());
    }

    private String resolveMountDirectory(String bucketName) {
        String basePath = stripTrailingSlash(minioConfig.getMount().getPath());
        return basePath + "/" + bucketName;
    }

    private String buildMountCommand(String bucketName, String mountDirectory) {
        return "rclone mount ':s3:" + bucketName + "' " + shellQuote(mountDirectory)
            + " --s3-provider Minio"
            + " --s3-endpoint " + shellQuote(buildMinioEndpoint())
            + " --s3-access-key-id " + shellQuote(minioConfig.getAccessKey())
            + " --s3-secret-access-key " + shellQuote(minioConfig.getSecretKey())
            + " --s3-region us-east-1"
            + " --vfs-cache-mode minimal"
            + " --allow-non-empty"
            + " --poll-interval 2s"
            + " --dir-cache-time 2s"
            + " --attr-timeout 2s"
            + " --vfs-refresh"
            + " --daemon";
    }

    private String buildMinioEndpoint() {
        return "http://" + minioConfig.getHost() + ":" + minioConfig.getApi().getPort();
    }

    private static String stripTrailingSlash(String path) {
        String normalized = StringUtils.trimToEmpty(path).replace('\\', '/');
        while (normalized.length() > 1 && normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return normalized;
    }

    private static String shellQuote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }
}
