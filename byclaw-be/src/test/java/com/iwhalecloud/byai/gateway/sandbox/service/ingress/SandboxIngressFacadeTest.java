package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpServer;

class SandboxIngressFacadeTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void forward_filebrowserRequest_injectsBeyondTokenAndPrefixesFilebrowserPath() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/sandboxes/ingress/filebrowser/sb-1/proxy/8081/files/list");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.setQueryString("beyondToken=token-123&foo=bar");
            request.addParameter("beyondToken", "token-123");
            request.addParameter("foo", "bar");
            request.addHeader("X-Custom", "value-1");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/files/list", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(response.getContentAsString()).isEqualTo("ok");
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/8081/filebrowser/files/list?beyondToken=token-123&foo=bar");
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("generated-token");
            assertThat(server.lastHeader("OPEN-SANDBOX-API-KEY")).isEqualTo("sandbox-api-key");
            assertThat(server.lastHeader("X-Custom")).isEqualTo("value-1");
            assertThat(CurrentUserHolder.getLoginInfo().getUserCode()).isEqualTo("alice");
        }
    }

    @Test
    void forward_filebrowserRequest_preservesTrailingSlashAfterPrefix() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/filebrowser/api/usage/");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.addHeader("Beyond-Token", "header-token");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/api/usage/", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/8081/filebrowser/api/usage/");
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("header-token");
        }
    }

    @Test
    void forward_filebrowserRequest_injectsXAuthFromAuthCookie() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/filebrowser/api/raw/workspace/AGENTS.md");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.addHeader("Cookie", "SESSION=session-1; auth=filebrowser-jwt-token; uc=alice");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/api/raw/workspace/AGENTS.md", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/8081/filebrowser/api/raw/workspace/AGENTS.md");
            assertThat(server.lastHeader("X-Auth")).isEqualTo("filebrowser-jwt-token");
        }
    }

    @Test
    void forward_filebrowserDeleteWithoutBody_forwardsWithoutRequestBody() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("DELETE",
                "/filebrowser/api/resources/.openclaw/openclaw.json.clobbered");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/api/resources/.openclaw/openclaw.json.clobbered", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastMethod()).isEqualTo("DELETE");
            assertThat(server.lastPath()).isEqualTo(
                "/v1/sandboxes/sb-1/proxy/8081/filebrowser/api/resources/.openclaw/openclaw.json.clobbered");
            assertThat(server.lastBody()).isEmpty();
            assertThat(server.lastHeader("Transfer-Encoding")).isNull();
        }
    }

    @Test
    void forward_filebrowserOptionsWithoutBody_forwardsWithoutRequestBody() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS",
                "/filebrowser/api/resources/");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/api/resources/", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastMethod()).isEqualTo("OPTIONS");
            assertThat(server.lastBody()).isEmpty();
            assertThat(server.lastHeader("Transfer-Encoding")).isNull();
        }
    }

    @Test
    void forward_filebrowserPostWithoutBody_forwardsEmptyRequestBody() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("POST",
                "/filebrowser/api/resources/");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/api/resources/", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastMethod()).isEqualTo("POST");
            assertThat(server.lastBody()).isEmpty();
            assertThat(server.lastHeader("Transfer-Encoding")).isNull();
        }
    }

    @Test
    void forward_filebrowserDeleteWithBody_preservesRequestBody() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("DELETE",
                "/filebrowser/api/resources/.openclaw/openclaw.json.clobbered");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.setContentType("application/json");
            request.setContent("{\"force\":true}".getBytes(StandardCharsets.UTF_8));

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/api/resources/.openclaw/openclaw.json.clobbered", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastMethod()).isEqualTo("DELETE");
            assertThat(new String(server.lastBody(), StandardCharsets.UTF_8)).isEqualTo("{\"force\":true}");
        }
    }

    @Test
    void forward_filebrowserUploadWithShorterInputStream_usesStreamingBody() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            byte[] body = "file-content".getBytes(StandardCharsets.UTF_8);
            MockHttpServletRequest request = new MockHttpServletRequest("POST",
                "/filebrowser/openclaw-api/upload") {
                @Override
                public long getContentLengthLong() {
                    return body.length + 1024L;
                }
            };
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.setContentType("application/octet-stream");
            request.setContent(body);

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/openclaw-api/upload", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastMethod()).isEqualTo("POST");
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/8081/filebrowser/openclaw-api/upload");
            assertThat(new String(server.lastBody(), StandardCharsets.UTF_8)).isEqualTo("file-content");
            assertThat(server.lastHeader("Transfer-Encoding")).isEqualTo("chunked");
        }
    }

    @Test
    void forward_filebrowserRootRequest_preservesRootTrailingSlash() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/filebrowser/");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.addHeader("Beyond-Token", "header-token");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("filebrowser", "/", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/8081/filebrowser/");
        }
    }

    @Test
    void forward_novncRequest_passthroughsPath() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/novnc/vnc.html");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.setQueryString("autoconnect=true");
            request.addParameter("autoconnect", "true");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("novnc", "/vnc.html", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/6080/vnc.html?autoconnect=true");
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("generated-token");
        }
    }

    @Test
    void forward_openDesignRequest_prefixesOpenDesignPath() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/openDesign/projects/1001");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("openDesign", "/projects/1001", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-1/proxy/18090/openDesign/projects/1001");
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("generated-token");
        }
    }

    @Test
    void forwardOpenSandboxPath_preservesFullSandboxProxyPath() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");
            bindCurrentUser("alice");

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/v1/sandboxes/sb-1/proxy/6080/vnc.html");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.setQueryString("beyondToken=query-token&foo=bar");
            request.addParameter("beyondToken", "query-token");
            request.addParameter("foo", "bar");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forwardOpenSandboxPath("/v1/sandboxes/sb-1/proxy/6080/vnc.html", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath())
                .isEqualTo("/v1/sandboxes/sb-1/proxy/6080/vnc.html?beyondToken=query-token&foo=bar");
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("generated-token");
            assertThat(server.lastHeader("OPEN-SANDBOX-API-KEY")).isEqualTo("sandbox-api-key");
        }
    }

    @Test
    void forward_unknownInstance_passthroughsOriginalProxyPath() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");

            LoginInfo originalLoginInfo = new LoginInfo();
            originalLoginInfo.setUserCode("alice");
            CurrentUserHolder.setLoginInfo(originalLoginInfo);

            MockHttpServletRequest request = new MockHttpServletRequest("GET",
                "/sandboxes/ingress/debug/sb-2/proxy/9222/devtools/index.html");
            request.setScheme("http");
            request.setServerName("gateway.example.test");
            request.setRemoteAddr("127.0.0.1");
            request.setQueryString("foo=bar");
            request.addParameter("foo", "bar");
            request.addHeader("Beyond-Token", "header-token");

            MockHttpServletResponse response = new MockHttpServletResponse();
            facade.forward("debug", "/devtools/index.html", request, response);

            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(server.lastPath()).isEqualTo("/v1/sandboxes/sb-2/proxy/9222/devtools/index.html?foo=bar");
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("header-token");
            assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(originalLoginInfo);
        }
    }

    private SandboxIngressFacade buildFacade(String baseUrl, String storageType, String apiKey) {
        JwtService jwtService = mock(JwtService.class);
        when(jwtService.createJwt(any())).thenReturn("generated-token");
        SandboxService sandboxService = mock(SandboxService.class);
        when(sandboxService.sandboxInfo("alice")).thenReturn(List.of(
            SandboxInfo.builder()
                .userCode("alice")
                .sandboxId("sb-1")
                .instanceEndpoints(java.util.Map.of(
                    "filebrowser", "/v1/sandboxes/sb-1/proxy/8081",
                    "novnc", "/v1/sandboxes/sb-1/proxy/6080",
                    "openDesign", "/v1/sandboxes/sb-1/proxy/18090",
                    "debug", "/v1/sandboxes/sb-2/proxy/9222"))
                .build()));

        SandboxProperties sandboxProperties = new SandboxProperties();
        sandboxProperties.getOpensandbox().setBaseUrl(baseUrl);
        sandboxProperties.getOpensandbox().setApiKey(apiKey);

        SandboxIngressRuntimeSupport openSandboxSupport = new OpenSandboxIngressRuntimeSupport(sandboxProperties);
        SandboxIngressRuntimeSupport whaleAgentSupport = new WhaleAgentIngressRuntimeSupport("", sandboxProperties);
        SandboxIngressRuntimeResolver runtimeResolver =
            new SandboxIngressRuntimeResolver(List.of(openSandboxSupport, whaleAgentSupport), storageType);
        SandboxIngressEndpointResolver endpointResolver = new SandboxIngressEndpointResolver(sandboxService);
        SandboxIngressRequestContextResolver requestContextResolver =
            new SandboxIngressRequestContextResolver(endpointResolver, runtimeResolver, jwtService);
        SandboxIngressInstanceHandlerRegistry handlerRegistry =
            new SandboxIngressInstanceHandlerRegistry(List.of(
                new FilebrowserSandboxIngressInstanceHandler(),
                new OpenDesignSandboxIngressInstanceHandler(),
                new PassThroughNamedSandboxIngressInstanceHandler(),
                new PassThroughSandboxIngressInstanceHandler()));
        SandboxIngressTransportService transportService = new SandboxIngressTransportService(runtimeResolver);
        return new SandboxIngressFacade(requestContextResolver, handlerRegistry, runtimeResolver, transportService);
    }

    private void bindCurrentUser(String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode);
        loginInfo.setUserId(1001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    private static final class TestHttpServer implements AutoCloseable {

        private final HttpServer server;
        private final AtomicReference<String> method = new AtomicReference<>();
        private final AtomicReference<String> path = new AtomicReference<>();
        private final AtomicReference<com.sun.net.httpserver.Headers> headers = new AtomicReference<>();
        private final AtomicReference<byte[]> body = new AtomicReference<>();

        private TestHttpServer() throws IOException {
            server = HttpServer.create(new InetSocketAddress(0), 0);
            server.createContext("/", new CaptureHandler(method, path, headers, body));
            server.start();
        }

        private String baseUrl() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        private String lastMethod() {
            return method.get();
        }

        private String lastPath() {
            return path.get();
        }

        private String lastHeader(String name) {
            com.sun.net.httpserver.Headers lastHeaders = headers.get();
            return lastHeaders != null ? lastHeaders.getFirst(name) : null;
        }

        private byte[] lastBody() {
            byte[] lastBody = body.get();
            return lastBody != null ? lastBody : new byte[0];
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    private static final class CaptureHandler implements HttpHandler {

        private final AtomicReference<String> method;
        private final AtomicReference<String> path;
        private final AtomicReference<com.sun.net.httpserver.Headers> headers;
        private final AtomicReference<byte[]> requestBody;

        private CaptureHandler(AtomicReference<String> method,
                               AtomicReference<String> path,
                               AtomicReference<com.sun.net.httpserver.Headers> headers,
                               AtomicReference<byte[]> requestBody) {
            this.method = method;
            this.path = path;
            this.headers = headers;
            this.requestBody = requestBody;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            method.set(exchange.getRequestMethod());
            path.set(exchange.getRequestURI().toString());
            headers.set(exchange.getRequestHeaders());
            requestBody.set(exchange.getRequestBody().readAllBytes());
            byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/plain;charset=UTF-8");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(body);
            }
        }
    }
}
