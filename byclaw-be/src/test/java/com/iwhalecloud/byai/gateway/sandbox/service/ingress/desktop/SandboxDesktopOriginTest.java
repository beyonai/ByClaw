package com.iwhalecloud.byai.gateway.sandbox.service.ingress.desktop;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.web.server.ResponseStatusException;

class SandboxDesktopOriginTest {
    SandboxService sandboxes;
    SsSandboxRecordMapper records;
    SandboxInfo info;

    @BeforeEach
    void setup() {
        sandboxes = mock(SandboxService.class); records = mock(SsSandboxRecordMapper.class);
        LoginInfo login = new LoginInfo(); login.setUserCode("alice"); login.setUserId(1L); login.setEnterpriseId(10L);
        CurrentUserHolder.setLoginInfo(login);
        info = SandboxInfo.builder().userCode("alice").sandboxId("sb-1").sandboxType("browser")
            .instanceEndpoints(Map.of("vnc", "https://cloud.test/?token=gateway"))
            .endpointHeaders(Map.of("e2b-traffic-access-token", "cloud-fixture")).build();
        when(sandboxes.sandboxInfo("alice", "sb-1")).thenAnswer(call -> List.of(info));
        SsSandboxRecord record = new SsSandboxRecord(); record.setStatus("RUNNING");
        when(records.selectLatestBySandboxId("alice", "browser", "sb-1")).thenReturn(record);
    }

    @AfterEach
    void cleanup() { CurrentUserHolder.clearLoginInfo(); }

    AnnotationConfigApplicationContext context(String origins) {
        return context(Map.of("sandbox.desktop.allowed-origins", origins));
    }

    AnnotationConfigApplicationContext context(Map<String, Object> properties) {
        AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test-desktop-origins", properties));
        context.getBeanFactory().registerSingleton("sandboxService", sandboxes);
        context.getBeanFactory().registerSingleton("sandboxRecordMapper", records);
        context.register(SandboxDesktopAccess.class);
        try { context.refresh(); return context; }
        catch (RuntimeException failure) { context.close(); throw failure; }
    }

    MockHttpServletRequest request(boolean websocket, String origin) {
        MockHttpServletRequest request = new MockHttpServletRequest(websocket ? "GET" : "POST",
            "/api/sandbox/desktop/exclusive/sb-1/vnc/" + (websocket ? "websockify" : "goal"));
        request.setContextPath("/api"); request.setScheme("http"); request.setServerName("internal-proxy.test"); request.setServerPort(80);
        MockHttpSession session = new MockHttpSession(); session.setAttribute("USER_CODE", "alice"); session.setAttribute("enterpriseId", 10L);
        request.setSession(session);
        if (origin != null) request.addHeader("Origin", origin);
        if (!websocket) request.addHeader("X-Browser-Goal-Control", "1");
        return request;
    }

    @Test
    void configuredOriginAuthorizesWebsocketAndGoalAfterProxyAuthorityRewriting() {
        try (var context = context(" http://PUBLIC.test:18080, https://secure.test:443 ")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            for (boolean websocket : List.of(true, false)) {
                assertThatCode(() -> {
                    var target = access.resolve(request(websocket, "http://public.test:18080"), websocket);
                    assertThat(target.url().encodedPath()).isEqualTo(websocket ? "/websockify" : "/goal");
                    assertThat(target.headers()).containsEntry("e2b-traffic-access-token", "cloud-fixture");
                }).doesNotThrowAnyException();
            }
        }
    }

    @Test
    void configuredOriginsNormalizeHostCaseAndDefaultPorts() {
        try (var context = context("https://PORTAL.test:443,http://public.test")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            for (String origin : List.of("https://portal.test", "https://PORTAL.test:443", "http://PUBLIC.test:80")) {
                assertThatCode(() -> access.resolve(request(true, origin), true)).doesNotThrowAnyException();
            }
        }
    }

