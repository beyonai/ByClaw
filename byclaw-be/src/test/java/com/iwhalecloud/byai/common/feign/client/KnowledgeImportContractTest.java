package com.iwhalecloud.byai.common.feign.client;

import com.alibaba.fastjson.JSON;
import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileImport;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbKnowledgeFileCount;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class KnowledgeImportContractTest extends com.iwhalecloud.byai.common.i18n.I18nTestSupport {

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void importForwardsExplicitOptionsAndLeavesDefaultsToQa(boolean discovery) throws Exception {
        try (var fixture = new Fixture(discovery, KnowledgeServiceOperation.UPLOAD_FILE)) {
            fixture.response = """
                {"resultCode":"0","resultObject":{"data":[{"filePath":"/docs/raw.zip","success":true,"error":null}],
                 "summary":{"total":1,"succeeded":1,"failed":0},"postProcessErrors":["compensation failed"]}}
                """;
            KbFileImport request = new KbFileImport();
            request.setKnCode("kb-1");
            request.setFilePath("/docs/raw.zip");
            request.setMultipartFile(new MockMultipartFile("fileContent", "raw.zip", "application/zip", "RAW-ZIP-BYTES".getBytes(StandardCharsets.UTF_8)));
            request.setExtractZip(false);
            request.setProcessFrontMatter(false);
            request.setSkipIfDuplicate(true);
            request.setMetadata("{\"owner\":\"HR\",\"enabled\":false,\"priority\":0}");

            var result = fixture.service.importKnowledgeItem(request, Map.of(FeignPythonBuildService.RESOURCE_ID_HEADER, "42"));

            assertThat(fixture.field("extractZip")).isEqualTo("false");
            assertThat(fixture.field("processFrontMatter")).isEqualTo("false");
            assertThat(fixture.field("skipIfDuplicate")).isEqualTo("true");
            assertThat(fixture.field("metadata")).isEqualTo(request.getMetadata());
            assertThat(fixture.field("filePath")).isEqualTo("/docs/raw.zip");
            assertThat(fixture.field("fileContent")).isEqualTo("RAW-ZIP-BYTES");
            assertThat(result.getResultObject().getData()).singleElement().satisfies(item -> {
                assertThat(item.getFilePath()).isEqualTo("/docs/raw.zip");
                assertThat(item.getSuccess()).isTrue();
            });
            assertThat(result.getResultObject().getPostProcessErrors()).containsExactly("compensation failed");
            if (discovery) assertThat(fixture.resourceId).isEqualTo("42");

            request.setExtractZip(null);
            request.setMetadata(null);
            request.setProcessFrontMatter(null);
            fixture.service.importKnowledgeItem(request, Map.of());
            assertThat(fixture.body).doesNotContain("name=\"extractZip\"", "name=\"metadata\"", "name=\"processFrontMatter\"");
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void cloudOverwriteUpdateAlsoForwardsExplicitMetadata(boolean discovery) throws Exception {
        try (var fixture = new Fixture(discovery, KnowledgeServiceOperation.UPDATE_FILE)) {
            KbFileUpdate request = new KbFileUpdate();
            request.setKnCode("kb-1");
            request.setFilePath("/docs/old.md");
            request.setMetadata("{\"owner\":\"HR\"}");
            request.setMultipartFile(new MockMultipartFile("fileContent", "old.md", "text/markdown", new byte[]{1}));
            fixture.service.updateKnowledgeItem(request, Map.of());
            assertThat(fixture.field("metadata")).isEqualTo(request.getMetadata());
        }
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void fileCountPreservesZeroLargeCountsAndProviderErrors(boolean discovery) throws Exception {
        try (var fixture = new Fixture(discovery, KnowledgeServiceOperation.FILE_COUNT)) {
            KbKnowledgeFileCount request = new KbKnowledgeFileCount();
            request.setKnCode("kb-1");
            for (long count : new long[]{0, 2147483648L}) {
                fixture.response = "{\"resultCode\":\"0\",\"resultObject\":{\"fileCount\":" + count + "}}";
                var result = fixture.service.fileCount(request, 42L);
                assertThat(result.getResultObject().getFileCount()).isEqualTo(count);
                assertThat(JSON.parseObject(fixture.body).getString("knCode")).isEqualTo("kb-1");
                if (discovery) assertThat(fixture.resourceId).isEqualTo("42");
            }
            fixture.status = 422;
            fixture.response = "{\"resultCode\":\"-1\",\"resultMsg\":\"knowledge base not found: kb-1\",\"resultObject\":{}}";
            assertThatThrownBy(() -> fixture.service.fileCount(request, 42L))
                .isInstanceOf(BaseException.class).hasMessageContaining("knowledge base not found: kb-1");
        }
    }

    private static class Fixture implements AutoCloseable {
        final HttpServer server;
        final FeignPythonBuildService service = new FeignPythonBuildService();
        volatile String body;
        volatile String resourceId;
        volatile String response = "{\"resultCode\":\"0\",\"resultObject\":{}}";
        volatile int status = 200;

        Fixture(boolean discovery, KnowledgeServiceOperation operation) throws Exception {
            server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            server.createContext(operation.getLocalPath(), exchange -> {
                body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                resourceId = exchange.getRequestHeaders().getFirst(FeignPythonBuildService.RESOURCE_ID_HEADER);
                byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
                exchange.getResponseHeaders().set("Content-Type", "application/json");
                exchange.sendResponseHeaders(status, bytes.length);
                exchange.getResponseBody().write(bytes);
                exchange.close();
            });
            server.start();
            var resolver = mock(KnowledgeServiceEndpointResolver.class);
            var paths = mock(KnowledgeServicePathResolver.class);
            when(paths.resolveByKnCodeAndOperation("kb-1", operation)).thenReturn(operation.getLocalPath());
            when(resolver.resolveByKnCode("kb-1")).thenReturn(discovery
                ? KnowledgeServiceEndpoint.forDiscovery("qa")
                : KnowledgeServiceEndpoint.forDirectUrl("http://127.0.0.1:" + server.getAddress().getPort()));
            ReflectionTestUtils.setField(service, "knowledgeServiceEndpointResolver", resolver);
            ReflectionTestUtils.setField(service, "knowledgeServicePathResolver", paths);
            if (discovery) {
                var client = mock(DiscoveryClient.class);
                var instance = mock(ServiceInstance.class);
                when(instance.getProtocol()).thenReturn("http");
                when(instance.getHost()).thenReturn("127.0.0.1");
                when(instance.getPort()).thenReturn(server.getAddress().getPort());
                when(client.discover("qa")).thenReturn(Optional.of(instance));
                when(client.discover("qa", 30000L)).thenReturn(Optional.of(instance));
                ReflectionTestUtils.setField(service, "discoveryHttpClient",
                    DiscoveryHttpClient.builder().discoveryClient(client).build());
            }
        }

        String field(String name) {
            int header = body.indexOf("name=\"" + name + "\"");
            assertThat(header).as("multipart field %s", name).isNotNegative();
            int start = body.indexOf("\r\n\r\n", header) + 4;
            return body.substring(start, body.indexOf("\r\n--", start));
        }

        @Override
        public void close() { server.stop(0); }
    }
}
