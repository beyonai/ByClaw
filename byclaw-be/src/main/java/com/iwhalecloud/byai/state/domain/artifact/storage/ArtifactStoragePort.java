package com.iwhalecloud.byai.state.domain.artifact.storage;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;

/**
 * Storage boundary for artifact objects. Business code never depends on a mounted filesystem path.
 */
public interface ArtifactStoragePort {

    void initialize(String storageType, String storageRoot);

    void put(String storageType, String storageRoot, String objectKey, InputStream inputStream, long size,
        String contentType);

    InputStream open(String storageType, String storageRoot, String objectKey);

    /**
     * Opens an object at the requested byte offset. Remote backends can override this method with a native range read.
     */
    default InputStream open(String storageType, String storageRoot, String objectKey, long offset, long length) {
        InputStream input = open(storageType, storageRoot, objectKey);
        try {
            input.skipNBytes(offset);
            return input;
        }
        catch (IOException e) {
            try {
                input.close();
            }
            catch (IOException ignored) {
                // Preserve the range positioning failure as the primary exception.
            }
            throw new UncheckedIOException("无法定位Artifact读取区间", e);
        }
    }

    FileMetadata metadata(String storageType, String storageRoot, String objectKey);

    boolean exists(String storageType, String storageRoot, String objectKey);

    void deletePrefix(String storageType, String storageRoot, String objectPrefix);
}
