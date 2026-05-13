package com.iwhalecloud.byai.common.storage;

import java.util.List;

import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;

/**
 * Resolves file-ingress capable backends by storage type.
 */
@Component
public class FileIngressBackendRegistry {

    private final List<FileIngressBackend> backends;

    private final ObjectStorageConfiguration objectStorageConfiguration;

    public FileIngressBackendRegistry(List<FileIngressBackend> backends,
        ObjectStorageConfiguration objectStorageConfiguration) {
        this.backends = backends;
        this.objectStorageConfiguration = objectStorageConfiguration;
    }

    public FileIngressBackend getConfiguredBackend() {
        return getBackend(objectStorageConfiguration.getStorageConfig().getStorageType());
    }

    public FileIngressBackend getBackend(String storageType) {
        for (FileIngressBackend backend : backends) {
            if (backend.getStorageType().equalsIgnoreCase(storageType)) {
                return backend;
            }
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
            String.format("未找到配置的存储类型 %s 对应的文件接入实现", storageType));
    }
}
