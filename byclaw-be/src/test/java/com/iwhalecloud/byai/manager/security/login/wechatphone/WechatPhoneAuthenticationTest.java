package com.iwhalecloud.byai.manager.security.login.wechatphone;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.PhoneAccountRegistrationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.wechat.WechatMiniappPhoneClient;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;

class WechatPhoneAuthenticationTest {

    private final WechatMiniappPhoneClient wechat = mock(WechatMiniappPhoneClient.class);
    private final PhoneAccountRegistrationService accounts = mock(PhoneAccountRegistrationService.class);
    private final LoginApplicationService login = mock(LoginApplicationService.class);
    private final WechatPhoneLoginRateLimiter limiter = mock(WechatPhoneLoginRateLimiter.class);

    @Test
    void providerUsesVerifiedPhoneAndDoesNotKeepOneTimeCode() {
        Users user = new Users();
        when(wechat.exchangePhoneCode("one-time-code")).thenReturn("13800138000");
        when(accounts.resolveOrRegister("13800138000")).thenReturn(user);
        WechatPhoneAuthenticationProvider provider = new WechatPhoneAuthenticationProvider(wechat, accounts, login);

        WechatPhoneAuthentication result = (WechatPhoneAuthentication) provider.authenticate(
            new WechatPhoneAuthentication("one-time-code"));

        assertThat(result.isAuthenticated()).isTrue();
        assertThat(result.getPrincipal()).isSameAs(user);
        assertThat(result.getCredentials()).isNull();
        verify(accounts).resolveOrRegister("13800138000");
    }

    @Test
    void rejectsDisabledAccountAfterPhoneVerification() {
        Users user = new Users();
        when(wechat.exchangePhoneCode("one-time-code")).thenReturn("13800138000");
        when(accounts.resolveOrRegister("13800138000")).thenReturn(user);
        when(login.checkUserIsValid(user)).thenReturn("disabled account");
        WechatPhoneAuthenticationProvider provider = new WechatPhoneAuthenticationProvider(wechat, accounts, login);

        assertThatThrownBy(() -> provider.authenticate(new WechatPhoneAuthentication("one-time-code")))
            .isInstanceOf(BadCredentialsException.class)
            .hasMessageNotContaining("13800138000");
    }

    @Test
    void filterRejectsExtraIdentityFieldsBeforeCallingProvider() throws Exception {
        WechatPhoneAuthenticationFilter filter = new WechatPhoneAuthenticationFilter(
            request -> true, authentication -> authentication, (request, response, auth) -> { },
            (request, response, error) -> { }, limiter);
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/system/session/loginByWechatPhone");
        request.setContentType("application/json");
        request.setContent("{\"phoneCode\":\"code\",\"phone\":\"13800138000\"}"
            .getBytes(java.nio.charset.StandardCharsets.UTF_8));

        assertThatThrownBy(() -> filter.attemptAuthentication(request, new MockHttpServletResponse()))
            .isInstanceOf(BadCredentialsException.class);
        verifyNoInteractions(wechat);
    }

    @Test
    void filterAcceptsOnlyJsonCodeAndRejectsDuplicateOrOversizedFields() throws Exception {
        java.util.concurrent.atomic.AtomicReference<Authentication> captured = new java.util.concurrent.atomic.AtomicReference<>();
        WechatPhoneAuthenticationFilter filter = new WechatPhoneAuthenticationFilter(request -> true,
            authentication -> {
                captured.set(authentication);
                return authentication;
            }, (request, response, auth) -> { }, (request, response, error) -> { }, limiter);

        MockHttpServletRequest valid = request("POST", "application/json", "{\"phoneCode\":\"one-time-code\"}");
        filter.attemptAuthentication(valid, new MockHttpServletResponse());
        assertThat(captured.get().getCredentials()).isEqualTo("one-time-code");
        assertThat(captured.get().getPrincipal()).isNull();

        for (MockHttpServletRequest invalid : java.util.List.of(
            request("GET", "application/json", "{\"phoneCode\":\"x\"}"),
            request("POST", "text/plain", "{\"phoneCode\":\"x\"}"),
            request("POST", "invalid-content-type", "{\"phoneCode\":\"x\"}"),
            request("POST", "application/json", "{\"phoneCode\":\"x\",\"phoneCode\":\"y\"}"),
            request("POST", "application/json", "{\"phoneCode\":\"x\"}{}"),
            request("POST", "application/json", "{\"phoneCode\":\"\"}"),
            request("POST", "application/json", "{\"phoneCode\":\"" + "x".repeat(513) + "\"}"))) {
            assertThatThrownBy(() -> filter.attemptAuthentication(invalid, new MockHttpServletResponse()))
                .isInstanceOf(BadCredentialsException.class);
        }
        verifyNoMoreInteractions(wechat);
    }

    private MockHttpServletRequest request(String method, String contentType, String body) {
        MockHttpServletRequest request = new MockHttpServletRequest(method,
            "/system/session/loginByWechatPhone");
        request.setContentType(contentType);
        request.setContent(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return request;
    }
}
