package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw.OpenClawUiHttpProxyService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.server.ResponseStatusException;

class SandboxDesktopTrustedViewerTest {
    static final String MALICIOUS = "<script>parent.document.body.innerHTML='sandbox-owned'</script>";
    SandboxService sandboxes;
    SsSandboxRecordMapper records;
    SandboxDesktopProxyController controller;
    SandboxInfo info;
    HttpServer cloud;
    AtomicInteger upstreamCalls = new AtomicInteger();
    AtomicReference<String> body = new AtomicReference<>(MALICIOUS);
    AtomicReference<String> contentType = new AtomicReference<>("text/html");
    AtomicInteger status = new AtomicInteger(200);
    AtomicReference<com.sun.net.httpserver.Headers> received = new AtomicReference<>();

    @BeforeEach
    void setup() throws Exception {
        sandboxes = mock(SandboxService.class); records = mock(SsSandboxRecordMapper.class);
        LoginInfo login = new LoginInfo(); login.setUserCode("alice"); login.setUserId(1L); login.setEnterpriseId(10L);
        CurrentUserHolder.setLoginInfo(login);
        cloud = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        cloud.createContext("/", exchange -> {
            upstreamCalls.incrementAndGet(); received.set(exchange.getRequestHeaders());
            exchange.getRequestBody().readAllBytes();
            exchange.getResponseHeaders().set("Content-Type", contentType.get());
            exchange.getResponseHeaders().set("Set-Cookie", "SESSION=sandbox-owned");
            exchange.getResponseHeaders().set("Content-Disposition", "attachment");
            exchange.getResponseHeaders().set("Content-Security-Policy", "script-src * 'unsafe-inline'");
            if (status.get() == 302) exchange.getResponseHeaders().set("Location", "?token=server-secret");
            byte[] bytes = body.get().getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status.get(), bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        }); cloud.start();
        info = SandboxInfo.builder().userCode("alice").sandboxId("sb-1").sandboxType("browser")
            .instanceEndpoints(Map.of("vnc", "http://127.0.0.1:" + cloud.getAddress().getPort() + "/?token=gateway"))
            .endpointHeaders(Map.of("e2b-traffic-access-token", "cloud-fixture")).build();
        when(sandboxes.sandboxInfo("alice", "sb-1")).thenAnswer(call -> List.of(info));
        SsSandboxRecord record = new SsSandboxRecord(); record.setStatus("RUNNING");
        when(records.selectLatestBySandboxId("alice", "browser", "sb-1")).thenReturn(record);
        controller = new SandboxDesktopProxyController(new SandboxDesktopAccess(sandboxes, records, ""), new OpenClawUiHttpProxyService());
    }

    @AfterEach
    void cleanup() { cloud.stop(0); CurrentUserHolder.clearLoginInfo(); }

