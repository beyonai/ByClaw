package com.iwhalecloud.byai.common.storage;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

public abstract class ByclawFS {

    protected static final String NAMESPACE = "byclaw-fs";

    private final ObjectStorage objectStorage;

    protected ByclawFS(ObjectStorage objectStorage) {
        this.objectStorage = objectStorage;
    }

    public void init() {
        initBucket(getBucketOrRoot());
    }

    public void mount() {
        mountBucket(getBucketOrRoot());
    }

    protected void initBucket(String bucketOrRoot) {
        objectStorage.init(bucketOrRoot);
    }

    protected void mountBucket(String bucketOrRoot) {
        objectStorage.mount(bucketOrRoot);
    }

    public InputStream read(String filePath) {
        return objectStorage.get(buildLocation(filePath));
    }

    public Boolean delete(String filePath) {
        String normalizedPath = normalizeInputPath(filePath);
        if (normalizedPath.endsWith("/")) {
            objectStorage.deletePrefix(buildPrefix(filePath));
            return Boolean.TRUE;
        }
        objectStorage.delete(buildLocation(filePath));
        return Boolean.TRUE;
    }

    public List<String> list(String filePath, Integer maxDepth) {
        if (maxDepth != null && maxDepth < 0) {
            throw new IllegalArgumentException("list maxDepth cannot be negative");
        }
        List<StorageObject> objects = objectStorage.list(buildPrefix(filePath), maxDepth);
        if (objects == null || objects.isEmpty()) {
            return List.of();
        }
        return objects.stream()
            .map(StorageObject::getPath)
            .filter(StringUtils::isNotBlank)
            .map(this::toExternalPath)
            .toList();
    }

    public FileMetadata write(MultipartFile multipartFile, String filePath) {
        if (multipartFile == null) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.fs.multipart.file.cannot.be.empty"));
        }
        String targetPath = resolveWritePath(filePath, multipartFile.getOriginalFilename());
        try {
            return objectStorage.put(buildLocation(targetPath), multipartFile.getInputStream(),
                multipartFile.getSize(), multipartFile.getContentType());
        }
        catch (IOException e) {
            throw new IllegalStateException(I18nUtil.get("byclaw.fs.write.file.failed", targetPath), e);
        }
    }

    public abstract String getBucketOrRoot();

    public abstract String getShareType();

    public abstract String getFsRootPath();

    private StorageLocation buildLocation(String filePath) {
        return StorageLocation.of(NAMESPACE, getBucketOrRoot(), toInternalPath(filePath), getShareType());
    }

    private StoragePrefix buildPrefix(String filePath) {
        return StoragePrefix.of(NAMESPACE, getBucketOrRoot(), toInternalPath(filePath), getShareType());
    }

    private String toInternalPath(String filePath) {
        String normalized = normalizeInputPath(filePath);
        String fsRootPath = normalizeFsRootPath();
        if (StringUtils.isBlank(fsRootPath)) {
            return normalized;
        }
        if (normalized.equals(fsRootPath) || normalized.startsWith(fsRootPath + "/")) {
            return normalized;
        }
        return fsRootPath + normalized;
    }

    private String normalizeInputPath(String filePath) {
        if (StringUtils.isBlank(filePath)) {
            throw new IllegalArgumentException(I18nUtil.get("storage.abstract.file.path.cannot.be.empty"));
        }
        String normalized = filePath.trim().replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        for (String part : normalized.split("/")) {
            if ("..".equals(part)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.fs.file.path.contains.traversal"));
            }
        }
        return normalized;
    }

    private String resolveWritePath(String filePath, String originalFilename) {
        String normalized = normalizeInputPath(filePath);
        if (!normalized.endsWith("/")) {
            return normalized;
        }
        if (StringUtils.isBlank(originalFilename)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.fs.write.directory.original.filename.cannot.be.empty"));
        }
        return normalized + originalFilename;
    }

    private String toExternalPath(String storedPath) {
        String normalized = removeBucketOrRootPrefix(normalizeInputPath(storedPath));
        String fsRootPath = normalizeFsRootPath();
        if (StringUtils.isBlank(fsRootPath)) {
            return normalized;
        }
        if (normalized.equals(fsRootPath)) {
            return "/";
        }
        if (normalized.startsWith(fsRootPath + "/")) {
            return normalized.substring(fsRootPath.length());
        }
        return normalized;
    }

    private String removeBucketOrRootPrefix(String storedPath) {
        String bucketOrRoot = normalizeBucketOrRootPath();
        if (StringUtils.isBlank(bucketOrRoot)) {
            return storedPath;
        }
        if (StringUtils.equals(storedPath, bucketOrRoot)) {
            return "/";
        }
        if (storedPath.startsWith(bucketOrRoot + "/")) {
            return storedPath.substring(bucketOrRoot.length());
        }
        return storedPath;
    }

    private String normalizeBucketOrRootPath() {
        String normalized = StringUtils.trimToEmpty(getBucketOrRoot()).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalized) || StringUtils.equals(normalized, "/")) {
            return "";
        }
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        while (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        return StringUtils.isBlank(normalized) ? "" : "/" + normalized;
    }

    private String normalizeFsRootPath() {
        String normalized = StringUtils.trimToEmpty(getFsRootPath()).replace('\\', '/').replaceAll("/+", "/");
        if (StringUtils.isBlank(normalized) || StringUtils.equals(normalized, "/")) {
            return "";
        }
        return normalized.startsWith("/") ? normalized : "/" + normalized;
    }
}
