package com.iwhalecloud.byai.manager.security.login.apple;

import com.iwhalecloud.byai.manager.entity.users.Users;
import lombok.Getter;
import lombok.Setter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.Authentication;

/**
 * @description 苹果登录认证载体
 * SpringSecurity传输登录认证的数据的载体，相当一个Dto 必须是 {@link Authentication} 实现类
 */
@Getter
@Setter
public class AppleAuthentication extends AbstractAuthenticationToken {

    // 苹果identity token (JWT)
    private String identityToken;

    // 苹果authorization code
    private String authorizationCode;

    // 用户信息
    private Users users;

    // 苹果用户信息
    private AppleUserInfo appleUserInfo;

    public AppleAuthentication() {
        // 权限，用不上，直接null
        super(null);
    }

    /**
     * 根据SpringSecurity的设计，授权成功之前，getPrincipal返回的客户端传过来的数据。授权成功后，返回当前登陆用户的信息
     *
     * @return
     */
    @Override
    public Object getPrincipal() {
        return isAuthenticated() ? users : identityToken;
    }

    /**
     * 根据SpringSecurity的设计，授权成功后，Credential（比如，登录密码）信息需要被清空
     *
     * @return 凭证信息
     */
    @Override
    public Object getCredentials() {
        return isAuthenticated() ? null : authorizationCode;
    }

    /**
     * 苹果用户信息类
     */
    @Getter
    @Setter
    public static class AppleUserInfo {
        private String userId;
        private String email;
        private String fullName;
        private boolean emailVerified;
        private Long authTime;
        private Integer realUserStatus;

        public AppleUserInfo(String userId, String email, String fullName, boolean emailVerified,
                           Long authTime, Integer realUserStatus) {
            this.userId = userId;
            this.email = email;
            this.fullName = fullName;
            this.emailVerified = emailVerified;
            this.authTime = authTime;
            this.realUserStatus = realUserStatus;
        }
    }
}