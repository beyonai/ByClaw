package com.iwhalecloud.byai.state.infrastructure.filter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.state.infrastructure.filter.sub.JwtTokenFilter;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SessionFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

class AccessTokenVerifyInterceptorTest {

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
    void authenticatesSkillMarketplaceInstallWithBeyondToken() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        SessionFilter sessionFilter = mock(SessionFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        ReflectionTestUtils.setField(interceptor, "sessionFilter", sessionFilter);
        interceptor.init();
        when(jwtTokenFilter.doFilter("BYAI", "portal-login-token")).thenReturn(true);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/tool/installThirdPartySkill");
        request.addHeader("System-Code", "BYAI");
        request.addHeader("Beyond-Token", "portal-login-token");
        MockHttpSession cookieSession = new MockHttpSession();
        cookieSession.setAttribute("USER_CODE", "cookie-session-user");
        request.setSession(cookieSession);

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        verify(jwtTokenFilter).doFilter("BYAI", "portal-login-token");
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
}
