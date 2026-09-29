package com.iwhalecloud.byai.state.infrastructure.filter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.JwtTokenFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SessionFilter;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

class AccessTokenVerifyInterceptorTest {

    @Test
    void allowsInvitationValidationThroughUrlMatcher() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        interceptor.init();
        var login = new LoginInfo();
        login.setUserId(99L);
        CurrentUserHolder.setLoginInfo(login);
        var request = new MockHttpServletRequest("GET", "/byaiService/group-chats/invitations/validate");
        request.setContextPath("/byaiService");
        request.setServletPath("/group-chats/invitations/validate");
        request.addHeader("accessToken", "invalid-token");
        var response = new MockHttpServletResponse();

        assertTrue(interceptor.preHandle(request, response, new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(99L);
    }

    @Test
    void allowsOnlyExactAnonymousCaptchaAndSmsMethods() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        interceptor.init();
        for (String context : List.of("", "/byaiService")) {
            assertTrue(interceptor.preHandle(request("GET", context + "/system/session/captcha", context),
                new MockHttpServletResponse(), new Object()));
            assertTrue(interceptor.preHandle(request("POST", context + "/system/session/captcha", context),
                new MockHttpServletResponse(), new Object()));
            assertTrue(interceptor.preHandle(request("POST", context + "/system/session/sms/send", context),
                new MockHttpServletResponse(), new Object()));
            for (String[] route : List.of(
                    new String[]{"GET", "/system/session/sms/send"},
                    new String[]{"GET", "/system/session/captcha/"},
                    new String[]{"GET", "/system/session/captcha/extra"},
                    new String[]{"GET", "/other/system/session/captcha"},
                    new String[]{"POST", "/system/session/sms/sendExtra"},
                    new String[]{"POST", "/system/session/sms/send/"},
                    new String[]{"POST", "/other/system/session/sms/send"},
                    new String[]{"GET", "/system/session/currentUser"})) {
                MockHttpServletResponse response = new MockHttpServletResponse();
                assertFalse(interceptor.preHandle(request(route[0], context + route[1], context),
                    response, new Object()), route[0] + " " + route[1]);
                assertThat(response.getStatus()).isEqualTo(401);
            }
        }
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void allowsAnonymousSystemConfigurationQueries() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        interceptor.init();

        assertTrue(interceptor.checkUrlByRegex(
            "http://localhost:8086/system/session/getDcSystemConfigValueByCodes"));
        assertTrue(interceptor.checkUrlByRegex(
            "http://localhost:8086/system/staticdata/getDcSystemConfig"));
        assertFalse(interceptor.checkUrlByRegex(
            "http://localhost:8086/byaiService/tool/installThirdPartySkill"));
        assertFalse(interceptor.checkUrlByRegex(
            "http://localhost:8086/system/session/currentUser"));
    }

    @Test
    void allowsAnonymousDesktopVersionDiscoveryAndPackageDownloadOnly() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        interceptor.init();

        assertTrue(interceptor.preHandle(request("GET",
            "/byaiService/api/v1/appVersion/latest", "/byaiService"),
            new MockHttpServletResponse(), new Object()));
        assertTrue(interceptor.preHandle(request("GET",
            "/byaiService/api/v1/appVersion/package/20096802", "/byaiService"),
            new MockHttpServletResponse(), new Object()));

