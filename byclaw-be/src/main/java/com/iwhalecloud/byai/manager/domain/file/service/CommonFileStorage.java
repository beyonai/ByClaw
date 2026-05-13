package com.iwhalecloud.byai.manager.domain.file.service;

import java.io.ByteArrayInputStream;
import java.io.InputStream;

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

    public void write(StorageLocation location, byte[] bytes, String contentType) {
        byte[] safeBytes = bytes == null ? new byte[0] : bytes;
        objectStorage.put(location, new ByteArrayInputStream(safeBytes), safeBytes.length, contentType);
    }

    public InputStream read(StorageLocation location) {
        return objectStorage.get(location);
    }
}
