package com.iwhalecloud.byai.common.storage.impl;

import com.iwhalecloud.byai.common.storage.AbstractFileIngressStorageService;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
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
import java.util.Comparator;
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

    @Value("${file.storage.type:local}")
    private String configuredStorageType;

    @Override
    public String getStorageType() {
        if (StorageType.FILE.equalsIgnoreCase(configuredStorageType)) {
            return StorageType.FILE;
        }
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
            if (isDirectoryMarker(location.getPath())) {
                Files.createDirectories(target);
                FileMetadata metadata = new FileMetadata();
                metadata.setBucketName(location.getBucketOrRoot());
                metadata.setFileName(target.getFileName() == null ? "" : target.getFileName().toString());
                metadata.setFileUrl(location.getPath());
                metadata.setFileSize(0L);
                metadata.setContentType(contentType);
                metadata.setStorageType(getStorageType());
                return metadata;
            }
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
        if (Files.isRegularFile(root)) {
            Path storageRoot = resolve(StorageLocation.of(prefix.getNamespace(), prefix.getBucketOrRoot(), ""));
            return List.of(toStorageObject(prefix.getBucketOrRoot(), storageRoot, root));
        }
        try {
            Path storageRoot = resolve(StorageLocation.of(prefix.getNamespace(), prefix.getBucketOrRoot(), ""));
            if (!prefix.isRecursive()) {
                try (Stream<Path> stream = Files.list(root)) {
                    return stream
                        .filter(path -> Files.isRegularFile(path) || Files.isDirectory(path))
                        .map(path -> toStorageObject(prefix.getBucketOrRoot(), storageRoot, path))
                        .collect(Collectors.toList());
                }
            }
            try (Stream<Path> stream = maxDepth == null ? Files.walk(root) : Files.walk(root, maxDepth)) {
                return stream
                    .filter(Files::isRegularFile)
                    .map(path -> toStorageObject(prefix.getBucketOrRoot(), storageRoot, path))
                    .collect(Collectors.toList());
            }
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
    public void deletePrefix(StoragePrefix prefix) {
        Path root = resolve(StorageLocation.of(prefix.getNamespace(), prefix.getBucketOrRoot(), prefix.getPrefix()));
        if (!Files.exists(root)) {
            return;
        }
        try (Stream<Path> stream = Files.walk(root)) {
            List<Path> paths = stream.sorted(Comparator.reverseOrder()).collect(Collectors.toList());
            for (Path path : paths) {
                Files.deleteIfExists(path);
            }
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file prefix delete failed: " + root, e);
        }
    }

    @Override
    public void copy(StorageLocation source, StorageLocation target) {
        try {
            Path sourcePath = resolve(source);
            Path targetPath = resolve(target);
            if (Files.isDirectory(sourcePath) || isDirectoryMarker(target.getPath())) {
                Files.createDirectories(targetPath);
                return;
            }
            Files.createDirectories(targetPath.getParent());
            Files.copy(sourcePath, targetPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file copy failed", e);
        }
    }

    private StorageObject toStorageObject(String bucketOrRoot, Path storageRoot, Path path) {
        String relativePath = storageRoot.relativize(path).toString().replace('\\', '/');
        boolean isDirectory = Files.isDirectory(path);
        if (isDirectory && !relativePath.endsWith("/")) {
            relativePath = relativePath + "/";
        }
        StorageObject.StorageObjectBuilder builder = StorageObject.builder()
            .bucketOrRoot(bucketOrRoot)
            .path(relativePath)
            .isDir(isDirectory);
        if (!isDirectory) {
            try {
                builder.size(Files.size(path));
            }
            catch (IOException ignored) {
                // Size is optional metadata for list operations.
            }
        }
        return builder.build();
    }

    private boolean isDirectoryMarker(String path) {
        return StringUtils.trimToEmpty(path).replace('\\', '/').endsWith("/");
    }

    private Path resolve(StorageLocation location) {
        Path root = Path.of(StringUtils.defaultIfBlank(location.getBucketOrRoot(), basePath));
        if (!root.isAbsolute()) {
            root = Path.of(basePath).resolve(root);
        }
        String relativePath = StringUtils.trimToEmpty(location.getPath()).replace('\\', '/');
        while (relativePath.startsWith("/")) {
            relativePath = relativePath.substring(1);
        }
        Path resolved = root.resolve(relativePath).normalize();
        if (!resolved.startsWith(root.normalize())) {
            throw new IllegalArgumentException("Path traversal detected: " + location.getPath());
        }
        return resolved;
    }
}
