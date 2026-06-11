package com.iwhalecloud.byai.common.storage.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.model.StorageLocation;

class LocalStorageServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void put_normalizesAbsoluteObjectPathUnderBucketRoot() {
        LocalStorageService service = newService();

        service.put(StorageLocation.of("byclaw-fs", "byclaw-user001", "/by/.openclaw/openclaw.json", "private"),
            new ByteArrayInputStream("{}".getBytes(StandardCharsets.UTF_8)), 2L, "application/json");

        assertThat(tempDir.resolve("byclaw-user001/by/.openclaw/openclaw.json")).hasContent("{}");
    }

    @Test
    void put_rejectsTraversalAfterPathNormalization() {
        LocalStorageService service = newService();

        assertThatThrownBy(() -> service.put(
            StorageLocation.of("byclaw-fs", "byclaw-user001", "/../escape.txt", "private"),
            new ByteArrayInputStream("x".getBytes(StandardCharsets.UTF_8)), 1L, "text/plain"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("Path traversal detected");
    }

    private LocalStorageService newService() {
        LocalStorageService service = new LocalStorageService();
        ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
        return service;
    }
}