    @Test
    void documentedUppercaseConfigurationAliasIsResolvedBySpringInjection() {
        try (var context = context(Map.of("SANDBOX_DESKTOP_ALLOWED_ORIGINS", "http://public.test:18080"))) {
            var access = context.getBean(SandboxDesktopAccess.class);
            assertThatCode(() -> access.resolve(request(true, "http://public.test:18080"), true)).doesNotThrowAnyException();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"*", "null", "ftp://portal.test", "//portal.test", "https://", "http://bad host",
        "https://user@portal.test", "https://portal.test/", "https://portal.test/path", "https://portal.test?x=1",
        "https://portal.test#x", "https://portal.test:0", "https://portal.test:65536", "https://portal.test:",
        "https://portal.test,", ",", "https://portal.test,,http://other.test"})
    void invalidConfiguredOriginsFailDuringSpringStartup(String origin) {
        assertThatThrownBy(() -> { try (var ignored = context(origin)) { } })
            .hasRootCauseInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @ValueSource(strings = {"cross-site", "same-site", "none", "", "invalid"})
    void configuredOriginNeverOverridesAnExplicitFetchMetadataDenial(String site) {
        try (var context = context("http://public.test:18080")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            for (boolean websocket : List.of(true, false)) {
                var request = request(websocket, "http://public.test:18080"); request.addHeader("Sec-Fetch-Site", site);
                assertThatThrownBy(() -> access.resolve(request, websocket)).isInstanceOf(ResponseStatusException.class);
            }
        }
    }

    @Test
    void wrongSchemeHostOrPortAndArbitraryForwardedHeadersDoNotGrantAccess() {
        try (var context = context("http://public.test:18080")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            for (String origin : List.of("http://public.test:18081", "https://public.test:18080", "http://other.test:18080")) {
                for (boolean websocket : List.of(true, false)) {
                    var request = request(websocket, origin);
                    request.addHeader("Forwarded", "proto=http;host=public.test:18080");
                    request.addHeader("X-Forwarded-Host", "public.test:18080"); request.addHeader("X-Forwarded-Proto", "http");
                    request.addHeader("X-Forwarded-Port", "18080");
                    assertThatThrownBy(() -> access.resolve(request, websocket)).isInstanceOf(ResponseStatusException.class);
                }
            }
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "null", "ftp://public.test:18080", "http://user@public.test:18080", "http://public.test:18080/",
        "http://public.test:18080/path", "http://public.test:18080?x=1", "http://public.test:18080#x", "http://public.test:"})
    void invalidRequestOriginsAreRejectedEvenWithSameOriginFetchMetadata(String origin) {
        try (var context = context("http://public.test:18080")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            var request = request(true, origin); request.addHeader("Sec-Fetch-Site", "same-origin");
            assertThatThrownBy(() -> access.resolve(request, true)).isInstanceOf(ResponseStatusException.class);
        }
    }

    @Test
    void configuredOriginStillRequiresSessionTenantOwnerAndTheExactResourceReference() {
        try (var context = context("http://public.test:18080")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            assertThatCode(() -> access.resolve(request(true, "http://public.test:18080"), true)).doesNotThrowAnyException();
            for (boolean websocket : List.of(true, false)) {
                var missing = request(websocket, "http://public.test:18080"); missing.setSession(null);
                assertThatThrownBy(() -> access.resolve(missing, websocket)).isInstanceOfSatisfying(ResponseStatusException.class,
                    failure -> assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
                var foreignTenant = request(websocket, "http://public.test:18080"); foreignTenant.getSession().setAttribute("enterpriseId", 11L);
                assertThatThrownBy(() -> access.resolve(foreignTenant, websocket)).isInstanceOfSatisfying(ResponseStatusException.class,
                    failure -> assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED));
                var foreignSandbox = request(websocket, "http://public.test:18080");
                foreignSandbox.setRequestURI(foreignSandbox.getRequestURI().replace("sb-1", "sb-2"));
                assertThatThrownBy(() -> access.resolve(foreignSandbox, websocket)).isInstanceOfSatisfying(ResponseStatusException.class,
                    failure -> assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
            }
            info.setUserCode("other");
            assertThatThrownBy(() -> access.resolve(request(true, "http://public.test:18080"), true)).isInstanceOf(ResponseStatusException.class);
            info.setUserCode("alice"); info.setIsShared(true); info.setMappingId("mapping-1");
            var shared = request(true, "http://public.test:18080");
            shared.setRequestURI("/api/sandbox/desktop/shared/other-mapping/sb-1/vnc/websockify");
            assertThatThrownBy(() -> access.resolve(shared, true)).isInstanceOfSatisfying(ResponseStatusException.class,
                failure -> assertThat(failure.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
        }
    }

    @Test
    void emptyConfigurationPreservesStrictServletMatchingAndMissingOriginRejection() {
        try (var context = context("  ")) {
            var access = context.getBean(SandboxDesktopAccess.class);
            var local = request(true, "http://internal-proxy.test");
            assertThat(access.resolve(local, true).url().host()).isEqualTo("cloud.test");
            assertThatThrownBy(() -> access.resolve(request(true, "http://public.test:18080"), true)).isInstanceOf(ResponseStatusException.class);
            var missing = request(true, null); missing.addHeader("Sec-Fetch-Site", "same-origin");
            assertThatThrownBy(() -> access.resolve(missing, true)).isInstanceOf(ResponseStatusException.class);
        }
    }
}
