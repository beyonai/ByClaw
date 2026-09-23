package com.iwhalecloud.byai.manager.security.login.wechatphone;

import com.iwhalecloud.byai.manager.entity.users.Users;
import org.springframework.security.authentication.AbstractAuthenticationToken;

/** 登录成功后只保留用户，丢弃微信一次性授权 code。 */
public class WechatPhoneAuthentication extends AbstractAuthenticationToken {

    private final String phoneCode;
    private final Users user;

    public WechatPhoneAuthentication(String phoneCode) {
        super(null);
        this.phoneCode = phoneCode;
        this.user = null;
    }

    public WechatPhoneAuthentication(Users user) {
        super(null);
        this.phoneCode = null;
        this.user = user;
        super.setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return isAuthenticated() ? null : phoneCode;
    }

    @Override
    public Object getPrincipal() {
        return isAuthenticated() ? user : null;
    }

    @Override
    public void setAuthenticated(boolean authenticated) {
        if (authenticated) {
            throw new IllegalArgumentException("Use the authenticated constructor");
        }
        super.setAuthenticated(false);
    }
}
