package com.iwhalecloud.byai.common.storage.config;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.lang.reflect.Field;

import org.junit.jupiter.api.Test;

class ObjectStorageConfigurationTest {

    @Test
    void acceptsFileStorageTypeForLocalFilesystem() throws Exception {
        ObjectStorageConfiguration configuration = new ObjectStorageConfiguration();
        Field storageType = ObjectStorageConfiguration.class.getDeclaredField("storageType");
        storageType.setAccessible(true);
        storageType.set(configuration, "file");

        ObjectStorageProperties properties = configuration.getStorageConfig();

        assertEquals("file", properties.getStorageType());
        assertEquals("", properties.getDefaultBucketName());
    }
}
