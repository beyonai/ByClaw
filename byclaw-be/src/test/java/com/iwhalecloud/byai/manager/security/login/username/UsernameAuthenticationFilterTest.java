package com.iwhalecloud.byai.manager.security.login.username;

import com.iwhalecloud.byai.common.login.bean.LoginForm;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class UsernameAuthenticationFilterTest {

    @Test
    void obtainLoginFormKeepsPasswordAndEncryptFieldsSeparateForFormRequests() {
        UsernameAuthenticationFilter filter = new UsernameAuthenticationFilter(
            mock(RequestMatcher.class),
            mock(AuthenticationManager.class),
            mock(AuthenticationSuccessHandler.class),
            mock(AuthenticationFailureHandler.class)
        );
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addParameter("loginType", "5");
        request.addParameter("accountCode", "account");
        request.addParameter("accountPwd", "password");
        request.addParameter("encrypt", "2");

        LoginForm loginForm = ReflectionTestUtils.invokeMethod(filter, "obtainLoginForm", request);

        assertThat(loginForm).isNotNull();
        assertThat(loginForm.getAccountPwd()).isEqualTo("password");
        assertThat(loginForm.getEncrypt()).isEqualTo("2");
    }
}
