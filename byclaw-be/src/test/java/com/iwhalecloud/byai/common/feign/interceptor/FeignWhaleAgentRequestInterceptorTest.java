package com.iwhalecloud.byai.common.feign.interceptor;

import java.util.Collection;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import feign.RequestTemplate;

class FeignWhaleAgentRequestInterceptorTest {

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        CurrentUserHolder.clearLoginInfo();
        WhaleAgentUserContextHolder.clear();
    }

    @Test
    void doIntercept_usesUserCodeFallbackWhenLoginInfoMissing() {
        JwtService jwtService = mock(JwtService.class);
        when(jwtService.createJwt(any())).thenReturn("jwt-from-user-code");

        FeignWhaleAgentRequestInterceptor interceptor = interceptor(jwtService);
        RequestTemplate template = new RequestTemplate();
        WhaleAgentUserContextHolder.setUserCode("user001");

        ReflectionTestUtils.invokeMethod(interceptor, "doIntercept", template);

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(jwtService).createJwt(payloadCaptor.capture());
        assertThat(payloadCaptor.getValue()).isEqualTo(Map.of(
            "userCode", "user001"));
        assertThat(headerValue(template, "Beyond-Token")).isEqualTo("jwt-from-user-code");
        assertThat(headerValue(template, "System-Code")).isEqualTo("BYAI");
    }

    @Test
    void doIntercept_generatesBeyondTokenFromLoginInfoWhenRequestContextHasNoToken() {
        JwtService jwtService = mock(JwtService.class);
        when(jwtService.createJwt(any())).thenReturn("jwt-from-login");

        FeignWhaleAgentRequestInterceptor interceptor = interceptor(jwtService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Cookie", "SESSION=req");
        request.addHeader("Language", "zh_CN");
        request.addHeader("x-signature-appkey", "app-key");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        RequestTemplate template = new RequestTemplate();
        ReflectionTestUtils.invokeMethod(interceptor, "doIntercept", template);

        verify(jwtService).createJwt(loginInfo);
        assertThat(headerValue(template, "Cookie")).isEqualTo("SESSION=req");
        assertThat(headerValue(template, "Language")).isEqualTo("zh_CN");
        assertThat(headerValue(template, "x-signature-appkey")).isEqualTo("app-key");
        assertThat(headerValue(template, "Beyond-Token")).isEqualTo("jwt-from-login");
        assertThat(headerValue(template, "System-Code")).isEqualTo("BYAI");
    }

    @Test
    void doIntercept_preservesIncomingBeyondTokenWhenPresent() {
        JwtService jwtService = mock(JwtService.class);
        FeignWhaleAgentRequestInterceptor interceptor = interceptor(jwtService);

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.addHeader("Beyond-Token", "incoming-token");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        RequestTemplate template = new RequestTemplate();
        ReflectionTestUtils.invokeMethod(interceptor, "doIntercept", template);

        verify(jwtService, never()).createJwt(any());
        assertThat(headerValue(template, "Beyond-Token")).isEqualTo("incoming-token");
        assertThat(headerValue(template, "System-Code")).isEqualTo("BYAI");
    }

    private FeignWhaleAgentRequestInterceptor interceptor(JwtService jwtService) {
        FeignWhaleAgentRequestInterceptor interceptor = new FeignWhaleAgentRequestInterceptor();
        ReflectionTestUtils.setField(interceptor, "jwtService", jwtService);
        return interceptor;
    }

    private String headerValue(RequestTemplate template, String headerName) {
        for (Map.Entry<String, Collection<String>> entry : template.headers().entrySet()) {
            if (entry.getKey().equalsIgnoreCase(headerName) && entry.getValue() != null && !entry.getValue().isEmpty()) {
                return entry.getValue().iterator().next();
            }
        }
        return null;
    }
}
