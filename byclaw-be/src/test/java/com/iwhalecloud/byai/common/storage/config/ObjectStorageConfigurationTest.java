package com.iwhalecloud.byai.common.storage.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.constants.StorageType;

class ObjectStorageConfigurationTest {

    @AfterEach
    void tearDown() {
        ObjectStorageConfiguration.clearStorageType();
    }

    @Test
    void clearStorageTypeRestoresConfiguredStorageTypeForReusedThread() {
        ObjectStorageConfiguration configuration = new ObjectStorageConfiguration();
        ReflectionTestUtils.setField(configuration, "storageType", StorageType.FILE);

        ObjectStorageConfiguration.setStorageType(StorageType.SFTP);
        assertThat(configuration.getStorageType()).isEqualTo(StorageType.SFTP);

        ObjectStorageConfiguration.clearStorageType();

        assertThat(configuration.getStorageType()).isEqualTo(StorageType.FILE);
    }
}
