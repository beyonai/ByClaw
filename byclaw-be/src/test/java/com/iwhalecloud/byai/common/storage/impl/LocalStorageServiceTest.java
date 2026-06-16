package com.iwhalecloud.byai.common.storage.impl;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

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

    @Test
    void putDirectoryMarkerCreatesDirectoryForMountedFileStorage() {
        LocalStorageService service = service("file");

        service.put(StorageLocation.of("default", "byclaw-user001", "by/workspace/"),
            new ByteArrayInputStream(new byte[0]), 0L, "application/x-directory");

        assertThat(tempDir.resolve("byclaw-user001/by/workspace")).isDirectory();
    }

    @Test
    void listNonRecursiveReturnsImmediateFilesAndDirectories() throws Exception {
        LocalStorageService service = service("file");
        Files.createDirectories(tempDir.resolve("byclaw-user001/by/workspace/docs"));
        Files.writeString(tempDir.resolve("byclaw-user001/by/workspace/readme.md"), "readme");
        Files.writeString(tempDir.resolve("byclaw-user001/by/workspace/docs/nested.md"), "nested");

        List<StorageObject> objects = service.list(
            StoragePrefix.of("default", "byclaw-user001", "by/workspace/", "private", false), null);

        assertThat(objects).extracting(StorageObject::getPath)
            .containsExactlyInAnyOrder("by/workspace/docs/", "by/workspace/readme.md");
        assertThat(objects.stream().filter(StorageObject::isDir).map(StorageObject::getPath))
            .containsExactly("by/workspace/docs/");
    }

    @Test
    void listRecursiveReturnsFilesBelowPrefix() throws Exception {
        LocalStorageService service = service("file");
        Files.createDirectories(tempDir.resolve("byclaw-user001/by/workspace/docs"));
        Files.writeString(tempDir.resolve("byclaw-user001/by/workspace/readme.md"), "readme");
        Files.writeString(tempDir.resolve("byclaw-user001/by/workspace/docs/nested.md"), "nested");

        List<StorageObject> objects = service.list(
            StoragePrefix.of("default", "byclaw-user001", "by/workspace/", "private", true), null);

        assertThat(objects).extracting(StorageObject::getPath)
            .containsExactlyInAnyOrder("by/workspace/readme.md", "by/workspace/docs/nested.md");
    }

    @Test
    void deletePrefixRemovesMountedDirectoryTree() throws Exception {
        LocalStorageService service = service("file");
        Files.createDirectories(tempDir.resolve("byclaw-user001/by/workspace/docs"));
        Files.writeString(tempDir.resolve("byclaw-user001/by/workspace/docs/nested.md"), "nested");

        service.deletePrefix(StoragePrefix.of("default", "byclaw-user001", "by/workspace/", "private", true));

        assertThat(tempDir.resolve("byclaw-user001/by/workspace")).doesNotExist();
    }

    private LocalStorageService service(String configuredStorageType) {
        LocalStorageService service = new LocalStorageService();
        ReflectionTestUtils.setField(service, "basePath", tempDir.toString());
        ReflectionTestUtils.setField(service, "configuredStorageType", configuredStorageType);
        return service;
    }
}
