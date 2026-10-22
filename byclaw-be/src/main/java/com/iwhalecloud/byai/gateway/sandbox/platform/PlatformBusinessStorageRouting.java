package com.iwhalecloud.byai.gateway.sandbox.platform;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

import com.iwhalecloud.byai.common.storage.*;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.*;
import java.io.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/** 按既有存储类型确定执行位置；外部 FTP 等仍是 BE 固定职责，绝非远程失败回退。 */
@Component
public class PlatformBusinessStorageRouting {
    private final PlatformRemoteGateway gateway;
    private final ObjectProvider<PlatformStorageClient> files;

    public PlatformBusinessStorageRouting(
            PlatformRemoteGateway gateway, ObjectProvider<PlatformStorageClient> files) {
        this.gateway = gateway;
        this.files = files;
    }

    public ObjectStorage object(ObjectStorage legacy, String storageType) {
        return gateway.isRemote() && StorageType.isLocalFilesystem(storageType)
                ? new PlatformRoutedStorage(legacy, gateway, files)
                : legacy;
    }

    /** 共享目录按启动期执行侧选路；远程失败直接传播，不能执行本地补做。 */
    public void ensureDirectory(String bucket, String path, Runnable legacy) {
        if (!gateway.isRemote()) {
            legacy.run();
            return;
        }
        gateway.call("storage", "ensure-directory",
                gateway.params("namespace", "workspace", "bucketOrRoot", bucket, "path", path));
    }

    @FunctionalInterface
    public interface DirectoryCreation {
        void run() throws IOException;
    }

    /** 仅做路径映射；remote 在 BE 打开/检查目录之前转平台，legacy 保留原 IOException 边界。 */
    public void createDirectoriesWithinRoot(String configuredRoot, java.nio.file.Path target,
            DirectoryCreation legacy) throws IOException {
        if (!gateway.isRemote()) {
            legacy.run();
            return;
        }
        java.nio.file.Path root = java.nio.file.Paths.get(configuredRoot).toAbsolutePath().normalize();
        java.nio.file.Path directory = target.toAbsolutePath().normalize();
        if (!directory.startsWith(root)) {
            throw new IllegalArgumentException("Path traversal detected: " + target);
        }
        gateway.call("storage", "create-directories", gateway.params("namespace", "workspace",
                "bucketOrRoot", "", "path", root.relativize(directory).toString()));
    }

    public FileIngressBackend ingress(FileIngressBackend legacy) {
        if (!gateway.isRemote() || !StorageType.isLocalFilesystem(legacy.getStorageType()))
            return legacy;
        ObjectStorage remote = object((ObjectStorage) legacy, legacy.getStorageType());
        return new FileIngressBackend() {
            public String getStorageType() {
                return legacy.getStorageType();
            }

            public boolean createBucketIfNeeded(String bucket) {
                remote.init(bucket);
                return true;
            }

            public FileMetadata upload(
                    MultipartFile file, String path, String bucket, FileStorageContext context) {
                String target = (path == null ? "" : path) + file.getOriginalFilename();
                try (InputStream input = file.getInputStream()) {
                    return remote.put(
                            StorageLocation.of("default", bucket, target),
                            input,
                            file.getSize(),
                            file.getContentType());
                } catch (IOException failure) {
                    throw new IllegalStateException(I18nUtil.get("platform.file.upload.failed", target), failure);
                }
            }

            public InputStream download(String path, String bucket) {
                return remote.get(StorageLocation.of("default", bucket, path));
            }

            public void deleteByPath(String path, String bucket) {
                remote.delete(StorageLocation.of("default", bucket, path));
            }

            public FileMetadata getMetadata(String path, String bucket) {
                FileMetadata metadata =
                        remote.metadata(StorageLocation.of("default", bucket, path));
                metadata.setFileUrl(path);
                metadata.setFileType(org.apache.commons.io.FilenameUtils.getExtension(path));
                metadata.setBucketName(bucket);
                metadata.setStorageType(legacy.getStorageType());
                return metadata;
            }
        };
    }
}
