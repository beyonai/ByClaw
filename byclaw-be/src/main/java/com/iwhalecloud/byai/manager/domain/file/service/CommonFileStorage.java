package com.iwhalecloud.byai.manager.domain.file.service;

import java.io.ByteArrayInputStream;
import java.io.InputStream;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;

/**
 * Common file storage facade.
 */
@Service
public class CommonFileStorage {

    private final ObjectStorage objectStorage;

    public CommonFileStorage(ObjectStorage objectStorage) {
        this.objectStorage = objectStorage;
    }

    public FileMetadata write(StorageLocation location, byte[] bytes, String contentType) {
        byte[] safeBytes = bytes == null ? new byte[0] : bytes;
        return objectStorage.put(location, new ByteArrayInputStream(safeBytes), safeBytes.length, contentType);
    }

    public InputStream read(StorageLocation location) {
        return objectStorage.get(location);
    }

    /**
     * 删除公共文件存储中的对象。
     *
     * @param location 文件存储位置
     */
    public void delete(StorageLocation location) {
        objectStorage.delete(location);
    }
}
