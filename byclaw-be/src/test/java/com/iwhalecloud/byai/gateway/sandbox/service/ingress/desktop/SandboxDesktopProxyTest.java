package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.ingress.openclaw.OpenClawUiHttpProxyService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.server.ResponseStatusException;

class SandboxDesktopProxyTest {
    SandboxService service;
    SsSandboxRecordMapper records;
    SandboxDesktopAccess access;
    SandboxInfo info;

    @BeforeEach
    void setup() {
        service = mock(SandboxService.class);
        records = mock(SsSandboxRecordMapper.class);
        access = new SandboxDesktopAccess(service, records, "");
        LoginInfo login = new LoginInfo();
        login.setUserCode("alice"); login.setUserId(1L); login.setEnterpriseId(10L);
        CurrentUserHolder.setLoginInfo(login);
        info = SandboxInfo.builder().userCode("alice").sandboxId("sb-1").sandboxType("browser")
            .instanceEndpoints(Map.of("vnc", "https://cloud.test/?token=gateway", "ssh", "https://private.test/"))
            .endpointHeaders(Map.of("e2b-traffic-access-token", "cloud-fixture")).build();
        when(service.sandboxInfo("alice", "sb-1")).thenAnswer(call -> List.of(info));
        SsSandboxRecord record = new SsSandboxRecord(); record.setStatus("RUNNING");
        when(records.selectLatestBySandboxId("alice", "browser", "sb-1")).thenReturn(record);
    }

    @AfterEach
    void clear() { CurrentUserHolder.clearLoginInfo(); }

    MockHttpServletRequest request(String suffix) {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/sandbox/desktop/exclusive/sb-1/vnc/" + suffix);
        request.setContextPath("/api"); request.setScheme("http"); request.setServerName("portal.test"); request.setServerPort(18080);
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("USER_CODE", "alice"); session.setAttribute("enterpriseId", 10L);
        request.setSession(session);
        return request;
    }

    @Test
    void resolvesRelativeResourcesAndPreservesOnlyUpstreamAndViewerQueries() {
        MockHttpServletRequest request = request("core/rfb.js");
        request.setQueryString("sessionId=shared&autoconnect=true");
        var target = access.resolve(request, false);
        verify(service).sandboxInfo("alice", "sb-1");
        verify(service, never()).sandboxInfo("alice");
        assertThat(target.url().toString()).isEqualTo("https://cloud.test/core/rfb.js?token=gateway&sessionId=shared&autoconnect=true");
        assertThat(target.headers()).containsEntry("e2b-traffic-access-token", "cloud-fixture");
    }

