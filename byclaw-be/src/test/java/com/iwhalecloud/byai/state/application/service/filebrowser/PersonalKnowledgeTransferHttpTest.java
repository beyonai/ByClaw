package com.iwhalecloud.byai.state.application.service.filebrowser;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhaleai.byai.framework.core.discovery.DiscoveryClient;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import com.iwhaleai.byai.framework.util.http.DiscoveryHttpClient;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpoint;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServiceEndpointResolver;
import com.iwhalecloud.byai.common.feign.client.KnowledgeServicePathResolver;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileToMarkdownIndex;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbFileUpdate;
import com.iwhalecloud.byai.common.feign.request.pythonbuild.KbListDir;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import com.iwhalecloud.byai.state.common.util.MultipartFileUtil;
import com.iwhalecloud.byai.state.domain.filebrowser.dto.FileBrowserSaveToKnowledgeRequest;
import com.iwhalecloud.byai.state.domain.filebrowser.vo.FileBrowserItemVo;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

/** Exercises real transfer, dataset and HTTP clients; only persistence, permissions and source storage are mocked. */
class PersonalKnowledgeTransferHttpTest extends I18nTestSupport {
    private static final String SOURCE = "/by/.sessions/501/random_hello.txt";
    private static final String CONTENT = "hello".repeat(82);
    private final List<Call> calls = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private DiscoveryHttpClient discoveryHttp;
    private FeignPythonBuildService knowledge;
    private KnowledgeServiceEndpointResolver endpoints;
    private FileBrowserKnowledgeTransferApplicationService transfer;
    private boolean buildFails;

    record Call(String path, String contentType, String resourceId, String user, String session, String body) {}

    @BeforeEach
    void setup() throws Exception {
        LoginInfo login = new LoginInfo();
        login.setUserCode("alice");
        login.setUserId(7L);
        login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/v1/", exchange -> {
            var headers = exchange.getRequestHeaders();
            Call call = new Call(exchange.getRequestURI().getPath(), headers.getFirst("Content-Type"),
                headers.getFirst(FeignPythonBuildService.RESOURCE_ID_HEADER), headers.getFirst("X-USER-CODE"),
                headers.getFirst("X-CHAT-SESSION-ID"),
                new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            calls.add(call);
            boolean listing = call.path().endsWith("listDir");
            boolean hasContext = "20".equals(call.resourceId()) && (listing || "alice".equals(call.user()));
            String response;
            int status = hasContext ? 200 : 400;
            if (!hasContext) {
                response = "{\"resultCode\":\"-1\",\"resultMsg\":\"missing knowledge resource context\"}";
            } else if (listing) {
                response = "{\"resultCode\":\"0\",\"resultObject\":{\"data\":[]}}";
            } else if (call.path().endsWith("fileToMarkdownIndex")) {
                response = buildFails ? "{\"resultCode\":\"-1\",\"resultMsg\":\"build unavailable\"}"
                    : "{\"resultCode\":\"0\",\"resultObject\":null}";
            } else {
                response = "{\"resultCode\":\"0\",\"resultObject\":{\"data\":[{\"filePath\":\"/random_hello.txt\",\"success\":true}],\"summary\":{\"total\":1,\"succeeded\":1,\"failed\":0}}}";
            }
            byte[] bytes = response.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            exchange.getResponseBody().write(bytes);
            exchange.close();
        });
        server.start();
        var discovery = mock(DiscoveryClient.class);
        var instance = ServiceInstance.builder().id("local-test").protocol("http").host("127.0.0.1")
            .port(server.getAddress().getPort()).pathPrefix("").weight(1).lastHeartbeat(System.currentTimeMillis()).build();
        when(discovery.discover(eq("knowledge-test"), anyLong())).thenReturn(Optional.of(instance));
        discoveryHttp = DiscoveryHttpClient.builder().discoveryClient(discovery).build();
        endpoints = mock(KnowledgeServiceEndpointResolver.class);
        var paths = mock(KnowledgeServicePathResolver.class);
        when(paths.resolveByKnCodeAndOperation(anyString(), any())).thenAnswer(invocation ->
            ((com.iwhalecloud.byai.common.feign.client.KnowledgeServiceOperation) invocation.getArgument(1)).getLocalPath());
        knowledge = new FeignPythonBuildService();
        ReflectionTestUtils.setField(knowledge, "knowledgeServiceEndpointResolver", endpoints);
        ReflectionTestUtils.setField(knowledge, "knowledgeServicePathResolver", paths);
        ReflectionTestUtils.setField(knowledge, "discoveryHttpClient", discoveryHttp);
        var jwt = mock(JwtService.class);
        when(jwt.createJwt(any())).thenReturn("test-token");
        ReflectionTestUtils.setField(knowledge, "jwtService", jwt);

