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

class FeignPythonBuildServiceTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    @Test
    void downloadFailuresUseTheRequestLanguageAndPreserveProviderDetails() {
        FeignPythonBuildService service = new FeignPythonBuildService();
        String path = "/文件/9007199254740993";
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse", null, path))
            .isInstanceOf(BaseException.class)
            .hasMessage("调用 Python 构建服务下载接口失败，响应体为空: " + path);
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse", null, path))
            .isInstanceOf(BaseException.class)
            .hasMessage("Empty response from the file download service: " + path);
        byte[] response = "{\"resultCode\":\"-1\",\"resultMsg\":\"第三方原始错误\"}"
            .getBytes(StandardCharsets.UTF_8);
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "validateDownloadResponse",
            new ByteArrayInputStream(response), path)).hasMessage("第三方原始错误");
    }

    @Test void explicitActorAuthIgnoresAmbientLoginForQaDownload() throws Exception {
        var server = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1", 0), 0);
        var received = new java.util.concurrent.atomic.AtomicReference<String>();
        server.createContext("/", exchange -> { received.set(exchange.getRequestHeaders().getFirst("Beyond-Token"));
            exchange.sendResponseHeaders(200,1);exchange.getResponseBody().write(42);exchange.close(); });server.start();
        var actor=new com.iwhalecloud.byai.common.login.bean.LoginInfo();actor.setUserId(20L);actor.setEnterpriseId(10L);actor.setUserCode("actor");
        var ambient=new com.iwhalecloud.byai.common.login.bean.LoginInfo();ambient.setUserId(21L);ambient.setEnterpriseId(11L);ambient.setUserCode("ambient");
        com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.setLoginInfo(ambient);
        try {
            var service=new FeignPythonBuildService();
            var resolver=org.mockito.Mockito.mock(KnowledgeServiceEndpointResolver.class);var paths=org.mockito.Mockito.mock(KnowledgeServicePathResolver.class);
            org.mockito.Mockito.when(resolver.resolveByKnCode(null)).thenReturn(KnowledgeServiceEndpoint.forDirectUrl("http://127.0.0.1:"+server.getAddress().getPort()));
            org.mockito.Mockito.when(paths.resolveByKnCodeAndOperation(null,KnowledgeServiceOperation.DOWNLOAD_FILE)).thenReturn("/download");
            var jwt=org.mockito.Mockito.mock(com.iwhalecloud.byai.common.jwt.JwtService.class);org.mockito.Mockito.when(jwt.createJwt(actor)).thenReturn("actor-token");
            ReflectionTestUtils.setField(service,"knowledgeServiceEndpointResolver",resolver);ReflectionTestUtils.setField(service,"knowledgeServicePathResolver",paths);ReflectionTestUtils.setField(service,"jwtService",jwt);
            try(var stream=service.fileDownloadForActor(null,60L,actor)) {assertThat(stream.read()).isEqualTo(42);}
            assertThat(received.get()).isEqualTo("actor-token");org.mockito.Mockito.verify(jwt,org.mockito.Mockito.never()).createJwt(ambient);
        } finally {com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.clearLoginInfo();server.stop(0);}
    }

    @Test
    void gatewayOpeningTimeoutIncludesDiscovery() throws Exception {
        var service = new FeignPythonBuildService();
        var resolver = org.mockito.Mockito.mock(KnowledgeServiceEndpointResolver.class);
        var paths = org.mockito.Mockito.mock(KnowledgeServicePathResolver.class);
        var discovery = org.mockito.Mockito.mock(com.iwhaleai.byai.framework.core.discovery.DiscoveryClient.class);
        var release = new java.util.concurrent.CountDownLatch(1);
        org.mockito.Mockito.when(resolver.resolveByKnCode(null)).thenReturn(KnowledgeServiceEndpoint.forDiscovery("qa"));
        org.mockito.Mockito.when(discovery.discover("qa")).thenAnswer(invocation -> {
            release.await(3, java.util.concurrent.TimeUnit.SECONDS);
            return java.util.Optional.empty();
        });
        ReflectionTestUtils.setField(service, "knowledgeServiceEndpointResolver", resolver);
        ReflectionTestUtils.setField(service, "knowledgeServicePathResolver", paths);
        ReflectionTestUtils.setField(service, "discoveryClient", discovery);
        ReflectionTestUtils.setField(service, "gatewaySecondTimeOut", 1L);
        try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var future = executor.submit(() -> service.fileDownload(null, null));
            try {
                assertThatThrownBy(() -> future.get(2, java.util.concurrent.TimeUnit.SECONDS))
                    .isInstanceOf(java.util.concurrent.ExecutionException.class)
                    .hasRootCauseInstanceOf(java.util.concurrent.TimeoutException.class);
            } finally { release.countDown(); }
        }
    }

    @Test
    void directDownloadDoesNotPreReadWholeBody() throws Exception {
        assertStreamingDownload(false, 200);
    }

    @Test
    void discoveryDownloadDoesNotPreReadWholeBody() throws Exception {
        assertStreamingDownload(true, 200);
    }

    @Test
    void discoveryErrorDoesNotDrainResponse() throws Exception {
        assertStreamingDownload(true, 503);
    }

    private void assertStreamingDownload(boolean discovery, int status) throws Exception {
        try (var fixture = new com.iwhalecloud.byai.common.io.StreamingHttpFixture(status);
             var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
            var service = new FeignPythonBuildService();
            var resolver = org.mockito.Mockito.mock(KnowledgeServiceEndpointResolver.class);
            var paths = org.mockito.Mockito.mock(KnowledgeServicePathResolver.class);
            org.mockito.Mockito.when(paths.resolveByKnCodeAndOperation(null, KnowledgeServiceOperation.DOWNLOAD_FILE))
                .thenReturn("/download");
            org.mockito.Mockito.when(resolver.resolveByKnCode(null)).thenReturn(discovery
                ? KnowledgeServiceEndpoint.forDiscovery("qa") : KnowledgeServiceEndpoint.forDirectUrl(fixture.url()));
            ReflectionTestUtils.setField(service, "knowledgeServiceEndpointResolver", resolver);
            ReflectionTestUtils.setField(service, "knowledgeServicePathResolver", paths);
            if (discovery) {
                var client = org.mockito.Mockito.mock(com.iwhaleai.byai.framework.core.discovery.DiscoveryClient.class);
                var instance = org.mockito.Mockito.mock(com.iwhaleai.byai.framework.core.discovery.ServiceInstance.class);
                org.mockito.Mockito.when(instance.getProtocol()).thenReturn("http");
                org.mockito.Mockito.when(instance.getHost()).thenReturn("127.0.0.1");
                org.mockito.Mockito.when(instance.getPort()).thenReturn(fixture.server.getAddress().getPort());
                org.mockito.Mockito.when(instance.getPathPrefix()).thenReturn("/prefix");
                org.mockito.Mockito.when(client.discover("qa")).thenReturn(java.util.Optional.of(instance));
                org.mockito.Mockito.when(client.discover("qa", 30000L)).thenReturn(java.util.Optional.of(instance));
                ReflectionTestUtils.setField(service, "discoveryClient", client);
                ReflectionTestUtils.setField(service, "discoveryHttpClient",
                    com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient.builder().discoveryClient(client).build());
            }
            var future = executor.submit(() -> service.fileDownload(null, 123L));
            if (status != 200) {
                try {
                    assertThatThrownBy(() -> future.get(2, java.util.concurrent.TimeUnit.SECONDS))
                        .isInstanceOf(java.util.concurrent.ExecutionException.class);
                    assertThat(fixture.release.getCount()).isEqualTo(1);
                } finally { fixture.release.countDown(); }
                return;
            }
            try (InputStream stream = future.get(2, java.util.concurrent.TimeUnit.SECONDS)) {
                assertThat(stream.readNBytes(4096)).containsOnly((byte) 'x');
                assertThat(fixture.release.getCount()).isEqualTo(1);
                assertThat(fixture.resourceId).isEqualTo("123");
                assertThat(fixture.requestPath).isEqualTo(discovery ? "/prefix/download" : "/download");
            } finally { fixture.release.countDown(); }
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
