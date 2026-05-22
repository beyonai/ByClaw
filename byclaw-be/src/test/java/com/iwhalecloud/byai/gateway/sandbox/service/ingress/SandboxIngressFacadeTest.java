package com.iwhalecloud.byai.gateway.sandbox.service.ingress;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
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
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
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
            assertThat(server.lastHeader("Beyond-Token")).isEqualTo("token-123");
            assertThat(server.lastHeader("OPEN-SANDBOX-API-KEY")).isEqualTo("sandbox-api-key");
            assertThat(server.lastHeader("X-Custom")).isEqualTo("value-1");
            assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        }
    }

    @Test
    void forward_filebrowserRequest_preservesTrailingSlashAfterPrefix() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");

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
        }
    }

    @Test
    void forward_filebrowserRootRequest_preservesRootTrailingSlash() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");

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
    void forward_unknownInstance_passthroughsOriginalProxyPath() throws Exception {
        try (TestHttpServer server = new TestHttpServer()) {
            SandboxIngressFacade facade = buildFacade(server.baseUrl(), "minio", "sandbox-api-key");

            LoginInfo originalLoginInfo = new LoginInfo();
            originalLoginInfo.setUserCode("original-user");
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
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        SandboxService sandboxService = mock(SandboxService.class);

        LoginInfo tokenLoginInfo = new LoginInfo();
        tokenLoginInfo.setUserCode("alice");
        LoginInfo dbLoginInfo = new LoginInfo();
        dbLoginInfo.setUserCode("alice");
        dbLoginInfo.setUserId(1001L);

        when(jwtService.verifyJwt(eq("token-123"), eq(LoginInfo.class))).thenReturn(tokenLoginInfo);
        when(jwtService.verifyJwt(eq("header-token"), eq(LoginInfo.class))).thenReturn(tokenLoginInfo);
        when(loginApplicationService.getLoginInfo("alice")).thenReturn(dbLoginInfo);
        when(sandboxService.sandboxInfo("alice")).thenReturn(List.of(
            SandboxInfo.builder()
                .userCode("alice")
                .sandboxId("sb-1")
                .instanceEndpoints(java.util.Map.of(
                    "filebrowser", "/v1/sandboxes/sb-1/proxy/8081",
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
        SandboxIngressUserResolver userResolver = new SandboxIngressUserResolver(jwtService, loginApplicationService);
        SandboxIngressRequestContextResolver requestContextResolver =
            new SandboxIngressRequestContextResolver(endpointResolver, userResolver, runtimeResolver);
        SandboxIngressInstanceHandlerRegistry handlerRegistry =
            new SandboxIngressInstanceHandlerRegistry(List.of(
                new FilebrowserSandboxIngressInstanceHandler(),
                new PassThroughSandboxIngressInstanceHandler()));
        SandboxIngressTransportService transportService = new SandboxIngressTransportService(runtimeResolver);
        return new SandboxIngressFacade(requestContextResolver, handlerRegistry, runtimeResolver, transportService);
    }

    private static final class TestHttpServer implements AutoCloseable {

        private final HttpServer server;
        private final AtomicReference<String> path = new AtomicReference<>();
        private final AtomicReference<com.sun.net.httpserver.Headers> headers = new AtomicReference<>();

        private TestHttpServer() throws IOException {
            server = HttpServer.create(new InetSocketAddress(0), 0);
            server.createContext("/", new CaptureHandler(path, headers));
            server.start();
        }

        private String baseUrl() {
            return "http://127.0.0.1:" + server.getAddress().getPort();
        }

        private String lastPath() {
            return path.get();
        }

        private String lastHeader(String name) {
            com.sun.net.httpserver.Headers lastHeaders = headers.get();
            return lastHeaders != null ? lastHeaders.getFirst(name) : null;
        }

        @Override
        public void close() {
            server.stop(0);
        }
    }

    private static final class CaptureHandler implements HttpHandler {

        private final AtomicReference<String> path;
        private final AtomicReference<com.sun.net.httpserver.Headers> headers;

        private CaptureHandler(AtomicReference<String> path,
                               AtomicReference<com.sun.net.httpserver.Headers> headers) {
            this.path = path;
            this.headers = headers;
        }

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            path.set(exchange.getRequestURI().toString());
            headers.set(exchange.getRequestHeaders());
            byte[] body = "ok".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "text/plain;charset=UTF-8");
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream outputStream = exchange.getResponseBody()) {
                outputStream.write(body);
            }
        }
    }
}
