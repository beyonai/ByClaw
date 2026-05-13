package com.iwhalecloud.byai.common.storage.impl;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import feign.Request;
import feign.Response;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;

import com.iwhalecloud.byai.common.feign.client.FeignWhaleAgentService;
import com.iwhalecloud.byai.common.feign.request.sandbox.WhaleAgentListFilesRequest;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.WhaleAgentFileItem;
import com.iwhalecloud.byai.common.storage.DefaultFileIngressService;
import com.iwhalecloud.byai.common.storage.FileIngressBackendRegistry;
import com.iwhalecloud.byai.common.storage.config.ObjectStorageConfiguration;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.model.StorageLocation;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.common.storage.util.FileUtil;

class WhaleAgentStorageServiceTest {

    private static final String SHARE_TYPE_PUBLIC = "public";
    private static final String SHARE_TYPE_PRIVATE = "private";

    @Test
    void uploadFile_usesPublicShareTypeAndPrefixesBucketIntoRemotePath() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.uploadFile(any(), any(), any())).thenReturn(KnowledgeResponse.success(null));

        DefaultFileIngressService ingressService = ingressService(feignWhaleAgentService);
        MockMultipartFile file = new MockMultipartFile("file", "openclaw.json", "application/json",
            "{\"name\":\"demo\"}".getBytes());

        FileMetadata metadata = ingressService.uploadFile(file,
            FileStorageContext.sandboxWorkspace("/byclaw/openclaw", "whale-agent"), "byclaw-user001");

        verify(feignWhaleAgentService).uploadFile(eq("/byclaw-user001/byclaw/openclaw/openclaw.json"), eq("public"),
            any());
        assertThat(metadata.getFileUrl()).isEqualTo("/byclaw-user001/byclaw/openclaw/openclaw.json");
        assertThat(metadata.getBucketName()).isEqualTo("byclaw-user001");
        assertThat(metadata.getStorageType()).isEqualTo("whale-agent");
    }

    @Test
    void uploadFile_publicWorkspace_stillUsesPublicShareType() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.uploadFile(any(), any(), any())).thenReturn(KnowledgeResponse.success(null));

        DefaultFileIngressService ingressService = ingressService(feignWhaleAgentService);
        MockMultipartFile file = new MockMultipartFile("file", "report.md", "text/markdown", "# demo".getBytes());

        ingressService.uploadFile(file, FileStorageContext.sandboxWorkspace("/public/reports", "whale-agent"),
            "byclaw-user001");

        verify(feignWhaleAgentService).uploadFile(eq("/byclaw-user001/public/reports/report.md"), eq("public"), any());
    }

    @Test
    void downloadFile_usesPublicShareTypeAndPrefixesBucketIntoRemotePath() throws Exception {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.downloadFile(any())).thenReturn(fileResponse("demo"));

        DefaultFileIngressService ingressService = ingressService(feignWhaleAgentService);
        String fileUrl = FileUtil.generateFileAccessUrl("byclaw-user001", "/byclaw/openclaw.json", "whale-agent");

        try (InputStream inputStream = ingressService.downloadFile(fileUrl)) {
            assertThat(new String(inputStream.readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("demo");
        }

        verify(feignWhaleAgentService).downloadFile(eq(Map.of(
            "filePath", "/byclaw-user001/byclaw/openclaw.json",
            "fileShareType", "public")));
    }

    @Test
    void downloadFile_publicPath_usesPublicShareType() throws Exception {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.downloadFile(any())).thenReturn(fileResponse("ok"));

        DefaultFileIngressService ingressService = ingressService(feignWhaleAgentService);
        String fileUrl = FileUtil.generateFileAccessUrl("byclaw-user001", "/public/report.md", "whale-agent");

        try (InputStream ignored = ingressService.downloadFile(fileUrl)) {
            // no-op
        }

        verify(feignWhaleAgentService).downloadFile(eq(Map.of(
            "filePath", "/byclaw-user001/public/report.md",
            "fileShareType", "public")));
    }

    @Test
    void list_privatePrefix_mapsWhaleAgentEntriesToStorageObjects() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.listFiles(any())).thenReturn(KnowledgeResponse.success(List.of(
            fileItem(true, "byclaw-user001/byclaw/", "byclaw", null),
            fileItem(false, "byclaw-user001/byclaw/openclaw.json", "openclaw.json", 12L))))
            .thenReturn(KnowledgeResponse.success(List.of()));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        List<StorageObject> objects = service.list(StoragePrefix.of("workspace", "byclaw-user001", "/", SHARE_TYPE_PRIVATE),
            null);

        verify(feignWhaleAgentService).listFiles(eq(new WhaleAgentListFilesRequest("/byclaw-user001/", SHARE_TYPE_PRIVATE)));
        assertThat(objects).hasSize(2);
        assertThat(objects.get(0).getPath()).isEqualTo("byclaw-user001/byclaw/");
        assertThat(objects.get(1).getPath()).isEqualTo("byclaw-user001/byclaw/openclaw.json");
        assertThat(objects.get(1).getSize()).isEqualTo(12L);
    }

    @Test
    void list_publicPrefix_keepsRelativePrefixAndUsesProvidedShareTypeForObjectStorage() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.listFiles(any())).thenReturn(KnowledgeResponse.success(List.of(
            fileItem(false, "byclaw-user001/public/reports/report.md", "report.md", 5L))));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        List<StorageObject> objects = service.list(
            StoragePrefix.of("workspace", "byclaw-user001", "/public/reports", SHARE_TYPE_PUBLIC), null);

        verify(feignWhaleAgentService).listFiles(eq(new WhaleAgentListFilesRequest("/byclaw-user001/public/reports",
            SHARE_TYPE_PUBLIC)));
        assertThat(objects).hasSize(1);
        assertThat(objects.get(0).getPath()).isEqualTo("byclaw-user001/public/reports/report.md");
    }

    @Test
    void list_withDepthRecursivelyListsWhaleAgentDirectories() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.listFiles(eq(new WhaleAgentListFilesRequest("/byclaw-user001/public/reports",
            SHARE_TYPE_PUBLIC)))).thenReturn(KnowledgeResponse.success(List.of(
            fileItem(true, "byclaw-user001/public/reports/nested", "nested", null),
            fileItem(false, "byclaw-user001/public/reports/root.md", "root.md", 5L))));
        when(feignWhaleAgentService.listFiles(eq(new WhaleAgentListFilesRequest("/byclaw-user001/public/reports/nested/",
            SHARE_TYPE_PUBLIC)))).thenReturn(KnowledgeResponse.success(List.of(
            fileItem(true, "byclaw-user001/public/reports/nested/deep", "deep", null),
            fileItem(false, "byclaw-user001/public/reports/nested/file.md", "file.md", 6L))));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        List<StorageObject> objects = service.list(
            StoragePrefix.of("workspace", "byclaw-user001", "/public/reports", SHARE_TYPE_PUBLIC), 2);

        assertThat(objects).extracting(StorageObject::getPath).containsExactly(
            "byclaw-user001/public/reports/nested/",
            "byclaw-user001/public/reports/root.md",
            "byclaw-user001/public/reports/nested/deep/",
            "byclaw-user001/public/reports/nested/file.md");
    }

    @Test
    void list_withDepthIncludesFilesFromCurrentLayerThroughMaxDepth() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.listFiles(eq(new WhaleAgentListFilesRequest("/byclaw-user001/public/reports",
            SHARE_TYPE_PUBLIC)))).thenReturn(KnowledgeResponse.success(List.of(
            fileItem(false, "byclaw-user001/public/reports/level1.md", "level1.md", 1L),
            fileItem(true, "byclaw-user001/public/reports/level2", "level2", null))));
        when(feignWhaleAgentService.listFiles(eq(new WhaleAgentListFilesRequest("/byclaw-user001/public/reports/level2/",
            SHARE_TYPE_PUBLIC)))).thenReturn(KnowledgeResponse.success(List.of(
            fileItem(false, "byclaw-user001/public/reports/level2/level2.md", "level2.md", 2L),
            fileItem(true, "byclaw-user001/public/reports/level2/level3", "level3", null))));
        when(feignWhaleAgentService.listFiles(eq(new WhaleAgentListFilesRequest(
            "/byclaw-user001/public/reports/level2/level3/", SHARE_TYPE_PUBLIC))))
            .thenReturn(KnowledgeResponse.success(List.of(
                fileItem(false, "byclaw-user001/public/reports/level2/level3/level3.md", "level3.md", 3L),
                fileItem(true, "byclaw-user001/public/reports/level2/level3/level4", "level4", null))));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        List<StorageObject> objects = service.list(
            StoragePrefix.of("workspace", "byclaw-user001", "/public/reports", SHARE_TYPE_PUBLIC), 3);

        assertThat(objects).extracting(StorageObject::getPath).containsExactly(
            "byclaw-user001/public/reports/level1.md",
            "byclaw-user001/public/reports/level2/",
            "byclaw-user001/public/reports/level2/level2.md",
            "byclaw-user001/public/reports/level2/level3/",
            "byclaw-user001/public/reports/level2/level3/level3.md",
            "byclaw-user001/public/reports/level2/level3/level4/");
        verify(feignWhaleAgentService, never()).listFiles(eq(new WhaleAgentListFilesRequest(
            "/byclaw-user001/public/reports/level2/level3/level4/", SHARE_TYPE_PUBLIC)));
    }

    @Test
    void exists_privatePath_usesPrivateShareTypeAndPrefixesBucketIntoRemotePath() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.existsFile(any())).thenReturn(KnowledgeResponse.success(true));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        boolean exists = service.exists(
            StorageLocation.of("workspace", "byclaw-user001", "/byclaw/openclaw.json", SHARE_TYPE_PRIVATE));

        assertThat(exists).isTrue();
        verify(feignWhaleAgentService).existsFile(eq(
            new WhaleAgentListFilesRequest("/byclaw-user001/byclaw/openclaw.json", SHARE_TYPE_PRIVATE)));
    }

    @Test
    void exists_publicPath_usesProvidedShareTypeForObjectStorage() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.existsFile(any())).thenReturn(KnowledgeResponse.success(false));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        boolean exists = service.exists(
            StorageLocation.of("workspace", "byclaw-user001", "/public/report.md", SHARE_TYPE_PUBLIC));

        assertThat(exists).isFalse();
        verify(feignWhaleAgentService).existsFile(eq(
            new WhaleAgentListFilesRequest("/byclaw-user001/public/report.md", SHARE_TYPE_PUBLIC)));
    }

    @Test
    void delete_privatePath_usesPrivateShareTypeAndPrefixesBucketIntoRemotePath() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.deleteFile(any())).thenReturn(KnowledgeResponse.success(null));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        service.delete(StorageLocation.of("workspace", "byclaw-user001", "/byclaw/openclaw.json", SHARE_TYPE_PRIVATE));

        verify(feignWhaleAgentService).deleteFile(eq(
            new WhaleAgentListFilesRequest("/byclaw-user001/byclaw/openclaw.json", SHARE_TYPE_PRIVATE)));
    }

    @Test
    void delete_publicPath_usesProvidedShareTypeForObjectStorage() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.deleteFile(any())).thenReturn(KnowledgeResponse.success(null));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        service.delete(StorageLocation.of("workspace", "byclaw-user001", "/public/report.md", SHARE_TYPE_PUBLIC));

        verify(feignWhaleAgentService).deleteFile(eq(
            new WhaleAgentListFilesRequest("/byclaw-user001/public/report.md", SHARE_TYPE_PUBLIC)));
        verify(feignWhaleAgentService, never()).existsFile(any());
    }

    @Test
    void deleteFile_publicUrl_usesPublicShareType() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.deleteFile(any())).thenReturn(KnowledgeResponse.success(null));

        DefaultFileIngressService ingressService = ingressService(feignWhaleAgentService);
        String fileUrl = FileUtil.generateFileAccessUrl("byclaw-user001", "/public/report.md", "whale-agent");

        ingressService.deleteFile(fileUrl);

        verify(feignWhaleAgentService).deleteFile(eq(
            new WhaleAgentListFilesRequest("/byclaw-user001/public/report.md", "public")));
    }

    @Test
    void put_usesProvidedShareTypeForStorageLocation() {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.uploadFile(any(), any(), any())).thenReturn(KnowledgeResponse.success(null));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        FileMetadata metadata = service.put(
            StorageLocation.of("workspace", "byclaw-user001", "/public/report.md", SHARE_TYPE_PUBLIC),
            new java.io.ByteArrayInputStream("hello".getBytes(StandardCharsets.UTF_8)),
            5L,
            "text/markdown");

        verify(feignWhaleAgentService).uploadFile(eq("/byclaw-user001/public/report.md"), eq(SHARE_TYPE_PUBLIC), any());
        assertThat(metadata.getFileUrl()).isEqualTo("/byclaw-user001/public/report.md");
        assertThat(metadata.getFileName()).isEqualTo("report.md");
    }

    @Test
    void get_usesProvidedShareTypeForStorageLocation() throws Exception {
        FeignWhaleAgentService feignWhaleAgentService = mock(FeignWhaleAgentService.class);
        when(feignWhaleAgentService.downloadFile(any())).thenReturn(fileResponse("hello"));

        WhaleAgentStorageService service = objectStorage(feignWhaleAgentService);
        try (InputStream inputStream = service.get(
            StorageLocation.of("workspace", "byclaw-user001", "/public/report.md", SHARE_TYPE_PUBLIC))) {
            assertThat(new String(inputStream.readAllBytes(), StandardCharsets.UTF_8)).isEqualTo("hello");
        }

        verify(feignWhaleAgentService).downloadFile(eq(Map.of(
            "filePath", "/byclaw-user001/public/report.md",
            "fileShareType", SHARE_TYPE_PUBLIC)));
    }

    private DefaultFileIngressService ingressService(FeignWhaleAgentService feignWhaleAgentService) {
        FileIngressBackendRegistry backendRegistry = mock(FileIngressBackendRegistry.class);
        ObjectStorageConfiguration configuration = mock(ObjectStorageConfiguration.class);
        WhaleAgentStorageService backend = objectStorage(feignWhaleAgentService);
        when(backendRegistry.getConfiguredBackend()).thenReturn(backend);
        when(backendRegistry.getBackend("whale-agent")).thenReturn(backend);
        return new DefaultFileIngressService(backendRegistry, configuration);
    }

    private WhaleAgentStorageService objectStorage(FeignWhaleAgentService feignWhaleAgentService) {
        WhaleAgentStorageService service = new WhaleAgentStorageService();
        service.feignWhaleAgentService = feignWhaleAgentService;
        return service;
    }

    private Response fileResponse(String content) {
        return Response.builder()
            .status(200)
            .reason("OK")
            .request(Request.create(Request.HttpMethod.POST, "/downloadFile", Map.of(), null, StandardCharsets.UTF_8,
                null))
            .body(content.getBytes(StandardCharsets.UTF_8))
            .build();
    }

    private WhaleAgentFileItem fileItem(boolean directory, String filePath, String name, Long size) {
        WhaleAgentFileItem item = new WhaleAgentFileItem();
        item.setDirectory(directory);
        item.setFilePath(filePath);
        item.setName(name);
        item.setSize(size);
        return item;
    }
}
