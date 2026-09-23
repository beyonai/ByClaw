package com.iwhalecloud.byai.manager.security.login.wechatphone;

import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.PhoneAccountRegistrationService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.wechat.WechatMiniappPhoneClient;
import org.springframework.security.authentication.AuthenticationProvider;
import org.springframework.security.authentication.AuthenticationServiceException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;

@Component
public class WechatPhoneAuthenticationProvider implements AuthenticationProvider {

    private final WechatMiniappPhoneClient wechat;
    private final PhoneAccountRegistrationService accounts;
    private final LoginApplicationService login;

    public WechatPhoneAuthenticationProvider(WechatMiniappPhoneClient wechat,
        PhoneAccountRegistrationService accounts, LoginApplicationService login) {
        this.wechat = wechat;
        this.accounts = accounts;
        this.login = login;
    }

    @Override
    public Authentication authenticate(Authentication authentication) throws AuthenticationException {
        Object credentials = authentication.getCredentials();
        if (!(credentials instanceof String code) || code.isBlank()) {
            throw new BadCredentialsException("微信手机号授权无效");
        }
        String phone = wechat.exchangePhoneCode(code);
        try {
            Users user = accounts.resolveOrRegister(phone);
            if (user == null || login.checkUserIsValid(user) != null) {
                throw new BadCredentialsException("账号不可用");
            }
            return new WechatPhoneAuthentication(user);
        } catch (AuthenticationException e) {
            throw e;
        } catch (RuntimeException e) {
            // 数据库异常不得带着手机号或 SQL 信息进入登录失败响应。
            throw new AuthenticationServiceException("微信手机号登录暂不可用");
        }
    }

    @Override
    public boolean supports(Class<?> authentication) {
        return WechatPhoneAuthentication.class.isAssignableFrom(authentication);
    }
}
