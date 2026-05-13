package com.iwhalecloud.byai.common.storage.model;

import org.apache.commons.lang3.StringUtils;

import lombok.Getter;
import lombok.EqualsAndHashCode;

/**
 * Logical storage object location.
 *
 * bucketOrRoot maps to a MinIO bucket, a remote root/workspace, or a logical root
 * depending on the selected storage backend. path is always a normalized relative
 * object path.
 */
@Getter
@EqualsAndHashCode
public class StorageLocation {

    private final String namespace;

    private final String bucketOrRoot;

    private final String path;

    private final String shareType;

    private StorageLocation(String namespace, String bucketOrRoot, String path, String shareType) {
        this.namespace = StringUtils.trimToEmpty(namespace);
        this.bucketOrRoot = StringUtils.trimToEmpty(bucketOrRoot);
        this.path = normalizePath(path);
        this.shareType = StringUtils.trimToEmpty(shareType);
    }

    public static StorageLocation of(String namespace, String bucketOrRoot, String path) {
        return new StorageLocation(namespace, bucketOrRoot, path, null);
    }

    public static StorageLocation of(String namespace, String bucketOrRoot, String path, String shareType) {
        return new StorageLocation(namespace, bucketOrRoot, path, shareType);
    }

    public StoragePrefix asPrefix() {
        return StoragePrefix.of(namespace, bucketOrRoot, path, shareType);
    }

    private static String normalizePath(String path) {
        String normalized = StringUtils.trimToEmpty(path).replace('\\', '/').replaceAll("/+", "/");
        if (normalized.startsWith("/")) {
            return normalized;
        }
        return "/" + normalized;
    }
}