        var target = new SsResource();
        target.setResourceId(20L);
        target.setResourceCode("personal-test");
        target.setOwnerType("personal_default");
        target.setResourceBizType("KG_DOC");
        target.setResourceStatus(2);
        var resources = mock(SsResourceService.class);
        when(resources.findById(20L)).thenReturn(target);
        var auth = mock(AuthApplicationService.class);
        when(auth.hasResourceManagePermission(target)).thenReturn(true);
        var datasets = new DatasetApplicationService();
        ReflectionTestUtils.setField(datasets, "ssResourceService", resources);
        ReflectionTestUtils.setField(datasets, "authApplicationService", auth);
        ReflectionTestUtils.setField(datasets, "feignPythonBuildService", knowledge);
        var source = new FileBrowserItemVo();
        source.setPath(SOURCE);
        source.setName("random_hello.txt");
        var files = mock(FileBrowserApplicationService.class);
        when(files.listForTransfer("alice", 10L, "/by/.sessions/501/")).thenReturn(List.of(source));
        when(files.download("alice", 10L, SOURCE)).thenAnswer(invocation ->
            new java.io.ByteArrayInputStream(CONTENT.getBytes(StandardCharsets.UTF_8)));
        transfer = new FileBrowserKnowledgeTransferApplicationService(files, datasets, resources, auth);
    }

    @AfterEach
    void cleanup() throws Exception {
        server.stop(0);
        discoveryHttp.close();
        CurrentUserHolder.clearLoginInfo();
    }

    private void route(boolean direct) {
        when(endpoints.resolveByKnCode("personal-test")).thenReturn(direct
            ? KnowledgeServiceEndpoint.forDirectUrl("http://127.0.0.1:" + server.getAddress().getPort())
            : KnowledgeServiceEndpoint.forDiscovery("knowledge-test"));
    }

    private FileBrowserSaveToKnowledgeRequest request(boolean build) {
        var request = new FileBrowserSaveToKnowledgeRequest();
        request.setResourceId(10L);
        request.setSourcePath(SOURCE);
        request.setTargetResourceId(20L);
        request.setTargetDirectoryPath("/");
        request.setBuildAfterSave(build);
        return request;
    }

    @ParameterizedTest
    @CsvSource({"false,false", "false,true", "true,false", "true,true"})
    void savesThe410ByteSessionFileAndOnlyBuildsWhenRequested(boolean direct, boolean build) throws Exception {
        route(direct);
        var result = transfer.saveToPersonalKnowledge("alice", request(build));
        assertThat(result.getUploadedFileCount()).isEqualTo(1);
        assertThat(result.getBuildSubmittedCount()).isEqualTo(build ? 1 : 0);
        assertThat(result.getFailedItems()).isEmpty();
        assertThat(result.getBuildFailedItems()).isEmpty();
        assertThat(calls).hasSize(build ? 2 : 1);
        assertThat(calls.getFirst().path()).isEqualTo("/api/v1/knowledgeItems/import");
        assertThat(calls.getFirst().contentType()).contains("multipart/form-data", "boundary=");
        assertThat(calls.getFirst().body()).contains("random_hello.txt", "personal-test", CONTENT);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void buildFailureKeepsTheSuccessfullyImportedFile(boolean direct) throws Exception {
        route(direct);
        buildFails = true;
        var result = transfer.saveToPersonalKnowledge("alice", request(true));
        assertThat(result.getUploadedFileCount()).isEqualTo(1);
        assertThat(result.getFailedItems()).isEmpty();
        assertThat(result.getBuildFailedItems()).hasSize(1);
        assertThat(result.getBuildFailedItems().getFirst().getFilePath()).isEqualTo("/random_hello.txt");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void directoryListingPreservesTargetResource(boolean direct) {
        route(direct);
        var listing = new KbListDir();
        listing.setKnCode("personal-test");
        listing.setDirectoryPath("/");
        assertThat(knowledge.listDir(listing, 20L).getResultCode()).isEqualTo("0");
        assertThat(calls).hasSize(1);
        assertThat(calls.getFirst().path()).isEqualTo("/api/v1/listDir");
        assertThat(calls.getFirst().resourceId()).isEqualTo("20");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void buildPreservesImmutableCallerContext(boolean direct) {
        route(direct);
        var build = new KbFileToMarkdownIndex();
        build.setKnCode("personal-test");
        build.setFilePath("/random_hello.txt");
        knowledge.fileToMarkdownIndex(build, Map.of(FeignPythonBuildService.RESOURCE_ID_HEADER, "20",
            "X-USER-CODE", "alice", "X-CHAT-SESSION-ID", "chat-501"));
        assertThat(calls).hasSize(1);
        assertThat(calls.getFirst().session()).isEqualTo("chat-501");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void overwriteUploadPreservesIdentityAndSession(boolean direct) {
        route(direct);
        var update = new KbFileUpdate();
        update.setKnCode("personal-test");
        update.setFilePath("/random_hello.txt");
        update.setMultipartFile(new MultipartFileUtil("files", "random_hello.txt", null,
            CONTENT.getBytes(StandardCharsets.UTF_8)));
        knowledge.updateKnowledgeItem(update, Map.of(FeignPythonBuildService.RESOURCE_ID_HEADER, "20",
            "X-USER-CODE", "alice", "X-CHAT-SESSION-ID", "chat-501", "Content-Type", "application/json"));
        assertThat(calls).hasSize(1);
        assertThat(calls.getFirst().path()).isEqualTo("/api/v1/knowledgeItems/update");
        assertThat(calls.getFirst().session()).isEqualTo("chat-501");
        assertThat(calls.getFirst().contentType()).contains("boundary=");
    }
}
