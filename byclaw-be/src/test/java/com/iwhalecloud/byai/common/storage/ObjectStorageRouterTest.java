package com.iwhalecloud.byai.common.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageProperties;
import com.iwhalecloud.byai.common.storage.impl.LocalStorageService;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;

class ObjectStorageRouterTest {

    @TempDir
    Path tempDir;

    @Test
    void routesFileStorageTypeToLocalFilesystemService() {
        LocalStorageService localStorageService = new LocalStorageService();
        ReflectionTestUtils.setField(localStorageService, "basePath", tempDir.toString());
        ReflectionTestUtils.setField(localStorageService, "configuredStorageType", "local");

        ObjectStorageProperties properties = new ObjectStorageProperties();
        properties.setStorageType("file");
        ObjectStorageConfiguration configuration = mock(ObjectStorageConfiguration.class);
        when(configuration.getStorageConfig()).thenReturn(properties);

        ObjectStorageRouter router = new ObjectStorageRouter(List.of(localStorageService));
        ReflectionTestUtils.setField(router, "objectStorageConfiguration", configuration);

        assertThat(router.exists(StorageLocation.of("default", "byclaw-user001", "missing.txt"))).isFalse();
    }
}
