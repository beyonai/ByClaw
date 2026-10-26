package com.iwhalecloud.byai.common.feign.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.common.exception.BaseException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class FeignPythonBuildServiceTest {

    @Test
    void uploadLetsTheHttpClientSupplyTheMultipartBoundary() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var contentType = new java.util.concurrent.atomic.AtomicReference<String>();
        var body = new java.util.concurrent.atomic.AtomicReference<String>();
        var resource = new java.util.concurrent.atomic.AtomicReference<String>();
        server.createContext("/upload", exchange -> {
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            resource.set(exchange.getRequestHeaders().getFirst(FeignPythonBuildService.RESOURCE_ID_HEADER));
            body.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = "{}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        var service = new FeignPythonBuildService();
        Map<String, String> original = Map.of("content-type", "application/json",
            FeignPythonBuildService.RESOURCE_ID_HEADER, "20");
        Map<String, String> headers = ReflectionTestUtils.invokeMethod(service, "buildUploadHeaders", original);
        try (var client = com.iwhaleai.byai.framework.util.http.ByHttpClient.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).timeout(5).build()) {
            client.upload("/upload", "random_hello.txt", "fileContent",
                () -> new ByteArrayInputStream("hello".getBytes(StandardCharsets.UTF_8)), headers,
                Map.of("knCode", "personal-test", "filePath", "/random_hello.txt"))
                .get(10, java.util.concurrent.TimeUnit.SECONDS);
            assertThat(contentType.get()).contains("multipart/form-data", "boundary=");
            String boundary = contentType.get().split("boundary=", 2)[1].replace("\"", "");
            assertThat(body.get()).contains("--" + boundary, "random_hello.txt", "hello", "personal-test");
            assertThat(resource.get()).isEqualTo("20");
            assertThat(original).containsEntry("content-type", "application/json");
        } finally {
            server.stop(0);
        }
    }

    @Test
    void updateKnowledgeItem_usesCanonicalOperationAndPath() {
        assertThat(KnowledgeServiceOperation.UPDATE_FILE.getOperationId()).isEqualTo("updateFile");
        assertThat(KnowledgeServiceOperation.UPDATE_FILE.getLocalPath()).isEqualTo("/api/v1/knowledgeItems/update");
    }

    @Test
    void getKnowledgeFileMetadata_usesCanonicalOperationAndPath() {
        assertThat(KnowledgeServiceOperation.GET_FILE_METADATA.getOperationId()).isEqualTo("getFileMetadata");
        assertThat(KnowledgeServiceOperation.GET_FILE_METADATA.getLocalPath())
            .isEqualTo("/api/v1/knowledgeItems/metadata/get");
    }

    @Test
    void updateKnowledgeFileMetadata_usesCanonicalOperationAndPath() {
        assertThat(KnowledgeServiceOperation.UPDATE_FILE_METADATA.getOperationId()).isEqualTo("updateFileMetadata");
        assertThat(KnowledgeServiceOperation.UPDATE_FILE_METADATA.getLocalPath())
            .isEqualTo("/api/v1/knowledgeItems/metadata/update");
    }

    @Test
    void buildHeaders_addsResourceContextOnlyWhenProvided() {
        FeignPythonBuildService service = new FeignPythonBuildService();

        Map<String, String> resourceHeaders = ReflectionTestUtils.invokeMethod(service, "buildHeaders", 10001L);
        Map<String, String> uploadHeaders = ReflectionTestUtils.invokeMethod(service, "buildUploadHeaders",
            Map.of(FeignPythonBuildService.RESOURCE_ID_HEADER, "10001"));
        Map<String, String> legacyHeaders = ReflectionTestUtils.invokeMethod(service, "buildHeaders");

        assertThat(resourceHeaders).containsEntry(FeignPythonBuildService.RESOURCE_ID_HEADER, "10001");
        assertThat(uploadHeaders).containsEntry(FeignPythonBuildService.RESOURCE_ID_HEADER, "10001");
        assertThat(legacyHeaders).doesNotContainKey(FeignPythonBuildService.RESOURCE_ID_HEADER);
    }

    @Test
    void resourceCalls_useCanonicalKnowledgeServicePaths() {
        assertThat(KnowledgeServiceOperation.UPLOAD_FILE.getLocalPath())
            .isEqualTo("/api/v1/knowledgeItems/import");
        assertThat(KnowledgeServiceOperation.KNOWLEDGE_BUILD.getLocalPath())
            .isEqualTo("/api/v1/fileToMarkdownIndex");
        assertThat(KnowledgeServiceOperation.CREATE_DIR.getLocalPath())
            .isEqualTo("/api/v1/directories/create");
        assertThat(KnowledgeServiceOperation.EDIT_DIR.getLocalPath())
            .isEqualTo("/api/v1/directories/update");
        assertThat(KnowledgeServiceOperation.DELETE_DIR.getLocalPath())
            .isEqualTo("/api/v1/directories/delete");
        assertThat(KnowledgeServiceOperation.LIST_DIR.getLocalPath()).isEqualTo("/api/v1/listDir");
        assertThat(KnowledgeServiceOperation.READ_FILE.getLocalPath()).isEqualTo("/api/v1/readFile");
        assertThat(KnowledgeServiceOperation.BUILD_RESULT.getLocalPath()).isEqualTo("/api/v1/buildResult");
        assertThat(KnowledgeServiceOperation.DOWNLOAD_FILE.getLocalPath()).isEqualTo("/api/v1/downloadFile");
        assertThat(KnowledgeServiceOperation.KNOWLEDGE_METADATA_SEARCH.getLocalPath())
            .isEqualTo("/api/v1/knowledgeItems/metadataSearch");
    }

    @Test
    void validateDownloadResponse_rejectsQaFailureEnvelope() {
        FeignPythonBuildService service = new FeignPythonBuildService();
        byte[] response = "{\"resultCode\":\"-1\",\"resultMsg\":\"file not found\",\"resultObject\":{}}"
            .getBytes(StandardCharsets.UTF_8);

        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse",
            new ByteArrayInputStream(response), "/api/v1/downloadFile"))
            .isInstanceOf(BaseException.class)
            .hasMessage("file not found");
    }

    @Test
    void validateDownloadResponse_preservesRegularFileContent() throws Exception {
        FeignPythonBuildService service = new FeignPythonBuildService();
        byte[] response = "{\"document\":\"regular json file\"}".getBytes(StandardCharsets.UTF_8);

        InputStream validated = ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse",
            new ByteArrayInputStream(response), "/api/v1/downloadFile");

        assertThat(validated).isNotNull();
        assertThat(validated.readAllBytes()).isEqualTo(response);
    }
}
