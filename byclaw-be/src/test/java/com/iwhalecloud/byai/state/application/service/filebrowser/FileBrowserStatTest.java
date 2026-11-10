package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.storage.*;
import com.iwhalecloud.byai.common.storage.impl.LocalStorageService;
import com.iwhalecloud.byai.common.storage.model.*;
import java.nio.file.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class FileBrowserStatTest {
    @TempDir Path root;

    private FileStat value(Boolean exists, Boolean directory) {
        FileStat result = new FileStat();result.setExists(exists);result.setDirectory(directory);return result;
    }

    @Test void physicalDirectoryProbeUsesOneTargetStatWithoutAnyListing() {
        ObjectStorage files = mock(ObjectStorage.class);
        when(files.supportsStat()).thenReturn(true);
        when(files.stat(any())).thenReturn(value(true, true));
        assertThat(new MinioFileBrowserProvider(files).folderExists("alice", 10L, "/.sessions/", "123")).isTrue();
        ArgumentCaptor<StorageLocation> target = ArgumentCaptor.forClass(StorageLocation.class);
        verify(files).stat(target.capture());verify(files, never()).list(any(), any());
        assertThat(target.getValue().getNamespace()).isEqualTo("workspace");
        assertThat(target.getValue().getBucketOrRoot()).isEqualTo("byclaw-alice");
        assertThat(target.getValue().getPath()).isEqualTo("/by/.sessions/123");
        assertThat(target.getValue().getShareType()).isEqualTo("private");
    }

    @Test void regularFilesAndMissingTargetsAreNotDirectories() {
        ObjectStorage files = mock(ObjectStorage.class);when(files.supportsStat()).thenReturn(true);
        when(files.stat(any())).thenReturn(value(true, false), value(false, null));
        var provider = new MinioFileBrowserProvider(files);
        assertThat(provider.folderExists("alice", 10L, "/", "entry")).isFalse();
        assertThat(provider.folderExists("alice", 10L, "/", "missing")).isFalse();
        verify(files, times(2)).stat(any());verify(files, never()).list(any(), any());
    }

    @Test void failedOrMalformedStatNeverFallsBackToListing() {
        ObjectStorage files = mock(ObjectStorage.class);when(files.supportsStat()).thenReturn(true);
        RuntimeException denied = new IllegalStateException("permission denied");
        when(files.stat(any())).thenThrow(denied).thenReturn(value(null, null), value(true, null), null);
        var provider = new MinioFileBrowserProvider(files);
        assertThatThrownBy(() -> provider.folderExists("alice", 10L, "/", "entry")).isSameAs(denied);
        for (int i = 0; i < 3; i++) assertThatThrownBy(() -> provider.folderExists("alice", 10L, "/", "entry"))
            .isInstanceOf(IllegalStateException.class);
        verify(files, never()).list(any(), any());
    }

    @Test void objectStorageVirtualPrefixesKeepTheirExistingListingContract() {
        ObjectStorage files = mock(ObjectStorage.class);
        when(files.list(any(), any())).thenReturn(List.of(StorageObject.builder().path("by/docs/").isDir(true).build()));
        assertThat(new MinioFileBrowserProvider(files).folderExists("alice", 10L, "/", "docs")).isTrue();
        verify(files, never()).stat(any());
        ArgumentCaptor<StoragePrefix> prefix = ArgumentCaptor.forClass(StoragePrefix.class);
        verify(files).list(prefix.capture(), isNull());
        assertThat(prefix.getValue().isRecursive()).isFalse();assertThat(prefix.getValue().getPrefix()).isEqualTo("by/");
    }

    @Test void localStatReportsDirectoryFileAndAbsenceWithoutListing() throws Exception {
        LocalStorageService files = new LocalStorageService() {
            @Override public List<StorageObject> list(StoragePrefix prefix, Integer depth) { throw new AssertionError("stat must not enumerate"); }
        };
        ReflectionTestUtils.setField(files, "basePath", root.toString());
        Files.createDirectories(root.resolve("byclaw-alice/by/docs"));Files.writeString(root.resolve("byclaw-alice/by/file"), "content");
        assertThat(files.supportsStat()).isTrue();
        assertThat(files.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/docs")).getDirectory()).isTrue();
        FileStat regular = files.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/file"));
        assertThat(regular.getExists()).isTrue();assertThat(regular.getDirectory()).isFalse();assertThat(regular.getSize()).isEqualTo(7L);
        FileStat missing = files.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/missing"));
        assertThat(missing.getExists()).isFalse();assertThat(missing.getDirectory()).isNull();
    }

    @Test void localStatRejectsSymbolicLinksAndUnsafePaths() throws Exception {
        LocalStorageService files = new LocalStorageService();ReflectionTestUtils.setField(files, "basePath", root.toString());
        Files.createDirectories(root.resolve("byclaw-alice/by/docs"));
        Files.createSymbolicLink(root.resolve("byclaw-alice/by/link"), root.resolve("byclaw-alice/by/docs"));
        assertThatThrownBy(() -> files.stat(StorageLocation.of("workspace", "byclaw-alice", "/by/link")))
            .isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> files.stat(StorageLocation.of("workspace", "byclaw-alice", "../../outside")))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