        for (String path : List.of(
                "/api/v1/appVersion/package/not-a-number",
                "/api/v1/appVersion/package/20096802/extra",
                "/api/v1/appVersion/admin/page")) {
            MockHttpServletResponse response = new MockHttpServletResponse();
            assertFalse(interceptor.preHandle(request("GET", "/byaiService" + path, "/byaiService"),
                response, new Object()));
            assertThat(response.getStatus()).isEqualTo(401);
        }
        MockHttpServletResponse postResponse = new MockHttpServletResponse();
        assertFalse(interceptor.preHandle(request("POST",
            "/byaiService/api/v1/appVersion/latest", "/byaiService"), postResponse, new Object()));
        assertThat(postResponse.getStatus()).isEqualTo(401);
    }

    @Test
    void allowsAnonymousWeixinOpenPlatformEventsWithContextPathAndTrailingSlash() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        for (String path : List.of(
                "/byaiService/connector/authorization/callback/weixin-open-platform/events",
                "/byaiService/connector/authorization/callback/weixin-open-platform/events/")) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", path);
            request.setContextPath("/byaiService");

            assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        }
    }

    @Test
    void doesNotAnonymouslyAllowLookalikeOrNonPostWeixinEventPaths() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        for (MockHttpServletRequest request : List.of(
                request("POST", "/other/connector/authorization/callback/weixin-open-platform/events", ""),
                request("POST", "/byaiService/connector/authorization/callback/weixin-open-platform/events/more",
                    "/byaiService"),
                request("GET", "/byaiService/connector/authorization/callback/weixin-open-platform/events",
                    "/byaiService"))) {
            assertFalse(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        }
    }

    @Test
    void externalSessionResourceQueryStillRequiresValidAuthentication() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwt = mock(JwtTokenFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwt);
        interceptor.init();
        String path = "/byaiService/open/api/v1/sessionResources/query";
        assertFalse(interceptor.preHandle(request("POST", path, "/byaiService"),
            new MockHttpServletResponse(), new Object()));
        MockHttpServletRequest invalid = request("POST", path, "/byaiService");
        invalid.addHeader("beyond-token", "invalid-token");
        when(jwt.doFilter(null, "invalid-token")).thenReturn(false);
        assertFalse(interceptor.preHandle(invalid, new MockHttpServletResponse(), new Object()));
        verify(jwt).doFilter(null, "invalid-token");
        MockHttpServletRequest valid = request("POST", path, "/byaiService");
        valid.addHeader("beyond-token", "valid-token");
        when(jwt.doFilter(null, "valid-token")).thenAnswer(invocation -> {
            LoginInfo user = new LoginInfo();
            user.setUserId(7L);
            CurrentUserHolder.setLoginInfo(user);
            return true;
        });
        assertTrue(interceptor.preHandle(valid, new MockHttpServletResponse(), new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(7L);
    }

    private MockHttpServletRequest request(String method, String uri, String contextPath) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, uri);
        request.setContextPath(contextPath);
        return request;
    }

    @Test
    void authenticatesSkillMarketplaceInstallWithBeyondTokenAndReloadsLocalUser() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        ReflectionTestUtils.setField(interceptor, "loginApplicationService", loginApplicationService);
        interceptor.init();
        LoginInfo tokenLoginInfo = new LoginInfo();
        tokenLoginInfo.setUserId(10058L);
        tokenLoginInfo.setUserCode("0027010369");
        LoginInfo localLoginInfo = new LoginInfo();
        localLoginInfo.setUserId(11L);
        localLoginInfo.setUserCode("0027010369");
        localLoginInfo.setUserName("杨总");
        when(jwtTokenFilter.doFilter(null, "portal-login-token")).thenAnswer(invocation -> {
            CurrentUserHolder.setLoginInfo(tokenLoginInfo);
            return true;
        });
        when(loginApplicationService.getLoginInfo("0027010369")).thenReturn(localLoginInfo);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/tool/installThirdPartySkill");
        request.addHeader("Beyond-Token", "portal-login-token");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-session-user");
        request.setSession(cookieSession);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(11L);
        assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("0027010369");
        verify(jwtTokenFilter).doFilter(null, "portal-login-token");
        verify(loginApplicationService).getLoginInfo("0027010369");
        verifyNoInteractions(sessionFilter);
    }

    @Test
    void authenticatesSkillMarketplaceManageableEmployeeQueryWithBeyondToken() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        ReflectionTestUtils.setField(interceptor, "loginApplicationService", loginApplicationService);
        interceptor.init();
        LoginInfo tokenLoginInfo = new LoginInfo();
        tokenLoginInfo.setUserId(10058L);
        tokenLoginInfo.setUserCode("0027010369");
        LoginInfo localLoginInfo = new LoginInfo();
        localLoginInfo.setUserId(11L);
        localLoginInfo.setUserCode("0027010369");
        when(jwtTokenFilter.doFilter(null, "portal-login-token")).thenAnswer(invocation -> {
            CurrentUserHolder.setLoginInfo(tokenLoginInfo);
            return true;
        });
        when(loginApplicationService.getLoginInfo("0027010369")).thenReturn(localLoginInfo);
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/byaiService/tool/queryThirdPartySkillManageableDigitalEmployees");
        request.addHeader("Beyond-Token", "portal-login-token");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-session-user");
        request.setSession(cookieSession);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(11L);
        verify(jwtTokenFilter).doFilter(null, "portal-login-token");
        verify(loginApplicationService).getLoginInfo("0027010369");
        verifyNoInteractions(sessionFilter);
    }

    @Test
    void rejectsSkillMarketplaceInstallWithoutBeyondTokenEvenWhenCookieSessionExists() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        interceptor.init();
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/tool/installThirdPartySkill");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-session-user");
        request.setSession(cookieSession);
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertFalse(interceptor.preHandle(request, response, new Object()));
        assertThat(response.getStatus()).isEqualTo(401);
        verifyNoInteractions(jwtTokenFilter, sessionFilter);
    }

    @Test
    void allowsSkillMarketplaceInstallCorsPreflightWithoutAuthentication() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        interceptor.init();
        MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS",
            "/byaiService/tool/installThirdPartySkill");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        verifyNoInteractions(jwtTokenFilter, sessionFilter);
    }

    @Test
    void allowsSkillMarketplaceManageableEmployeeQueryCorsPreflightWithoutAuthentication() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        interceptor.init();
        MockHttpServletRequest request = new MockHttpServletRequest("OPTIONS",
            "/byaiService/tool/queryThirdPartySkillManageableDigitalEmployees");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        verifyNoInteractions(jwtTokenFilter, sessionFilter);
    }

    @Test
    void connectorSkillCallbackForcesBeyondTokenIdentityOverCookieSession() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        ReflectionTestUtils.setField(interceptor, "loginApplicationService", loginApplicationService);
        interceptor.init();
        LoginInfo tokenLoginInfo = new LoginInfo();
        tokenLoginInfo.setUserId(10058L);
        tokenLoginInfo.setUserCode("token-user");
        LoginInfo localLoginInfo = new LoginInfo();
        localLoginInfo.setUserId(42L);
        localLoginInfo.setUserCode("token-user");
        when(jwtTokenFilter.doFilter(null, "portal-login-token")).thenAnswer(invocation -> {
            CurrentUserHolder.setLoginInfo(tokenLoginInfo);
            return true;
        });
        when(loginApplicationService.getLoginInfo("token-user")).thenReturn(localLoginInfo);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/connector/authorization/skill-complete");
        request.addHeader("Beyond-Token", "portal-login-token");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "different-cookie-user");
        request.setSession(cookieSession);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(42L);
        verify(jwtTokenFilter).doFilter(null, "portal-login-token");
        verify(loginApplicationService).getLoginInfo("token-user");
        verifyNoInteractions(sessionFilter);
    }

    @Test
    void connectorSkillCallbackRejectsMissingBeyondTokenDespiteCookieSession() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        interceptor.init();
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/connector/authorization/skill-complete");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-user");
        request.setSession(cookieSession);
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertFalse(interceptor.preHandle(request, response, new Object()));
        assertThat(response.getStatus()).isEqualTo(401);
        verifyNoInteractions(jwtTokenFilter, sessionFilter);
    }

    @Test
    void orchestratorRuntimeForcesBeyondTokenIdentityOverCookieSession() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        ReflectionTestUtils.setField(interceptor, "loginApplicationService", loginApplicationService);
        interceptor.init();
        LoginInfo tokenLoginInfo = new LoginInfo();
        tokenLoginInfo.setUserId(10058L);
        tokenLoginInfo.setUserCode("runtime-user");
        LoginInfo localLoginInfo = new LoginInfo();
        localLoginInfo.setUserId(66L);
        localLoginInfo.setUserCode("runtime-user");
        when(jwtTokenFilter.doFilter("SUPER", "runtime-token")).thenAnswer(invocation -> {
            CurrentUserHolder.setLoginInfo(tokenLoginInfo);
            return true;
        });
        when(loginApplicationService.getLoginInfo("runtime-user")).thenReturn(localLoginInfo);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/internal/v1/orchestrators/resolve-runtime");
        request.addHeader("System-Code", "SUPER");
        request.addHeader("Beyond-Token", "runtime-token");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-user");
        request.setSession(cookieSession);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(66L);
        verify(jwtTokenFilter).doFilter("SUPER", "runtime-token");
        verify(loginApplicationService).getLoginInfo("runtime-user");
        verifyNoInteractions(sessionFilter);
    }

    @Test
    void orchestratorRuntimeRejectsMissingBeyondTokenDespiteCookieSession() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        interceptor.init();
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/internal/v1/orchestrators/resolve-runtime");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-user");
        request.setSession(cookieSession);
        MockHttpServletResponse response = new MockHttpServletResponse();

        assertFalse(interceptor.preHandle(request, response, new Object()));
        assertThat(response.getStatus()).isEqualTo(401);
        verifyNoInteractions(jwtTokenFilter, sessionFilter);
    }

    @Test
    void artifactUploadForcesBeyondTokenIdentityOverCookieSession() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        ReflectionTestUtils.setField(interceptor, "loginApplicationService", loginApplicationService);
        LoginInfo tokenLoginInfo = new LoginInfo();
        tokenLoginInfo.setUserId(100L);
        tokenLoginInfo.setUserCode("artifact-user");
        LoginInfo localLoginInfo = new LoginInfo();
        localLoginInfo.setUserId(10L);
        localLoginInfo.setUserCode("artifact-user");
        when(jwtTokenFilter.doFilter(null, "artifact-token")).thenAnswer(invocation -> {
            CurrentUserHolder.setLoginInfo(tokenLoginInfo);
            return true;
        });
        when(loginApplicationService.getLoginInfo("artifact-user")).thenReturn(localLoginInfo);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/open/api/v1/artifacts");
        request.addHeader("Beyond-Token", "artifact-token");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-user");
        request.setSession(cookieSession);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(10L);
        verifyNoInteractions(sessionFilter);
    }

    @Test
    void artifactPreviewCapabilityIsAnonymous() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        ReflectionTestUtils.setField(interceptor, "artifactPreviewPathPrefix", "/artifact-preview");
        ReflectionTestUtils.setField(interceptor, "artifactDownloadPathPrefix", "/artifact-download");
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/byaiService/artifact-preview/artifact/index.html");
        request.setContextPath("/byaiService");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

    @Test
    void artifactDataCapabilityReadIsAnonymous() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        ReflectionTestUtils.setField(interceptor, "artifactDataPathPrefix", "/artifact-data");
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/byaiService/artifact-data/artifact/records/record-1");
        request.setContextPath("/byaiService");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
    }

}
