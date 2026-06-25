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
import java.nio.file.attribute.PosixFilePermission;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Local filesystem storage implementation for development and mounted-volume deployments.
 */
@Component
public class LocalStorageService extends AbstractFileIngressStorageService<Void> {

    public static final String STORAGE_TYPE = "local";
    private static final String DEFAULT_NAMESPACE = "default";
    private static final Set<PosixFilePermission> SHARED_DIRECTORY_PERMISSIONS = Set.of(
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
    private static final Set<PosixFilePermission> SHARED_FILE_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ,
        PosixFilePermission.OWNER_WRITE,
        PosixFilePermission.GROUP_READ,
        PosixFilePermission.GROUP_WRITE,
        PosixFilePermission.OTHERS_READ,
        PosixFilePermission.OTHERS_WRITE
    );

    @Value("${file.storage.local.path:${byclaw.sandbox.base-path:/tmp/byclaw-storage}}")
    private String basePath;

    @Value("${file.storage.type:local}")
    private String configuredStorageType;

    @Value("${file.storage.local.shared-permissions.enabled:true}")
    private boolean sharedPermissionsEnabled;

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
            metadata.setLastModified(Files.getLastModifiedTime(path).toInstant().toString());
            return metadata;
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file metadata failed: " + objectKey, e);
        }
    }

    @Override
    public void init(String bucketOrRoot) {
        doCreateBucket(bucketOrRoot);
    }

    @Override
    public void mount(String bucketOrRoot) {
        doCreateBucket(bucketOrRoot);
    }

    @Override
    protected boolean doCreateBucket(String bucketName) {
        try {
            Path bucketRoot = resolve(StorageLocation.of(DEFAULT_NAMESPACE, bucketName, ""));
            Files.createDirectories(bucketRoot);
            applyDirectoryPermissions(bucketRoot);
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
                applyDirectoryPermissions(target);
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
            applyDirectoryPermissions(target.getParent());
            Files.copy(inputStream, target, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            applyFilePermissions(target);
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
                applyDirectoryPermissions(targetPath);
                return;
            }
            Files.createDirectories(targetPath.getParent());
            applyDirectoryPermissions(targetPath.getParent());
            Files.copy(sourcePath, targetPath, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            applyFilePermissions(targetPath);
        }
        catch (IOException e) {
            throw new IllegalStateException("Local file copy failed", e);
        }
    }

    private void applyDirectoryPermissions(Path path) {
        applyPermissions(path, SHARED_DIRECTORY_PERMISSIONS);
    }

    private void applyFilePermissions(Path path) {
        applyPermissions(path, SHARED_FILE_PERMISSIONS);
    }

    private void applyPermissions(Path path, Set<PosixFilePermission> permissions) {
        if (!sharedPermissionsEnabled || path == null) {
            return;
        }
        try {
            Files.setPosixFilePermissions(path, permissions);
        }
        catch (UnsupportedOperationException ignored) {
            // Non-POSIX filesystems, object-store mocks, and local dev on unsupported platforms can ignore this.
        }
        catch (IOException ignored) {
            // Permission changes are best-effort. The primary write/read path should not fail because chmod is denied.
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
        try {
            builder.lastModified(Files.getLastModifiedTime(path).toInstant().toString());
        }
        catch (IOException ignored) {
            // Last modified time is optional metadata for list operations.
        }
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
