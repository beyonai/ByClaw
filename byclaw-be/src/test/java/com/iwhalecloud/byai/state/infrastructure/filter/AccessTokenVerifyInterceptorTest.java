package com.iwhalecloud.byai.state.infrastructure.filter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

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
}
