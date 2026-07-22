package com.iwhalecloud.byai.state.infrastructure.filter;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.state.infrastructure.filter.sub.JwtTokenFilter;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

class AccessTokenVerifyInterceptorTest {

    @Test
    void authenticatesSkillMarketplaceInstallWithBeyondToken() {
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        JwtTokenFilter jwtTokenFilter = mock(JwtTokenFilter.class);
        ReflectionTestUtils.setField(interceptor, "jwtTokenFilter", jwtTokenFilter);
        interceptor.init();
        when(jwtTokenFilter.doFilter("BYAI", "portal-login-token")).thenReturn(true);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/tool/installThirdPartySkill");
        request.addHeader("System-Code", "BYAI");
        request.addHeader("Beyond-Token", "portal-login-token");

        assertTrue(interceptor.preHandle(request, new MockHttpServletResponse(), new Object()));
        verify(jwtTokenFilter).doFilter("BYAI", "portal-login-token");
    }
}
