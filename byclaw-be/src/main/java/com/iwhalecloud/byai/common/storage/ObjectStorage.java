package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

/**
 * Backend-agnostic atomic object storage operations.
 *
 * This interface intentionally excludes MultipartFile and business upload context concepts.
 */
public interface ObjectStorage {

    default void init(String bucketOrRoot) {
    }

    default void mount(String bucketOrRoot) {
    }

    FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType);

    InputStream get(StorageLocation location);

    boolean exists(StorageLocation location);

    List<StorageObject> list(StoragePrefix prefix, Integer maxDepth);

    void delete(StorageLocation location);

    default void deletePrefix(StoragePrefix prefix) {
        for (StorageObject object : list(prefix, null)) {
            delete(StorageLocation.of(prefix.getNamespace(), prefix.getBucketOrRoot(), object.getPath(),
                prefix.getShareType()));
        }
    }

    void copy(StorageLocation source, StorageLocation target);

    default void move(StorageLocation source, StorageLocation target) {
        copy(source, target);
        delete(source);
    }
}
