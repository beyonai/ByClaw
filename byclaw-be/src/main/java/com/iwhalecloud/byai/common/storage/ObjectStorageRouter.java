package com.iwhalecloud.byai.common.storage;

import java.io.InputStream;
import java.util.List;

import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

import jakarta.annotation.Resource;

/**
 * Routes atomic object storage operations to the configured backend.
 */
@Primary
@Component
public class ObjectStorageRouter implements ObjectStorage {

    private final List<AbstractObjectStorageService<?>> storageServices;

    @Resource
    private ObjectStorageConfiguration objectStorageConfiguration;

    public ObjectStorageRouter(List<AbstractObjectStorageService<?>> storageServices) {
        this.storageServices = storageServices;
    }

    private AbstractObjectStorageService<?> getService() {
        String storageType = objectStorageConfiguration.getStorageConfig().getStorageType();
        for (AbstractObjectStorageService<?> service : storageServices) {
            if (service.getStorageType().equalsIgnoreCase(storageType)) {
                return service;
            }
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
            String.format("未找到配置的存储类型 %s 对应的对象存储实现", storageType));
    }

    @Override
    public void init(String bucketOrRoot) {
        getService().init(bucketOrRoot);
    }

    @Override
    public void mount(String bucketOrRoot) {
        getService().mount(bucketOrRoot);
    }

    @Override
    public FileMetadata put(StorageLocation location, InputStream inputStream, long size, String contentType) {
        return getService().put(location, inputStream, size, contentType);
    }

    @Override
    public InputStream get(StorageLocation location) {
        return getService().get(location);
    }

    @Override
    public boolean exists(StorageLocation location) {
        return getService().exists(location);
    }

    @Override
    public List<StorageObject> list(StoragePrefix prefix, Integer maxDepth) {
        return getService().list(prefix, maxDepth);
    }

    @Override
    public void delete(StorageLocation location) {
        getService().delete(location);
    }

    @Override
    public void deletePrefix(StoragePrefix prefix) {
        getService().deletePrefix(prefix);
    }

    @Override
    public void copy(StorageLocation source, StorageLocation target) {
        getService().copy(source, target);
    }

    @Override
    public void move(StorageLocation source, StorageLocation target) {
        getService().move(source, target);
    }
}
