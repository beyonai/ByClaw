package com.iwhalecloud.byai.manager.security.login.wechatphone;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import com.iwhalecloud.byai.manager.entity.users.Users;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;

class WechatPhoneFilterChainTest {

    @Test
    void exactAnonymousPostReachesAuthenticationAndSharedSuccessHandler() throws Exception {
        Users user = new Users();
        AtomicReference<Authentication> completed = new AtomicReference<>();
        WechatPhoneLoginRateLimiter limiter = mock(WechatPhoneLoginRateLimiter.class);
        WechatPhoneAuthenticationFilter filter = new WechatPhoneAuthenticationFilter(
            PathPatternRequestMatcher.withDefaults().matcher(HttpMethod.POST,
                "/system/session/loginByWechatPhone"),
            authentication -> {
                assertThat(authentication.getCredentials()).isEqualTo("one-time-code");
                return new WechatPhoneAuthentication(user);
            },
            (request, response, authentication) -> completed.set(authentication),
            (request, response, error) -> { throw error; }, limiter);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/system/session/loginByWechatPhone");
        request.setServletPath("/system/session/loginByWechatPhone");
        request.setContentType("application/json");
        request.setContent("{\"phoneCode\":\"one-time-code\"}".getBytes(StandardCharsets.UTF_8));

        filter.doFilter(request, new MockHttpServletResponse(), new MockFilterChain());

        assertThat(completed.get().getPrincipal()).isSameAs(user);
        assertThat(completed.get().getCredentials()).isNull();
        verify(limiter).check(request.getRemoteAddr());
    }
}
