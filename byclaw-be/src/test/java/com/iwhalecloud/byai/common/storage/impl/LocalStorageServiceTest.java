package com.iwhalecloud.byai.common.storage.impl;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;

class LocalStorageServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void getStorageTypeUsesFileAliasWhenConfigured() {
        LocalStorageService service = service("file");

        assertThat(service.getStorageType()).isEqualTo("file");
    }

    @Test
    void putPersistsMetadataWithConfiguredFileStorageType() {
        LocalStorageService service = service("file");

        FileMetadata metadata = service.put(StorageLocation.of("default", "byclaw-user001", "by/report.txt"),
            new ByteArrayInputStream("demo".getBytes()), 4L, "text/plain");

        assertThat(metadata.getStorageType()).isEqualTo("file");
        assertThat(tempDir.resolve("byclaw-user001/by/report.txt")).exists();
    }

    private LocalStorageService service(String configuredStorageType) {
        LocalStorageService service = new LocalStorageService();
        ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
        ReflectionTestUtils.setField(service, "configuredStorageType", configuredStorageType);
        return service;
    }
}
