package com.iwhalecloud.byai.manager.security.login.phone;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.security.handle.MultAuthenticationFailureHandler;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.InternalAuthenticationServiceException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.*;

class PhoneAuthenticationProviderTest {
    private final UserService users = mock(UserService.class);
    private final SafeAccountMsgService sms = mock(SafeAccountMsgService.class);
    private final PhoneAuthenticationProvider provider = new PhoneAuthenticationProvider();
    private final PhoneAuthentication request = new PhoneAuthentication();
    private MessageSource previousSource;
    private Locale previousLocale;

    @BeforeEach
    void setUp() {
        previousSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        previousLocale = LocaleContextHolder.getLocale();
        ResourceBundleMessageSource source = new ResourceBundleMessageSource();
        source.setBasename("i18n/messages");
        source.setDefaultEncoding("UTF-8");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", source);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        ReflectionTestUtils.setField(provider, "userService", users);
        ReflectionTestUtils.setField(provider, "safeAccountMsgService", sms);
        ReflectionTestUtils.setField(provider, "loginApplicationService", mock(LoginApplicationService.class));
        request.setPhone("13800138000");
        request.setVerifyCode("123456");
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousSource);
        LocaleContextHolder.setLocale(previousLocale);
    }

    @Test
    void missingPhoneReturnsActionableMessageWithoutFailurePrefix() throws Exception {
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of());
        assertFailure("该手机号尚未绑定账号，请使用账号密码登录。");
        verifyNoInteractions(sms);
    }

    @Test
    void disabledAccountIsDistinguishedFromMissingPhone() throws Exception {
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of(user("X")));
        assertFailure("账号已停用，请联系管理员。");
        verifyNoInteractions(sms);
    }

    @Test
    void duplicateActiveAccountsCannotConsumeSmsCode() throws Exception {
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of(user("A"), user("A")));
        assertFailure("手机号绑定异常，请联系管理员。");
        verifyNoInteractions(sms);
    }

    @Test
    void oneActiveAccountAlongsideDisabledAccountStillLogsIn() {
        Users active = user("A");
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of(user("X"), active));
        SafeAccountMsg code = new SafeAccountMsg();
        code.setVerifyCode(Sm4Util.encrypt("123456"));
        when(sms.qryLastByPhone(anyString(), anyString())).thenReturn(List.of(code));
        Authentication result = provider.authenticate(request);
        assertThat(result.isAuthenticated()).isTrue();
        assertThat(((PhoneAuthentication) result).getUsers()).isSameAs(active);
        assertThat(code.getState()).isEqualTo(SafeAccountMsg.STATE_EXPIRED);
    }

    @Test
    void databaseFailureReturnsRetryMessageWithoutInternalDetails() throws Exception {
        when(users.findAllByUserPhone(anyString()))
            .thenThrow(new DataAccessResourceFailureException("internal database details"));
        assertFailure("登录服务暂时不可用，请稍后重试。");
    }

    @Test
    void missingPhoneHasEnglishTranslation() throws Exception {
        LocaleContextHolder.setLocale(Locale.US);
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of());
        assertFailure("This phone number is not linked to an account. Please sign in with your username and password.");
    }

    @Test
    void expiredCodeStillReturnsExpiryReason() throws Exception {
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of(user("A")));
        when(sms.qryLastByPhone(anyString(), anyString())).thenReturn(List.of());
        AuthenticationException failure = assertThrows(AuthenticationException.class,
            () -> provider.authenticate(request));
        assertThat(failure.getMessage()).isEqualTo("验证码已过期，请重新获取！");
    }

    @Test
    void incorrectCodeIsNotConsumed() {
        when(users.findAllByUserPhone(anyString())).thenReturn(List.of(user("A")));
        SafeAccountMsg code = new SafeAccountMsg();
        code.setVerifyCode(Sm4Util.encrypt("654321"));
        when(sms.qryLastByPhone(anyString(), anyString())).thenReturn(List.of(code));
        AuthenticationException failure = assertThrows(AuthenticationException.class,
            () -> provider.authenticate(request));
        assertThat(failure.getMessage()).isEqualTo("验证码错误，请核对后重新输入！");
        assertThat(code.getState()).isNull();
    }

    @Test
    void internalAuthenticationErrorIsNotExposedToPhoneClient() throws Exception {
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.setServletPath("/system/session/loginByPhone");
        MockHttpServletResponse response = new MockHttpServletResponse();
        new MultAuthenticationFailureHandler().onAuthenticationFailure(httpRequest, response,
            new InternalAuthenticationServiceException("internal database details"));
        JsonNode body = new ObjectMapper().readTree(response.getContentAsByteArray());
        assertThat(body.path("msg").asText()).isEqualTo("登录服务暂时不可用，请稍后重试。");
    }

    @Test
    void usernameFailureKeepsExistingResponseContract() throws Exception {
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.setServletPath("/system/session/loginByUsername");
        MockHttpServletResponse response = new MockHttpServletResponse();
        new MultAuthenticationFailureHandler().onAuthenticationFailure(httpRequest, response,
            new BadCredentialsException("用户名或密码错误"));
        JsonNode body = new ObjectMapper().readTree(response.getContentAsByteArray());
        assertThat(body.path("msg").asText()).isEqualTo("认证失败,失败原因:用户名或密码错误");
    }

    private void assertFailure(String expectedMessage) throws Exception {
        AuthenticationException failure = assertThrows(AuthenticationException.class,
            () -> provider.authenticate(request));
        MockHttpServletRequest httpRequest = new MockHttpServletRequest();
        httpRequest.setServletPath("/system/session/loginByPhone");
        MockHttpServletResponse response = new MockHttpServletResponse();
        new MultAuthenticationFailureHandler().onAuthenticationFailure(httpRequest, response, failure);
        JsonNode body = new ObjectMapper().readTree(response.getContentAsByteArray());
        assertThat(body.path("code").asInt()).isEqualTo(-1);
        assertThat(body.path("msg").asText()).isEqualTo(expectedMessage);
        assertThat(body.path("token").isNull()).isTrue();
    }

    private Users user(String state) {
        Users user = new Users();
        user.setState(state);
        return user;
    }
}
