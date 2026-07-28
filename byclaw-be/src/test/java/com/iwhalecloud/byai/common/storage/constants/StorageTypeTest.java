package com.iwhalecloud.byai.common.storage.constants;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class StorageTypeTest {

    @Test
    void treatsFileAsLocalFilesystemStorage() {
        assertTrue(StorageType.isLocalFilesystem("file"));
        assertTrue(StorageType.matches("file", StorageType.LOCAL));
    }
}
