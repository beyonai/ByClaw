package com.iwhalecloud.byai.gateway.sandbox.service.ingress.vnc;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import java.util.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.*;
import org.springframework.web.server.ResponseStatusException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.*;
import com.sun.net.httpserver.HttpServer;

class SandboxVncProxyTest {
    SandboxService service = mock(SandboxService.class);
    SandboxIngressRuntimeResolver runtime = mock(SandboxIngressRuntimeResolver.class);
    SandboxIngressRuntimeSupport support = mock(SandboxIngressRuntimeSupport.class, CALLS_REAL_METHODS);
    SandboxVncTargetResolver resolver = new SandboxVncTargetResolver(service, runtime);
    @BeforeEach void setup() {
        LoginInfo user = new LoginInfo(); user.setUserCode("alice"); CurrentUserHolder.setLoginInfo(user);
        when(runtime.resolve()).thenReturn(support);
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }
    SandboxInfo sandbox(String endpoint) {
        return SandboxInfo.builder().sandboxId("owned-1").instanceEndpoints(Map.of("vnc", endpoint))
            .endpointHeaders(Map.of("e2b-traffic-access-token", "server-secret")).build();
    }
    @Test void cookieSessionRestoresIdentityThroughRealAuthenticationInterceptor() throws Exception {
        CurrentUserHolder.clearLoginInfo();
        var auth = new com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor();
        org.springframework.test.util.ReflectionTestUtils.setField(auth, "sessionFilter",
            new com.iwhalecloud.byai.state.infrastructure.filter.sub.SessionFilter());
        auth.init();
        var session = new MockHttpSession();
        session.setAttribute("USER_CODE", "alice");
        session.setAttribute("SHARE_CURRENT_USER", "{\"userCode\":\"alice\",\"userId\":1}");
        var request = new MockHttpServletRequest("GET", "/sandbox/vnc/owned-1/vnc/");
        request.setServletPath("/sandbox/vnc/owned-1/vnc/"); request.setSession(session);
        request.addHeader("Cookie", "SESSION=" + session.getId());
        assertThat(auth.preHandle(request, new MockHttpServletResponse(), new Object())).isTrue();
        assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("alice");
        when(service.sandboxInfo("alice")).thenReturn(List.of(sandbox("https://trusted.example/")));
        assertThat(resolver.resolve("/sandbox/vnc/owned-1/vnc/", null).url().host()).isEqualTo("trusted.example");
        auth.afterCompletion(request, new MockHttpServletResponse(), new Object(), null);
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
    }
    @Test void refusesAnonymousOtherSandboxAndUndeclaredInstance() {
        when(service.sandboxInfo("alice")).thenReturn(List.of(sandbox("http://127.0.0.1:1")));
        assertThatThrownBy(() -> resolver.resolve("/sandbox/vnc/other/vnc/", null)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> resolver.resolve("/sandbox/vnc/owned-1/desktop/", null)).isInstanceOf(ResponseStatusException.class);
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> resolver.resolve("/sandbox/vnc/owned-1/vnc/", null)).isInstanceOf(ResponseStatusException.class);
    }
    @Test void blocksPathEscapeAndCannotOverrideDeclaredEndpointCredentials() {
        when(service.sandboxInfo("alice")).thenReturn(List.of(sandbox("https://trusted.example/base?token=trusted")));
        for (String escape : List.of("../other", "%2e%2e/other", "%252e%252e/other", "%2foutside", "a%5cb")) {
            assertThatThrownBy(() -> resolver.resolve("/sandbox/vnc/owned-1/vnc/" + escape, null))
                .isInstanceOf(ResponseStatusException.class);
        }
        var target = resolver.resolve("/sandbox/vnc/owned-1/vnc/core/rfb.js", "token=attack&beyondToken=portal&x=ok");
        assertThat(target.url().toString()).isEqualTo("https://trusted.example/base/core/rfb.js?token=trusted");
        assertThat(target.headers()).containsEntry("e2b-traffic-access-token", "server-secret");
    }
    @Test void viewerLinkKeepsHtmlAssetsAndWebsocketOnSameOrigin() {
        var endpoints = SandboxVncTargetResolver.viewerEndpoints(sandbox("https://cloud.invalid/?token=private"));
        assertThat(endpoints.get("vnc")).isEqualTo("/byaiService/sandbox/vnc/owned-1/vnc/?path=byaiService/sandbox/vnc/owned-1/vnc/websockify");
        assertThat(endpoints.get("vnc")).doesNotContain("private", "cloud.invalid");
    }
    @Test void bundledViewerModuleImportsResolveInsideTrustedResources() throws Exception {
        var pending = new java.util.ArrayDeque<String>();
        var visited = new java.util.HashSet<String>(); pending.add("viewer.js");
        var imports = java.util.regex.Pattern.compile("(?m)^import\\s+(?:[^;]*?\\sfrom\\s*)?['\"]([^'\"]+)['\"]");
        while (!pending.isEmpty()) {
            String module = pending.remove(); if (!visited.add(module)) continue;
            var resource = new org.springframework.core.io.ClassPathResource("sandbox-vnc/" + module);
            assertThat(resource.exists()).as(module).isTrue();
            String source; try (var input = resource.getInputStream()) { source = new String(input.readAllBytes(), StandardCharsets.UTF_8); }
            var matcher = imports.matcher(source);
            while (matcher.find()) {
                String imported = matcher.group(1);
                assertThat(imported).startsWith(".");
                String resolved = java.nio.file.Path.of(module).getParent() == null ? imported
                    : java.nio.file.Path.of(module).getParent().resolve(imported).toString();
                resolved = java.nio.file.Path.of(resolved).normalize().toString();
                assertThat(resolved).doesNotStartWith(".."); pending.add(resolved);
            }
        }
        assertThat(visited).contains("core/rfb.js", "vendor/pako/lib/zlib/inflate.js");
    }
    @Test void servesTrustedViewerAndAssetsWithoutFetchingGuestHtmlOrExecutingGuestHeaders() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        java.util.concurrent.atomic.AtomicInteger fetched = new java.util.concurrent.atomic.AtomicInteger();
        server.createContext("/", exchange -> {
            fetched.incrementAndGet();
            exchange.getResponseHeaders().set("Clear-Site-Data", "\"cookies\"");
            byte[] body = "<script>fetch('/platform-private')</script>".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length); exchange.getResponseBody().write(body); exchange.close();
        }); server.start();
        try {
            when(service.sandboxInfo("alice")).thenReturn(List.of(sandbox("http://127.0.0.1:" + server.getAddress().getPort())));
            var controller = new SandboxVncProxyController(resolver);
            for (String path : List.of("", "viewer.js", "core/rfb.js", "vendor/pako/lib/zlib/inflate.js")) {
                MockHttpServletRequest request = new MockHttpServletRequest("GET", "/sandbox/vnc/owned-1/vnc/" + path);
                request.addHeader("Cookie", "SESSION=portal"); request.addHeader("Beyond-Token", "portal-token");
                MockHttpServletResponse response = new MockHttpServletResponse(); controller.forward(request,response);
                assertThat(response.getStatus()).isEqualTo(200);
                assertThat(response.getContentAsString()).isNotBlank().doesNotContain("platform-private");
                assertThat(response.getHeader("Content-Disposition")).isNull();
                assertThat(response.getHeader("Clear-Site-Data")).isNull();
                assertThat(response.getHeader("Content-Security-Policy")).contains("script-src 'self'");
            }
            for (String denied : List.of("websockify", "README.md", "copyright", "unknown.html")) {
                MockHttpServletResponse response = new MockHttpServletResponse();
                controller.forward(new MockHttpServletRequest("GET", "/sandbox/vnc/owned-1/vnc/" + denied),response);
                assertThat(response.getStatus()).isEqualTo(404);
            }
            assertThat(fetched.get()).isZero();
        } finally { server.stop(0); }
    }
}