    MockHttpServletRequest request(String suffix) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/sandbox/desktop/exclusive/sb-1/vnc/" + suffix);
        request.setContextPath("/api"); request.setScheme("http"); request.setServerName("portal.test"); request.setServerPort(18080);
        MockHttpSession session = new MockHttpSession(); session.setAttribute("USER_CODE", "alice"); session.setAttribute("enterpriseId", 10L);
        request.setSession(session); return request;
    }

    @ParameterizedTest
    @CsvSource({"desktop.example.com, example.com", "vnc.example.com.cn, example.com.cn",
        "vnc.example.co.uk, example.co.uk", "alice.github.io, alice.github.io"})
    void viewerLimitsEmbeddingToItsRegistrableDomainAndSubdomains(String hostname, String domain) {
        var request = request("index.html"); request.setServerName(hostname);
        var response = new MockHttpServletResponse(); controller.proxy(request, response);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Content-Security-Policy"))
            .contains("frame-ancestors 'self' http://" + domain + ":* https://" + domain + ":*")
            .contains("http://" + hostname + ":*", "https://" + hostname + ":*")
            .doesNotContain("*.")
            .contains("base-uri 'none'; object-src 'none'");
        assertThat(response.getHeader("X-Frame-Options")).isEqualTo("SAMEORIGIN");
    }

    @ParameterizedTest
    @ValueSource(strings = {"127.0.0.1", "[::1]", "localhost", "co.uk", "github.io"})
    void hostsWithoutRegistrableDomainsRetainSameOriginEmbedding(String hostname) {
        var request = request("index.html"); request.setServerName(hostname);
        var response = new MockHttpServletResponse(); controller.proxy(request, response);
        assertThat(response.getHeader("Content-Security-Policy"))
            .isEqualTo("frame-ancestors 'self'; base-uri 'none'; object-src 'none'");
    }

    @Test
    void viewerDoesNotLearnFrameParentsFromOriginOrForwardedHeaders() {
        var request = request("index.html"); request.setServerName("desktop.example.com");
        request.addHeader("Origin", "https://attacker.invalid");
        request.addHeader("Forwarded", "host=attacker.invalid");
        request.addHeader("X-Forwarded-Host", "attacker.invalid");
        request.addHeader("Referer", "https://attacker.invalid/parent");
        var response = new MockHttpServletResponse(); controller.proxy(request, response);
        assertThat(response.getHeader("Content-Security-Policy"))
            .contains("http://example.com:*").doesNotContain("attacker.invalid");
    }

    @ParameterizedTest
    @CsvSource({"desktop.example.com, https://chat.example.com:8443/page, https://chat.example.com:8443",
        "example.com, http://desktop.example.com:8080/page, http://desktop.example.com:8080",
        "vnc.example.com.cn, https://chat.example.com.cn/page, https://chat.example.com.cn:443",
        "vnc.alice.github.io, https://chat.alice.github.io/page, https://chat.alice.github.io:443"})
    void viewerAllowsTheVerifiedParentOriginFromReferer(String hostname, String referer, String parent) {
        var request = request("index.html"); request.setServerName(hostname); request.addHeader("Referer", referer);
        var response = new MockHttpServletResponse(); controller.proxy(request, response);
        assertThat(response.getHeader("Content-Security-Policy")).contains(parent).doesNotContain("*.");
    }

    @Test
    void viewerDoesNotCrossDeeperPrivatePublicSuffixDelegations() {
        var request = request("index.html"); request.setServerName("console.amazonaws.com");
        request.addHeader("Referer", "https://bucket.s3.amazonaws.com/parent");
        var response = new MockHttpServletResponse(); controller.proxy(request, response);
        assertThat(response.getHeader("Content-Security-Policy"))
            .contains("https://amazonaws.com:*").doesNotContain("bucket.s3.amazonaws.com", "*.amazonaws.com");
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-a-url", "https://chat_name.example.com/page", "https://user@chat.example.com/page",
        "https://chat.example.com:65536/page"})
    void malformedRefererCannotFailViewerRenderingOrAddAFrameParent(String referer) {
        var request = request("index.html"); request.setServerName("desktop.example.com"); request.addHeader("Referer", referer);
        var response = new MockHttpServletResponse();
        assertThatCode(() -> controller.proxy(request, response)).doesNotThrowAnyException();
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getHeader("Content-Security-Policy"))
            .doesNotContain("chat_name.example.com", "https://chat.example.com:443", "65536", "user@");
    }

    @Test
    void sameDomainConfiguredOriginsSupportHiddenRefererWithoutAddingForeignDomains() {
        var configured = new SandboxDesktopProxyController(new SandboxDesktopAccess(sandboxes, records,
            "https://chat.example.com:8443,https://foreign.invalid"), new OpenClawUiHttpProxyService());
        var request = request("index.html"); request.setServerName("desktop.example.com");
        var response = new MockHttpServletResponse(); configured.proxy(request, response);
        assertThat(response.getHeader("Content-Security-Policy"))
            .contains("https://chat.example.com:8443").doesNotContain("foreign.invalid");
    }

    @Test
    void sandboxHtmlAndJavascriptCannotBecomeSameOriginExecutableContent() throws Exception {
        List<String> suffixes = new java.util.ArrayList<>(List.of("", "index.html", "connection-bridge.js"));
        try (var input = new org.springframework.core.io.ClassPathResource("desktop-viewer/v1/manifest.json").getInputStream()) {
            new ObjectMapper().readTree(input).path("publicAssets").forEach(path -> suffixes.add(path.asText()));
        }
        for (String suffix : suffixes) {
            MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(request(suffix), response);
            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(response.getContentType()).startsWith(suffix.isEmpty() || "index.html".equals(suffix) ? "text/html" : "text/javascript");
            assertThat(response.getContentAsString()).doesNotContain("sandbox-owned");
            assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
            assertThat(response.getHeader("Set-Cookie")).isNull();
            assertThat(response.getHeader("Content-Disposition")).isEqualTo("inline");
            String asset = switch (suffix) {
                case "connection-bridge.js" -> "connection-bridge.mjs";
                case "", "index.html" -> "novnc-index.html";
                default -> suffix;
            };
            try (var input = new org.springframework.core.io.ClassPathResource("desktop-viewer/v1/" + asset).getInputStream()) {
                assertThat(response.getContentAsByteArray()).isEqualTo(input.readAllBytes());
            }
            String canonical = switch (asset) {
                case "novnc-index.html" -> "middleware/byclaw-harness/browser/novnc-index.html";
                case "connection-bridge.mjs" -> "middleware/builtin/runtime-tools/browser-viewer/connection-bridge.mjs";
                default -> "middleware/byclaw-harness/browser/desktop-viewer/v1/" + asset;
            };
            if (canonical != null) {
                var basedir = java.nio.file.Path.of(System.getProperty("basedir", System.getProperty("user.dir")));
                assertThat(response.getContentAsByteArray()).isEqualTo(java.nio.file.Files.readAllBytes(basedir.resolve("../" + canonical)));
            }
        }
        assertThat(upstreamCalls.get()).isZero();
        verify(sandboxes, times(suffixes.size())).sandboxInfo("alice", "sb-1");
    }

    @Test
    void headAndDirectoryNormalizationKeepResourcesInsideTheExactTuple() throws Exception {
        MockHttpServletRequest head = request("core/rfb.js"); head.setMethod("HEAD");
        MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(head, response);
        assertThat(response.getStatus()).isEqualTo(200);
        assertThat(response.getContentAsByteArray()).isEmpty();
        assertThat(response.getContentLength()).isGreaterThan(100);
        MockHttpServletRequest directory = request("");
        directory.setRequestURI(directory.getRequestURI().replaceAll("/$", ""));
        directory.setQueryString("sessionId=shared&token=browser-secret&autoconnect=true&path=outside");
        MockHttpServletResponse redirect = new MockHttpServletResponse(); controller.proxy(directory, redirect);
        assertThat(redirect.getStatus()).isEqualTo(307);
        assertThat(redirect.getHeader("Location")).startsWith("/api/sandbox/desktop/exclusive/sb-1/vnc/?")
            .contains("sessionId=shared", "autoconnect=true").doesNotContain("token", "secret", "path");
        assertThat(upstreamCalls.get()).isZero();
    }

    @Test
    void legacyRfbAliasRedirectsInsideTheTupleSoModuleImportsUseTheCanonicalBase() throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        String prefix = "/api/sandbox/desktop/exclusive/sb-1/vnc/";
        var session = (MockHttpSession) request("").getSession();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(prefix + "rfb.js")
            .contextPath("/api").session(session).queryParam("token", "browser-secret").queryParam("sessionId", "owned"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isTemporaryRedirect())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().string("Location", prefix + "core/rfb.js?sessionId=owned"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(prefix + "core/rfb.js")
            .contextPath("/api").session(session))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().contentTypeCompatibleWith("text/javascript"));
        MockHttpServletRequest shared = request("rfb.js"); shared.setMethod("HEAD");
        info.setIsShared(true); info.setMappingId("mapping-1");
        shared.setRequestURI("/api/sandbox/desktop/shared/mapping-1/sb-1/vnc/rfb.js");
        MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(shared, response);
        assertThat(response.getStatus()).isEqualTo(307);
        assertThat(response.getHeader("Location")).isEqualTo("/api/sandbox/desktop/shared/mapping-1/sb-1/vnc/core/rfb.js");
        assertThat(response.getContentAsByteArray()).isEmpty();
        assertThat(upstreamCalls.get()).isZero();
    }

    @Test
    void htmlAliasesRedirectToTheCanonicalEntryWithoutChangingTheAuthorizedTuple() throws Exception {
        String safe = "sessionId=shared&autoconnect=true&resize=scale&hideHeader=1&view_only=true&reconnect=true&reconnect_delay=1500";
        for (String alias : List.of("vnc.html", "VIEWER.HTML", "INDEX.HTML", "%E7%BC%96%E8%BE%91%E5%99%A8%20A.html")) {
            MockHttpServletRequest request = request(alias);
            request.setQueryString("token=browser-secret&path=outside&authorization=browser-secret&" + safe);
            MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(request, response);
            assertThat(response.getStatus()).as(alias).isEqualTo(307);
            assertThat(response.getHeader("Location")).isEqualTo("/api/sandbox/desktop/exclusive/sb-1/vnc/index.html?" + safe);
            assertThat(response.getContentAsByteArray()).isEmpty();
        }
        info.setIsShared(true); info.setMappingId("mapping-1");
        MockHttpServletRequest shared = request("vnc.html"); shared.setMethod("HEAD");
        shared.setRequestURI("/api/sandbox/desktop/shared/mapping-1/sb-1/vnc/vnc.html");
        MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(shared, response);
        assertThat(response.getStatus()).isEqualTo(307);
        assertThat(response.getHeader("Location")).isEqualTo("/api/sandbox/desktop/shared/mapping-1/sb-1/vnc/index.html");
        MockHttpServletRequest unauthenticated = request("vnc.html"); unauthenticated.setSession(null);
        MockHttpServletResponse denied = new MockHttpServletResponse();
        assertThatThrownBy(() -> controller.proxy(unauthenticated, denied)).isInstanceOf(ResponseStatusException.class);
        assertThat(denied.getHeader("Location")).isNull();
        assertThat(upstreamCalls.get()).isZero();
    }

    @Test
    void unknownResourcesAndTraversalNeverReachTheSandbox() {
        for (String suffix : List.of("evil.js", "core/evil.js", "core/%72fb.js", "core/rfb.js/extra", "connection-bridge.mjs",
            "manifest.json", "licenses/LICENSE.txt", "LICENSE.txt", "AUTHORS", "arbitrary.json", "fixture.bin", "nested/index.html", "../rfb.js", "%2e%2e/rfb.js", "%72fb.js", "rfb.js/extra")) {
            assertThatThrownBy(() -> controller.proxy(request(suffix), new MockHttpServletResponse()))
                .as(suffix).isInstanceOf(ResponseStatusException.class);
        }
        assertThat(upstreamCalls.get()).isZero();
    }

    @Test
    void authorizationIsRequiredEvenForTrustedStaticAssets() {
        MockHttpServletRequest request = request("rfb.js"); request.setSession(null);
        assertThatThrownBy(() -> controller.proxy(request, new MockHttpServletResponse())).isInstanceOf(ResponseStatusException.class);
        when(sandboxes.sandboxInfo("alice", "sb-1")).thenReturn(List.of());
        assertThatThrownBy(() -> controller.proxy(request("rfb.js"), new MockHttpServletResponse())).isInstanceOf(ResponseStatusException.class);
        assertThat(upstreamCalls.get()).isZero();
    }

    @Test
    void manifestListedModulesAreCachedAndUnlistedClasspathFilesStayPrivate() throws Exception {
        var resources = fixtureResources();
        var manifest = fixtureManifest(resources);
        var viewer = controllerFromManifest(manifest, resources);
        for (String path : List.of("core/rfb.js", "vendor/fixture.js")) {
            var response = new MockHttpServletResponse();
            assertThatCode(() -> viewer.proxy(request(path), response)).doesNotThrowAnyException();
            assertThat(response.getContentAsByteArray()).isEqualTo(resources.get(path));
        }
        for (String path : List.of("core/not-public.js", "licenses/LICENSE.txt", "manifest.json")) {
            assertThatThrownBy(() -> viewer.proxy(request(path), new MockHttpServletResponse()))
                .as(path).isInstanceOf(ResponseStatusException.class);
        }
        var missingSession = request("vendor/fixture.js"); missingSession.setSession(null);
        assertThatThrownBy(() -> viewer.proxy(missingSession, new MockHttpServletResponse()))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                failure -> assertThat(failure.getStatusCode().value()).isEqualTo(401));
        assertThat(upstreamCalls.get()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"../rfb.js", "/core/rfb.js", "core/../rfb.js", "core/./rfb.js", "core//rfb.js", "core/%72fb.js",
        "core/rfb.js?x=1", "core/rfb.js#x", "core\\rfb.js", "licenses/LICENSE.js", "manifest.json", "connection-bridge.js", "core/rfb.js "})
    void manifestRejectsNonModuleAndTraversalPathsBeforeControllerStartup(String path) throws Exception {
        var resources = fixtureResources();
        byte[] code = "export const invalidPath = true;".getBytes(StandardCharsets.UTF_8);
        resources.put(path, code);
        var manifest = fixtureManifest(resources);
        manifest.withArray("publicAssets").add(path);
        assertThatThrownBy(() -> controllerFromManifest(manifest, resources)).isInstanceOf(IllegalStateException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"digest", "length", "missing-module", "missing-manifest", "schema", "version", "entry",
        "missing-entry", "empty-list", "duplicate", "missing-files", "oversized-list"})
    void brokenManifestOrModuleIntegrityPreventsControllerStartup(String defect) throws Exception {
        var resources = fixtureResources();
        var manifest = fixtureManifest(resources);
        switch (defect) {
            case "digest" -> ((ObjectNode) manifest.path("files").path("core/rfb.js")).put("sha256", "0".repeat(64));
            case "length" -> ((ObjectNode) manifest.path("files").path("core/rfb.js")).put("bytes", 1);
            case "missing-module" -> resources.remove("core/rfb.js");
            case "schema" -> manifest.put("schemaVersion", 1);
            case "version" -> manifest.put("artifactVersion", "v2");
            case "entry" -> manifest.put("entry", "vendor/fixture.js");
            case "missing-entry" -> manifest.putArray("publicAssets").add("vendor/fixture.js");
            case "empty-list" -> manifest.putArray("publicAssets");
            case "duplicate" -> manifest.withArray("publicAssets").add("core/rfb.js");
            case "missing-files" -> manifest.remove("files");
            case "oversized-list" -> {
                for (int index = 0; index < 511; index++) {
                    String path = "vendor/module-" + index + ".js";
                    byte[] bytes = ("export const index = " + index + ";").getBytes(StandardCharsets.UTF_8);
                    resources.put(path, bytes);
                    manifest.withArray("publicAssets").add(path);
                    ((ObjectNode) manifest.path("files")).set(path, fixtureFileMetadata(bytes));
                }
            }
            case "missing-manifest" -> { }
            default -> throw new AssertionError(defect);
        }
        ObjectNode value = "missing-manifest".equals(defect) ? null : manifest;
        assertThatThrownBy(() -> controllerFromManifest(value, resources)).isInstanceOf(IllegalStateException.class);
    }

    private Map<String, byte[]> fixtureResources() {
        Map<String, byte[]> resources = new LinkedHashMap<>();
        resources.put("novnc-index.html", "<!doctype html><div>trusted viewer</div>".getBytes(StandardCharsets.UTF_8));
        resources.put("connection-bridge.mjs", "export const bridge = true;".getBytes(StandardCharsets.UTF_8));
        resources.put("core/rfb.js", "import '../vendor/fixture.js'; export default class RFB {}".getBytes(StandardCharsets.UTF_8));
        resources.put("vendor/fixture.js", "export const trusted = true;".getBytes(StandardCharsets.UTF_8));
        resources.put("core/not-public.js", "export const hidden = true;".getBytes(StandardCharsets.UTF_8));
        resources.put("licenses/LICENSE.txt", "fixture license".getBytes(StandardCharsets.UTF_8));
        resources.put("rfb.js", "export const legacy = true;".getBytes(StandardCharsets.UTF_8));
        return resources;
    }

    private ObjectNode fixtureManifest(Map<String, byte[]> resources) throws Exception {
        ObjectNode manifest = new ObjectMapper().createObjectNode();
        manifest.put("schemaVersion", 2).put("artifactVersion", "v1").put("entry", "core/rfb.js");
        manifest.putArray("publicAssets").add("core/rfb.js").add("vendor/fixture.js");
        ObjectNode files = manifest.putObject("files");
        for (var resource : resources.entrySet()) files.set(resource.getKey(), fixtureFileMetadata(resource.getValue()));
        return manifest;
    }

    private JsonNode fixtureFileMetadata(byte[] bytes) throws Exception {
        return new ObjectMapper().createObjectNode().put("bytes", bytes.length).put("sha256",
            java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(bytes)));
    }

    private SandboxDesktopProxyController controllerFromManifest(ObjectNode manifest, Map<String, byte[]> values) throws Exception {
        Map<String, byte[]> resources = new LinkedHashMap<>(values);
        if (manifest != null) resources.put("manifest.json", new ObjectMapper().writeValueAsBytes(manifest));
        ClassLoader original = Thread.currentThread().getContextClassLoader();
        Thread.currentThread().setContextClassLoader(new ClassLoader(original) {
            @Override
            public java.io.InputStream getResourceAsStream(String name) {
                if (!name.startsWith("desktop-viewer/v1/")) return super.getResourceAsStream(name);
                byte[] bytes = resources.get(name.substring("desktop-viewer/v1/".length()));
                return bytes == null ? null : new java.io.ByteArrayInputStream(bytes);
            }
        });
        try { return new SandboxDesktopProxyController(new SandboxDesktopAccess(sandboxes, records, ""), new OpenClawUiHttpProxyService()); }
        finally { Thread.currentThread().setContextClassLoader(original); }
    }

    @Test
    void goalAcceptsOnlyBoundedJsonObjectsAndNeverUpstreamRedirectsOrHtml() throws Exception {
        for (String type : List.of("text/html", "text/javascript", "application/json")) {
            contentType.set(type); body.set(MALICIOUS);
            assertSafeGoalFailure();
        }
        contentType.set("application/json");
        for (String invalid : List.of("{\"goal\":null}<script>alert(1)</script>", "[1,2]", "{\"goal\":\"" + "x".repeat(1_048_576) + "\"}")) {
            body.set(invalid); assertSafeGoalFailure();
        }
        body.set("{\"goal\":null}"); status.set(302); assertSafeGoalFailure();
    }

    private void assertSafeGoalFailure() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(request("goal"), response);
        assertThat(response.getStatus()).isEqualTo(502);
        assertThat(response.getContentType()).startsWith("application/json");
        assertThat(response.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(response.getHeader("Content-Security-Policy")).contains("default-src 'none'");
        assertThat(response.getHeader("Location")).isNull(); assertThat(response.getHeader("Set-Cookie")).isNull();
        assertThat(response.getContentAsString()).doesNotContain("<script", "server-secret", "sandbox-owned");
    }

    @Test
    void goalGetAndSameOriginPostKeepCloudCredentialsSeparateFromPortalCredentials() throws Exception {
        contentType.set("application/json; charset=utf-8"); body.set("{\"goal\":{\"status\":\"running\",\"actions\":1}}");
        for (String method : List.of("GET", "POST")) {
            MockHttpServletRequest request = request("goal"); request.setMethod(method);
            request.addHeader("Origin", "http://portal.test:18080"); request.addHeader("x-browser-goal-control", "1");
            request.addHeader("Cookie", "SESSION=portal-secret"); request.addHeader("Beyond-Token", "portal-token");
            request.addHeader("Authorization", "Bearer portal-token");
            if (method.equals("POST")) { request.setContentType("application/json"); request.setContent("{\"command\":\"pause\"}".getBytes(StandardCharsets.UTF_8)); }
            MockHttpServletResponse response = new MockHttpServletResponse(); controller.proxy(request, response);
            assertThat(response.getStatus()).isEqualTo(200);
            assertThat(response.getContentAsString()).contains("running");
            assertThat(response.getContentType()).startsWith("application/json");
            assertThat(received.get().getFirst("e2b-traffic-access-token")).isEqualTo("cloud-fixture");
            for (String header : List.of("Cookie", "Beyond-Token", "Authorization")) assertThat(received.get().getFirst(header)).isNull();
        }
        assertThat(upstreamCalls.get()).isEqualTo(2);
    }

    @Test
    void goalJsonStringsRemainDataAndUnavailableGoalStatusDoesNotBecomeHtml() throws Exception {
        contentType.set("application/json"); body.set("{\"goal\":{\"status\":\"</script><script>parent.alert(1)</script>\"}}");
        MockHttpServletResponse data = new MockHttpServletResponse(); controller.proxy(request("goal"), data);
        assertThat(data.getStatus()).isEqualTo(200);
        assertThat(data.getContentType()).startsWith("application/json");
        assertThat(data.getHeader("Content-Security-Policy")).contains("default-src 'none'");
        assertThat(data.getHeader("X-Content-Type-Options")).isEqualTo("nosniff");
        assertThat(data.getHeader("Set-Cookie")).isNull(); assertThat(data.getHeader("Location")).isNull();
        assertThat(new com.fasterxml.jackson.databind.ObjectMapper().readTree(data.getContentAsByteArray()).isObject()).isTrue();
        status.set(404); contentType.set("text/html"); body.set(MALICIOUS);
        MockHttpServletResponse absent = new MockHttpServletResponse(); controller.proxy(request("goal"), absent);
        assertThat(absent.getStatus()).isEqualTo(404);
        assertThat(absent.getContentType()).startsWith("application/json");
        assertThat(absent.getContentAsString()).doesNotContain("sandbox-owned", "<script");
    }

    @Test
    void mvcRoutingHasNoFallbackToSandboxAssetsAndKeepsGoalControls() throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(controller).build();
        String prefix = "/api/sandbox/desktop/exclusive/sb-1/vnc/";
        var session = (MockHttpSession) request("").getSession();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(prefix + "vnc.html")
            .contextPath("/api").session(session))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isTemporaryRedirect())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.header().string("Location", prefix + "index.html"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(prefix + "index.html")
            .contextPath("/api").session(session))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().contentTypeCompatibleWith("text/html"));
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(prefix + "evil.js")
            .contextPath("/api").session(session))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isNotFound());
        assertThat(upstreamCalls.get()).isZero();
        contentType.set("application/json"); body.set("{\"goal\":null}");
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post(prefix + "goal")
            .contextPath("/api").session(session).header("Origin", "http://localhost")
            .header("X-Browser-Goal-Control", "1").contentType("application/json").content("{\"command\":\"pause\"}"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().json("{\"goal\":null}"));
        assertThat(upstreamCalls.get()).isEqualTo(1);
    }
}
