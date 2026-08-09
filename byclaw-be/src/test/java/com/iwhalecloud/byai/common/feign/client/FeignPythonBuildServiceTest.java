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
    void buildHeaders_addsResourceContextOnlyWhenProvided() {
        FeignPythonBuildService service = new FeignPythonBuildService();

        Map<String, String> resourceHeaders = ReflectionTestUtils.invokeMethod(service, "buildHeaders", 10001L);
        Map<String, String> uploadHeaders = ReflectionTestUtils.invokeMethod(service, "buildUploadHeaders", 10001L);
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
