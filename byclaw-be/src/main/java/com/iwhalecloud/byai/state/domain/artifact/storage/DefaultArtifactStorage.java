package com.iwhalecloud.byai.state.domain.artifact.storage;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.AbstractObjectStorageService;
import com.iwhalecloud.byai.common.storage.constants.StorageType;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import java.io.InputStream;
import java.util.List;
import org.springframework.stereotype.Component;

/**
 * Resolves every operation by the storage type recorded on the artifact, preserving old data after migrations.
 */
@Component
public class DefaultArtifactStorage implements ArtifactStoragePort {

    private static final String NAMESPACE = "artifact";

    private final List<AbstractObjectStorageService<?>> storageServices;

    public DefaultArtifactStorage(List<AbstractObjectStorageService<?>> storageServices) {
        this.storageServices = storageServices;
    }

    @Override
    public void initialize(String storageType, String storageRoot) {
        resolve(storageType).init(storageRoot);
    }

    @Override
    public void put(String storageType, String storageRoot, String objectKey, InputStream inputStream, long size,
        String contentType) {
        resolve(storageType).put(location(storageRoot, objectKey), inputStream, size, contentType);
    }

    @Override
    public InputStream open(String storageType, String storageRoot, String objectKey) {
        return resolve(storageType).get(location(storageRoot, objectKey));
    }

    @Override
    public FileMetadata metadata(String storageType, String storageRoot, String objectKey) {
        return resolve(storageType).metadata(location(storageRoot, objectKey));
    }

    @Override
    public boolean exists(String storageType, String storageRoot, String objectKey) {
        return resolve(storageType).exists(location(storageRoot, objectKey));
    }

    @Override
    public void deletePrefix(String storageType, String storageRoot, String objectPrefix) {
        resolve(storageType).deletePrefix(StoragePrefix.of(NAMESPACE, storageRoot, objectPrefix));
    }

    private AbstractObjectStorageService<?> resolve(String storageType) {
        return storageServices.stream()
            .filter(service -> StorageType.matches(storageType, service.getStorageType()))
            .findFirst()
            .orElseThrow(() -> new BaseException(CommonErrorCode.ERROR_CODE_50500,
                "未找到Artifact存储类型对应的实现: " + storageType));
    }

    private StorageLocation location(String storageRoot, String objectKey) {
        return StorageLocation.of(NAMESPACE, storageRoot, objectKey);
    }
}
