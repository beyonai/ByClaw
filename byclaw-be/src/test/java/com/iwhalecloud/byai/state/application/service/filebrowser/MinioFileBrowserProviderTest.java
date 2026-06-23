package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;

@ExtendWith(MockitoExtension.class)
class MinioFileBrowserProviderTest {

    @Mock
    private ObjectStorage objectStorage;

    @Test
    void listUsesConfiguredObjectStorageWithNonRecursivePrefix() {
        MinioFileBrowserProvider provider = new MinioFileBrowserProvider(objectStorage);
        when(objectStorage.list(any(StoragePrefix.class), eq(null))).thenReturn(List.of(
            StorageObject.builder().bucketOrRoot("byclaw-adminvip").path("by/workspace/docs/").isDir(true).build(),
            StorageObject.builder().bucketOrRoot("byclaw-adminvip").path("by/workspace/readme.md").size(6L).build()));

        List<FileBrowserItemVo> items = provider.list("adminvip", 10005856L, "/workspace/");

        ArgumentCaptor<StoragePrefix> prefixCaptor = ArgumentCaptor.forClass(StoragePrefix.class);
        verify(objectStorage).list(prefixCaptor.capture(), eq(null));
        StoragePrefix prefix = prefixCaptor.getValue();
        assertThat(prefix.getNamespace()).isEqualTo("workspace");
        assertThat(prefix.getBucketOrRoot()).isEqualTo("byclaw-adminvip");
        assertThat(prefix.getPrefix()).isEqualTo("by/workspace/");
        assertThat(prefix.getShareType()).isEqualTo("private");
        assertThat(prefix.isRecursive()).isFalse();

        assertThat(items).hasSize(2);
        assertThat(items.get(0).isDir()).isTrue();
        assertThat(items.get(0).getPath()).isEqualTo("/workspace/docs/");
        assertThat(items.get(1).getName()).isEqualTo("readme.md");
        assertThat(items.get(1).getPath()).isEqualTo("/workspace/readme.md");
        assertThat(items.get(1).getSize()).isEqualTo(6L);
    }

    @Test
    void listTreatsTrailingSlashPathAsDirectory() {
        MinioFileBrowserProvider provider = new MinioFileBrowserProvider(objectStorage);
        when(objectStorage.list(any(StoragePrefix.class), eq(null))).thenReturn(List.of(
            StorageObject.builder().bucketOrRoot("byclaw-adminvip").path("by/workspace/docs/").build()));

        List<FileBrowserItemVo> items = provider.list("adminvip", 10005856L, "/workspace/");

        assertThat(items).hasSize(1);
        assertThat(items.get(0).isDir()).isTrue();
        assertThat(items.get(0).getName()).isEqualTo("docs");
        assertThat(items.get(0).getPath()).isEqualTo("/workspace/docs/");
    }

    @Test
    void uploadWritesFilesThroughObjectStorage() throws Exception {
        MinioFileBrowserProvider provider = new MinioFileBrowserProvider(objectStorage);
        when(objectStorage.put(any(StorageLocation.class), any(), eq(4L), eq("text/plain")))
            .thenReturn(new FileMetadata());

        provider.upload("adminvip", 10005856L, "/workspace/",
            new MockMultipartFile[] {
                new MockMultipartFile("files", "demo.txt", "text/plain", "demo".getBytes())
            });

        ArgumentCaptor<StorageLocation> locationCaptor = ArgumentCaptor.forClass(StorageLocation.class);
        verify(objectStorage).put(locationCaptor.capture(), any(), eq(4L), eq("text/plain"));
        StorageLocation location = locationCaptor.getValue();
        assertThat(location.getNamespace()).isEqualTo("workspace");
        assertThat(location.getBucketOrRoot()).isEqualTo("byclaw-adminvip");
        assertThat(location.getPath()).isEqualTo("/by/workspace/demo.txt");
        assertThat(location.getShareType()).isEqualTo("private");
    }

    @Test
    void downloadReadsThroughObjectStorage() {
        MinioFileBrowserProvider provider = new MinioFileBrowserProvider(objectStorage);
        when(objectStorage.get(any(StorageLocation.class))).thenReturn(new ByteArrayInputStream("demo".getBytes()));

        provider.download("adminvip", 10005856L, "/workspace/demo.txt");

        ArgumentCaptor<StorageLocation> locationCaptor = ArgumentCaptor.forClass(StorageLocation.class);
        verify(objectStorage).get(locationCaptor.capture());
        assertThat(locationCaptor.getValue().getPath()).isEqualTo("/by/workspace/demo.txt");
    }

    @Test
    void deleteDirectoryUsesPrefixDelete() {
        MinioFileBrowserProvider provider = new MinioFileBrowserProvider(objectStorage);

        provider.delete("adminvip", 10005856L, List.of("/workspace/docs/"));

        ArgumentCaptor<StoragePrefix> prefixCaptor = ArgumentCaptor.forClass(StoragePrefix.class);
        verify(objectStorage).deletePrefix(prefixCaptor.capture());
        assertThat(prefixCaptor.getValue().getPrefix()).isEqualTo("by/workspace/docs/");
        assertThat(prefixCaptor.getValue().isRecursive()).isTrue();
    }
}
