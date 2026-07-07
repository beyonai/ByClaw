package com.iwhalecloud.byai.common.storage;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;

@ExtendWith(MockitoExtension.class)
public class ByclawResourceFSTest {

    private static final String NAMESPACE = "byclaw-fs";
    private static final String RESOURCE_BUCKET_OR_ROOT = "byclaw";
    private static final String SHARE_TYPE_PUBLIC = "public";

    @Mock
    private ObjectStorage objectStorage;

    @Test
    void init_delegatesFixedResourceBucketsToObjectStorage() {
        ByclawResourceFS byclawResourceFS = new ByclawResourceFS(objectStorage);

        byclawResourceFS.init();

        verify(objectStorage).init("byclaw");
        verify(objectStorage).mount("byclaw");
        verify(objectStorage).init("byclaw-datacloud");
        verify(objectStorage).mount("byclaw-datacloud");
        verify(objectStorage).init("byclaw-qa");
        verify(objectStorage).mount("byclaw-qa");
    }

    @Test
    void read_usesResourceBucket() {
        ByclawResourceFS byclawResourceFS = new ByclawResourceFS(objectStorage);
        InputStream expected = new ByteArrayInputStream(new byte[] {1});
        when(objectStorage.get(any())).thenReturn(expected);

        InputStream actual = byclawResourceFS.read("/.resource/toolkit/output.md");

        assertThat(actual).isSameAs(expected);
        verify(objectStorage).get(StorageLocation.of(NAMESPACE, RESOURCE_BUCKET_OR_ROOT,
            "/.resource/toolkit/output.md", SHARE_TYPE_PUBLIC));
    }

    @Test
    void write_usesResourceBucket() {
        ByclawResourceFS byclawResourceFS = new ByclawResourceFS(objectStorage);
        MockMultipartFile multipartFile = new MockMultipartFile("file", "tool.json", "application/json",
            "{\"a\":1}".getBytes());
        FileMetadata metadata = new FileMetadata();
        when(objectStorage.put(any(), any(), anyLong(), any())).thenReturn(metadata);

        FileMetadata actual = byclawResourceFS.write(multipartFile, "/.resource/toolkit/");

        assertThat(actual).isSameAs(metadata);
        verify(objectStorage).put(
            eq(StorageLocation.of(NAMESPACE, RESOURCE_BUCKET_OR_ROOT, "/.resource/toolkit/tool.json",
                SHARE_TYPE_PUBLIC)),
            any(), eq(multipartFile.getSize()), eq(multipartFile.getContentType()));
    }

    @Test
    void list_usesResourceBucket() {
        ByclawResourceFS byclawResourceFS = new ByclawResourceFS(objectStorage);
        when(objectStorage.list(any(), any())).thenReturn(List.of(
            StorageObject.builder().path("byclaw/.resource/toolkit/tool-a/config.json").build(),
            StorageObject.builder().path("byclaw/.resource/toolkit/tool-b/config.json").build()));

        List<String> paths = byclawResourceFS.list("/.resource/toolkit/", null);

        assertThat(paths).containsExactly(
            "/.resource/toolkit/tool-a/config.json",
            "/.resource/toolkit/tool-b/config.json");
        verify(objectStorage).list(StoragePrefix.of(NAMESPACE, RESOURCE_BUCKET_OR_ROOT, "/.resource/toolkit/",
            SHARE_TYPE_PUBLIC), 3);
    }

    @Test
    void list_withExplicitDepthFiltersByRelativeDepth() {
        ByclawResourceFS byclawResourceFS = new ByclawResourceFS(objectStorage);
        when(objectStorage.list(any(), any())).thenReturn(List.of(
            StorageObject.builder().path("byclaw/.resource/toolkit/tool-a/config.json").build()));

        List<String> paths = byclawResourceFS.list("/.resource/toolkit/", 2);

        assertThat(paths).containsExactly(
            "/.resource/toolkit/tool-a/config.json");
        verify(objectStorage).list(StoragePrefix.of(NAMESPACE, RESOURCE_BUCKET_OR_ROOT, "/.resource/toolkit/",
            SHARE_TYPE_PUBLIC), 2);
    }
}