    @Test
    void validLegacySessionUsesTheAuthoritativeDirectoryWithoutAnIndependentMembershipVeto() {
        CurrentUserHolder.getLoginInfo().setEnterpriseId(1L);
        MockHttpServletRequest legacy = request(""); legacy.getSession().setAttribute("enterpriseId", 1L);
        assertThat(access.resolve(legacy, false).url().host()).isEqualTo("cloud.test");
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"missing", "empty", "provider"})
    void projectsDesktopNavigationIndependentlyOfProviderHeaders(String observation) {
        if ("missing".equals(observation)) info.setEndpointHeaders(null);
        if ("empty".equals(observation)) info.setEndpointHeaders(Map.of());
        info.setInstanceEndpoints(Map.of("vnc", "https://cloud.test/?token=gateway&sessionId=server",
            "ssh", "https://private.test/", "desktop", "https://other.test/", "app", "https://app.test/"));
        info.setInstanceDescriptors(Map.of("desktop", Map.of("viewer", "iframe"), "app", Map.of("viewer", "iframe")));

        Map<String, String> navigation = SandboxDesktopAccess.navigationEndpoints(info, "/api");

        assertThat(navigation.get("vnc")).isEqualTo("/api/sandbox/desktop/exclusive/sb-1/vnc/?sessionId=server");
        assertThat(navigation).containsEntry("ssh", "https://private.test/")
            .containsEntry("desktop", "https://other.test/").containsEntry("app", "https://app.test/");
        assertThat(info.getInstanceEndpoints()).containsEntry("vnc", "https://cloud.test/?token=gateway&sessionId=server");
        assertThat(access.resolve(request(""), false).url().toString())
            .isEqualTo("https://cloud.test/?token=gateway&sessionId=server");
        if ("provider".equals(observation)) {
            assertThat(access.resolve(request(""), false).headers()).containsEntry("e2b-traffic-access-token", "cloud-fixture");
        } else {
            assertThat(access.resolve(request(""), false).headers()).isEmpty();
        }
    }

    @Test
    void headerFreeSharedDesktopPreservesMappingAndFileViewerParameters() {
        info.setEndpointHeaders(Map.of()); info.setIsShared(true); info.setMappingId("mapping-1");
        info.setInstanceEndpoints(Map.of("screen", "https://cloud.test/desktop/vnc.html?token=gateway&sessionId=server&view_only=true"));
        info.setInstanceDescriptors(Map.of("screen", Map.of("viewer", "novnc")));

        String navigation = SandboxDesktopAccess.navigationEndpoints(info, "/api").get("screen");

        assertThat(navigation).startsWith("/api/sandbox/desktop/shared/mapping-1/sb-1/screen/vnc.html?")
            .contains("sessionId=server", "view_only=true", "path=api%2Fsandbox%2Fdesktop%2Fshared%2Fmapping-1%2Fsb-1%2Fscreen%2Fwebsockify%3FsessionId%3Dserver")
            .doesNotContain("token=gateway");
        MockHttpServletRequest shared = request(""); shared.setRequestURI(navigation.split("\\?")[0]);
        assertThat(access.resolve(shared, false).url().toString())
            .isEqualTo("https://cloud.test/desktop/vnc.html?token=gateway&sessionId=server&view_only=true");
    }

    @Test
    void fileViewerKeepsItsEntryAndResolvesAssetsFromItsParent() {
        info.setInstanceEndpoints(Map.of("vnc", "https://cloud.test/desktop/vnc.html?token=gateway&sessionId=server"));
        String navigation = SandboxDesktopAccess.navigationEndpoints(info, "/api").get("vnc");
        assertThat(navigation).startsWith("/api/sandbox/desktop/exclusive/sb-1/vnc/vnc.html?")
            .contains("sessionId=server").doesNotContain("token=gateway");
        assertThat(access.resolve(request("vnc.html"), false).url().toString())
            .isEqualTo("https://cloud.test/desktop/vnc.html?token=gateway&sessionId=server");
        assertThat(access.resolve(request("core/rfb.js"), false).url().encodedPath()).isEqualTo("/desktop/core/rfb.js");
        MockHttpServletRequest entry = request("vnc.html"); entry.setQueryString("sessionId=server&path=scoped%2Fwebsockify");
        assertThat(access.resolve(entry, false).url().queryParameterValues("sessionId")).containsExactly("server");
    }

    @Test
    void customUnicodeInstanceNamesAreEncodedWithoutAllowingPathSeparators() {
        info.setInstanceEndpoints(Map.of("编辑器 A", "https://cloud.test/"));
        info.setInstanceDescriptors(Map.of("编辑器 A", Map.of("viewer", "novnc")));
        String navigation = SandboxDesktopAccess.navigationEndpoints(info, "/api").get("编辑器 A");
        assertThat(navigation).contains("/%E7%BC%96%E8%BE%91%E5%99%A8%20A/");
        MockHttpServletRequest request = request(""); request.setRequestURI(navigation);
        assertThat(access.resolve(request, false).url().host()).isEqualTo("cloud.test");
        request.setRequestURI(navigation.replace("%20", "%2F"));
        assertThatThrownBy(() -> access.resolve(request, false)).isInstanceOf(ResponseStatusException.class);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void rejectsMissingSessionWrongOwnerAndReleasedAllocation(boolean headerFree) {
        if (headerFree) info.setEndpointHeaders(Map.of());
        MockHttpServletRequest missingSession = request(""); missingSession.setSession(null);
        assertThatThrownBy(() -> access.resolve(missingSession, false)).isInstanceOf(ResponseStatusException.class);
        MockHttpServletRequest wrongOwner = request(""); wrongOwner.getSession().setAttribute("USER_CODE", "other");
        assertThatThrownBy(() -> access.resolve(wrongOwner, false)).isInstanceOf(ResponseStatusException.class);
        MockHttpServletRequest wrongEnterprise = request(""); wrongEnterprise.getSession().setAttribute("enterpriseId", 99L);
        assertThatThrownBy(() -> access.resolve(wrongEnterprise, false)).isInstanceOf(ResponseStatusException.class);
        SsSandboxRecord released = new SsSandboxRecord(); released.setStatus("RELEASED");
        when(records.selectLatestBySandboxId("alice", "browser", "sb-1")).thenReturn(released);
        assertThatThrownBy(() -> access.resolve(request(""), false)).isInstanceOf(ResponseStatusException.class);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void rejectsCrossSandboxWrongSharedMappingAndNonDesktopInstances(boolean headerFree) {
        if (headerFree) info.setEndpointHeaders(null);
        MockHttpServletRequest request = request("");
        request.setRequestURI(request.getRequestURI().replace("sb-1", "sb-2"));
        assertThatThrownBy(() -> access.resolve(request, false)).isInstanceOf(ResponseStatusException.class);
        MockHttpServletRequest ssh = request(""); ssh.setRequestURI(ssh.getRequestURI().replace("/vnc/", "/ssh/"));
        assertThatThrownBy(() -> access.resolve(ssh, false)).isInstanceOf(ResponseStatusException.class);
        info.setIsShared(true); info.setMappingId("mapping-1");
        MockHttpServletRequest shared = request("");
        shared.setRequestURI("/api/sandbox/desktop/shared/mapping-other/sb-1/vnc/");
        assertThatThrownBy(() -> access.resolve(shared, false)).isInstanceOf(ResponseStatusException.class);
        shared.setRequestURI("/api/sandbox/desktop/shared/mapping-1/sb-1/vnc/");
        assertThat(access.resolve(shared, false).url().host()).isEqualTo("cloud.test");
    }

    @Test
    void explicitNonDesktopViewerDescriptorDeniesAccess() {
        info.setInstanceDescriptors(Map.of("vnc", Map.of("viewer", "other")));
        assertThatThrownBy(() -> access.resolve(request(""), false)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void websocketRequiresOriginAndAllowsMatchingHostnameAfterProxyPortRewriting() {
        MockHttpServletRequest request = request("websockify");
        assertThatThrownBy(() -> access.resolve(request, true)).isInstanceOf(ResponseStatusException.class);
        request.addHeader("Origin", "http://portal.test:18080");
        assertThat(access.resolve(request, true).url().toString()).contains("/websockify");
        request.setServerPort(8080); // A trusted reverse proxy may have removed the public port.
        assertThat(access.resolve(request, true).url().host()).isEqualTo("cloud.test");
    }

    @Test
    void disallowsMutationsExceptAuthorizedGoalControlAndRejectsTraversal() {
        MockHttpServletRequest request = request("core/rfb.js"); request.setMethod("POST");
        assertThatThrownBy(() -> access.resolve(request, false)).isInstanceOf(ResponseStatusException.class);
        MockHttpServletRequest goal = request("goal"); goal.setMethod("POST");
        goal.addHeader("Origin", "http://portal.test:18080"); goal.addHeader("x-browser-goal-control", "1");
        assertThat(access.resolve(goal, false).url().encodedPath()).isEqualTo("/goal");
        assertThatThrownBy(() -> access.resolve(request("%2e%2e/ssh"), false)).isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void originalOpenClawTransportKeepsItsAttachmentAndRedirectSemantics() throws Exception {
        HttpServer cloud = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        cloud.createContext("/", exchange -> {
            byte[] body = "<!doctype html><title>legacy</title>".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "text/html");
            exchange.getResponseHeaders().add("Content-Disposition", "attachment; filename=legacy.html");
            exchange.getResponseHeaders().add("Location", "https://legacy.invalid/");
            exchange.sendResponseHeaders(302, body.length); exchange.getResponseBody().write(body); exchange.close();
        }); cloud.start();
        try {
            MockHttpServletResponse response = new MockHttpServletResponse();
            new OpenClawUiHttpProxyService().forward(request(""), response, "http://127.0.0.1:" + cloud.getAddress().getPort() + "/", null);
            assertThat(response.getStatus()).isEqualTo(302);
            assertThat(response.getHeader("Location")).isEqualTo("https://legacy.invalid/");
            assertThat(response.getHeader("Content-Disposition")).isEqualTo("attachment; filename=legacy.html");
            assertThat(response.getContentAsString()).contains("<title>legacy</title>");
        } finally { cloud.stop(0); }
    }

    @Test
    void plainHttpIpWithoutFetchMetadataAllowsMatchingHostnameDespiteProxyPortRewriting() throws Exception {
        org.apache.catalina.startup.Tomcat tomcat = new org.apache.catalina.startup.Tomcat();
        java.nio.file.Path base = java.nio.file.Files.createTempDirectory("desktop-origin-container-");
        tomcat.setBaseDir(base.toString()); tomcat.setPort(0); tomcat.getConnector();
        var context = tomcat.addContext("/api", base.toString());
        var servlet = org.apache.catalina.startup.Tomcat.addServlet(context, "origin-probe", new jakarta.servlet.http.HttpServlet() {
            @Override
            protected void doGet(jakarta.servlet.http.HttpServletRequest request, jakarta.servlet.http.HttpServletResponse response)
                throws java.io.IOException, jakarta.servlet.ServletException {
                LoginInfo login = new LoginInfo(); login.setUserCode("alice"); login.setUserId(1L); login.setEnterpriseId(10L);
                CurrentUserHolder.setLoginInfo(login);
                request.getSession().setAttribute("USER_CODE", "alice"); request.getSession().setAttribute("enterpriseId", 10L);
                try {
                    boolean spring = new org.springframework.web.socket.server.support.OriginHandshakeInterceptor().beforeHandshake(
                        new org.springframework.http.server.ServletServerHttpRequest(request),
                        new org.springframework.http.server.ServletServerHttpResponse(response),
                        mock(org.springframework.web.socket.WebSocketHandler.class), new java.util.HashMap<>());
                    boolean desktop;
                    try { access.resolve(request, true); desktop = true; }
                    catch (ResponseStatusException rejected) { desktop = false; }
                    response.setStatus(desktop ? 200 : 403); response.setContentType("text/plain");
                    response.getWriter().write("port=" + request.getServerPort() + ";spring=" + spring + ";desktop=" + desktop
                        + ";metadata=" + (request.getHeader("Sec-Fetch-Site") != null));
                } catch (Exception failure) { throw new jakarta.servlet.ServletException(failure); }
                finally { CurrentUserHolder.clearLoginInfo(); }
            }
        });
        servlet.setLoadOnStartup(1); context.addServletMappingDecoded("/", "origin-probe");
        try {
            tomcat.start();
            for (String host : List.of("192.0.2.10", "192.0.2.10:8080")) {
                String response;
                try (java.net.Socket socket = new java.net.Socket("127.0.0.1", tomcat.getConnector().getLocalPort())) {
                    socket.setSoTimeout(5000);
                    socket.getOutputStream().write(("GET /api/sandbox/desktop/exclusive/sb-1/vnc/websockify HTTP/1.1\r\n"
                        + "Host: " + host + "\r\nOrigin: http://192.0.2.10:8080\r\nConnection: close\r\n\r\n")
                        .getBytes(java.nio.charset.StandardCharsets.US_ASCII));
                    response = new String(socket.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.US_ASCII);
                }
                String status = response.substring(0, response.indexOf("\r\n"));
                String body = response.substring(response.indexOf("\r\n\r\n") + 4);
                if (host.endsWith(":8080")) {
                    assertThat(status).contains("200");
                    assertThat(body).contains("port=8080;spring=true;desktop=true;metadata=false");
                } else {
                    assertThat(status).contains("200");
                    assertThat(body).contains("port=80;spring=false;desktop=true;metadata=false");
                }
            }
        } finally {
            tomcat.stop(); tomcat.destroy();
            try (var paths = java.nio.file.Files.walk(base)) {
                for (var path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) java.nio.file.Files.deleteIfExists(path);
            }
        }
    }
}
