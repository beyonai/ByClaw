package com.iwhalecloud.byai.common.storage.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mockStatic;

import java.io.ByteArrayInputStream;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermission;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
@DisabledOnOs(OS.WINDOWS)
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
    void initCreatesBucketRootForMountedFileStorage() throws Exception {
        LocalStorageService service = service("file");

        service.init("byclaw");
        service.mount("byclaw-datacloud");

        assertThat(tempDir.resolve("byclaw")).isDirectory();
        assertThat(tempDir.resolve("byclaw-datacloud")).isDirectory();
        assertThat(Files.getPosixFilePermissions(tempDir.resolve("byclaw")))
            .containsAll(Set.of(
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.GROUP_WRITE,
                PosixFilePermission.OTHERS_WRITE));
    }

    @Test
    void putAppliesSharedPermissionsForMountedFileStorage() throws Exception {
        LocalStorageService service = service("file");

        service.put(StorageLocation.of("default", "byclaw-user001", "by/.openclaw/workspace/skills/SKILL.md"),
            new ByteArrayInputStream("skill".getBytes()), 5L, "text/markdown");

        assertThat(Files.getPosixFilePermissions(tempDir.resolve("byclaw-user001/by/.openclaw/workspace/skills")))
            .containsAll(Set.of(
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.GROUP_WRITE,
                PosixFilePermission.OTHERS_WRITE));
        assertThat(Files.getPosixFilePermissions(tempDir.resolve("byclaw-user001/by/.openclaw/workspace/skills/SKILL.md")))
            .containsAll(Set.of(
                PosixFilePermission.OWNER_WRITE,
                PosixFilePermission.GROUP_WRITE,
                PosixFilePermission.OTHERS_WRITE));
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
        ReflectionTestUtils.setField(service, "sharedPermissionsEnabled", true);
        return service;
    }

    @Test
    void moveRenamesNonEmptyDirectoryWithoutCopyingItsContents() throws Exception {
        LocalStorageService service = service("file");
        Path source = tempDir.resolve("byclaw-user001/by/.sessions/20088980/wechat-analytics");
        Path target = source.resolveSibling("wechat-analytics2");
        Files.createDirectories(source.resolve("nested/empty"));
        Files.writeString(source.resolve("nested/report.md"), "report");

        service.move(StorageLocation.of("workspace", "byclaw-user001", "by/.sessions/20088980/wechat-analytics"),
            StorageLocation.of("workspace", "byclaw-user001", "by/.sessions/20088980/wechat-analytics2"));

        assertThat(source).doesNotExist();
        assertThat(Files.readString(target.resolve("nested/report.md"))).isEqualTo("report");
        assertThat(target.resolve("nested/empty")).isDirectory();
    }

    @Test
    void deleteNonEmptyDirectoryPreservesSiblingAndLinkedContents() throws Exception {
        LocalStorageService service = service("file");
        Path source = tempDir.resolve("byclaw-user001/by/source");
        Path sibling = source.resolveSibling("source-other");
        Files.createDirectories(source.resolve("nested/empty"));
        Files.writeString(source.resolve("nested/report.md"), "report");
        Files.createDirectories(sibling);
        Files.writeString(sibling.resolve("keep.md"), "keep");
        Files.createSymbolicLink(source.resolve("linked"), sibling);

        service.delete(StorageLocation.of("workspace", "byclaw-user001", "by/source"));

        assertThat(source).doesNotExist();
        assertThat(Files.readString(sibling.resolve("keep.md"))).isEqualTo("keep");
    }

    @Test
    void deleteDirectoryLinkOnlyRemovesLink() throws Exception {
        LocalStorageService service = service("local");
        Path target = tempDir.resolve("byclaw-user001/by/target");
        Files.createDirectories(target);
        Files.writeString(target.resolve("keep.md"), "keep");
        Path link = target.resolveSibling("link");
        Files.createSymbolicLink(link, target);

        service.delete(StorageLocation.of("workspace", "byclaw-user001", "by/link"));

        assertThat(Files.exists(link, java.nio.file.LinkOption.NOFOLLOW_LINKS)).isFalse();
        assertThat(Files.readString(target.resolve("keep.md"))).isEqualTo("keep");
    }

    @Test
    void deleteRegularFileAndMissingPathRemainIdempotent() throws Exception {
        LocalStorageService service = service("local");
        Path file = tempDir.resolve("byclaw-user001/by/report.md");
        Files.createDirectories(file.getParent());
        Files.writeString(file, "report");
        StorageLocation location = StorageLocation.of("workspace", "byclaw-user001", "by/report.md");

        service.delete(location);
        service.delete(location);

        assertThat(file).doesNotExist();
        assertThat(file.getParent()).isDirectory();
    }

    @Test
    void moveRenamesRegularFile() throws Exception {
        LocalStorageService service = service("local");
        Path source = tempDir.resolve("byclaw-user001/by/report.md");
        Files.createDirectories(source.getParent());
        Files.writeString(source, "report");

        service.move(StorageLocation.of("workspace", "byclaw-user001", "by/report.md"),
            StorageLocation.of("workspace", "byclaw-user001", "by/renamed.md"));

        assertThat(source).doesNotExist();
        assertThat(Files.readString(source.resolveSibling("renamed.md"))).isEqualTo("report");
    }

    @Test
    void moveRejectsExistingDirectoryWithoutChangingEitherDirectory() throws Exception {
        LocalStorageService service = service("file");
        Path source = tempDir.resolve("byclaw-user001/by/source");
        Path target = source.resolveSibling("target");
        Files.createDirectories(source);
        Files.createDirectories(target);
        Files.writeString(source.resolve("report.md"), "report");

        try (MockedStatic<I18nUtil> i18n = mockStatic(I18nUtil.class)) {
            i18n.when(() -> I18nUtil.get("storage.local.move.failed", "/by/source", "/by/target"))
                .thenReturn("move failed");
            assertThatThrownBy(() -> service.move(
                StorageLocation.of("workspace", "byclaw-user001", "by/source"),
                StorageLocation.of("workspace", "byclaw-user001", "by/target")))
                .isInstanceOf(IllegalStateException.class)
                .hasCauseInstanceOf(FileAlreadyExistsException.class);
        }

        assertThat(Files.readString(source.resolve("report.md"))).isEqualTo("report");
        assertThat(target).isEmptyDirectory();
    }

    @Test
    void moveMissingSourceDoesNotLeaveTargetDirectory() throws Exception {
        LocalStorageService service = service("file");
        try (MockedStatic<I18nUtil> i18n = mockStatic(I18nUtil.class)) {
            i18n.when(() -> I18nUtil.get("storage.local.move.failed", "/by/missing", "/by/target"))
                .thenReturn("move failed");
            assertThatThrownBy(() -> service.move(
                StorageLocation.of("workspace", "byclaw-user001", "by/missing"),
                StorageLocation.of("workspace", "byclaw-user001", "by/target")))
                .isInstanceOf(IllegalStateException.class)
                .hasCauseInstanceOf(NoSuchFileException.class);
        }
        assertThat(tempDir.resolve("byclaw-user001/by/target")).doesNotExist();
    }
}
