package com.iwhalecloud.byai.common.storage.model;

import org.apache.commons.lang3.StringUtils;

import lombok.Getter;
import lombok.EqualsAndHashCode;

/**
 * Logical storage prefix for list and prefix delete operations.
 */
@Getter
@EqualsAndHashCode
public class StoragePrefix {

    private final String namespace;

    private final String bucketOrRoot;

    private final String prefix;

    private final String shareType;

    private StoragePrefix(String namespace, String bucketOrRoot, String prefix, String shareType) {
        this.namespace = StringUtils.trimToEmpty(namespace);
        this.bucketOrRoot = StringUtils.trimToEmpty(bucketOrRoot);
        this.prefix = normalizePrefix(prefix);
        this.shareType = StringUtils.trimToEmpty(shareType);
    }

    public static StoragePrefix of(String namespace, String bucketOrRoot, String prefix) {
        return new StoragePrefix(namespace, bucketOrRoot, prefix, null);
    }

    public static StoragePrefix of(String namespace, String bucketOrRoot, String prefix, String shareType) {
        return new StoragePrefix(namespace, bucketOrRoot, prefix, shareType);
    }

    private static String normalizePrefix(String prefix) {
        String normalized = StringUtils.trimToEmpty(prefix).replace('\\', '/').replaceAll("/+", "/");
        while (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        return normalized;
    }
}
