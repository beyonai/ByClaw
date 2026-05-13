package com.iwhalecloud.byai.common.storage.impl;

import com.iwhalecloud.byai.common.storage.AbstractFileIngressStorageService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import org.apache.commons.io.FilenameUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Local filesystem storage implementation for development and mounted-volume deployments.
 */
@Component
public class LocalStorageService extends AbstractFileIngressStorageService<Void> {

    public static final String STORAGE_TYPE = "local";
    private static final String DEFAULT_NAMESPACE = "default";

    @Value("${file.storage.local.path:${byclaw.sandbox.base-path:/tmp/byclaw-storage}}")
    private String basePath;

    @Override
    public String getStorageType() {
        return STORAGE_TYPE;
    }

    @Override
    protected Void createStorageClient() {
        return null;
    }

    @Override
    protected FileMetadata doUploadFile(MultipartFile multipartFile, String storagePath, String bucketName,
        FileStorageContext fileStorageContext) {
        String path = StringUtils.defaultString(storagePath) + multipartFile.getOriginalFilename();
        try {
            return put(StorageLocation.of(DEFAULT_NAMESPACE, bucketName, path), multipartFile.getInputStream(),
                multipartFile.getSize(), multipartFile.getContentType());
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file upload failed: " + path, e);
        }
    }

    @Override
    protected InputStream doDownloadFile(String fileId, String bucketName) {
        return get(StorageLocation.of(DEFAULT_NAMESPACE, bucketName, fileId));
    }

    @Override
    protected void doDeleteFile(String objectUrl, String bucketName) {
        delete(StorageLocation.of(DEFAULT_NAMESPACE, bucketName, objectUrl));
    }

    @Override
    protected FileMetadata doGetObjectMetadata(String objectKey, String bucketName) {
        Path path = resolve(StorageLocation.of(DEFAULT_NAMESPACE, bucketName, objectKey));
        try {
            FileMetadata metadata = new FileMetadata();
            metadata.setBucketName(bucketName);
            metadata.setFileName(path.getFileName().toString());
            metadata.setFileUrl(objectKey);
            metadata.setFileSize(Files.size(path));
            metadata.setFileType(FilenameUtils.getExtension(objectKey));
            metadata.setStorageType(getStorageType());
            return metadata;
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file metadata failed: " + objectKey, e);
        }
    }

    @Override
    protected boolean doCreateBucket(String bucketName) {
        try {
            Files.createDirectories(resolve(StorageLocation.of(DEFAULT_NAMESPACE, bucketName, "")));
            return true;
        }
        catch (IOException e) {
            throw new IllegalStateException("Local root create failed: " + bucketName, e);
        }
    }

    @Override
    public FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType) {
        Path target = resolve(location);
        try {
            Files.createDirectories(target.getParent());
            Files.copy(inputStream, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            FileMetadata metadata = new FileMetadata();
            metadata.setBucketName(location.getBucketOrRoot());
            metadata.setFileName(target.getFileName().toString());
            metadata.setFileUrl(location.getPath());
            metadata.setFileSize(size);
            metadata.setContentType(contentType);
            metadata.setFileType(FilenameUtils.getExtension(location.getPath()));
            metadata.setStorageType(getStorageType());
            return metadata;
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file write failed: " + target, e);
        }
    }

    @Override
    public InputStream get(StorageLocation location) {
        try {
            return Files.newInputStream(resolve(location));
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file read failed: " + location.getPath(), e);
        }
    }

    @Override
    public boolean exists(StorageLocation location) {
        return Files.exists(resolve(location));
    }

    @Override
    public List<StorageObject> list(StoragePrefix prefix, Integer maxDepth) {
        if (maxDepth != null && maxDepth < 0) {
            throw new IllegalArgumentException("list maxDepth cannot be negative");
        }
        Path root = resolve(StorageLocation.of(prefix.getNamespace(), prefix.getBucketOrRoot(), prefix.getPrefix()));
        if (!Files.exists(root)) {
            return List.of();
        }
        try (Stream<Path> stream = maxDepth == null ? Files.walk(root) : Files.walk(root, maxDepth)) {
            Path storageRoot = resolve(StorageLocation.of(prefix.getNamespace(), prefix.getBucketOrRoot(), ""));
            return stream.filter(Files::isRegularFile)
                .map(path -> StorageObject.builder()
                    .bucketOrRoot(prefix.getBucketOrRoot())
                    .path(storageRoot.relativize(path).toString().replace('\\', '/'))
                    .build())
                .collect(Collectors.toList());
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file list failed: " + root, e);
        }
    }

    @Override
    public void delete(StorageLocation location) {
        try {
            Files.deleteIfExists(resolve(location));
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file delete failed: " + location.getPath(), e);
        }
    }

    @Override
    public void copy(StorageLocation source, StorageLocation target) {
        try {
            Path sourcePath = resolve(source);
            Path targetPath = resolve(target);
            Files.createDirectories(targetPath.getParent());
            Files.copy(sourcePath, targetPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file copy failed", e);
        }
    }

    private Path resolve(StorageLocation location) {
        Path root = Path.of(StringUtils.defaultIfBlank(location.getBucketOrRoot(), basePath));
        if (!root.isAbsolute()) {
            root = Path.of(basePath).resolve(root);
        }
        return root.resolve(location.getPath()).normalize();
    }
}
