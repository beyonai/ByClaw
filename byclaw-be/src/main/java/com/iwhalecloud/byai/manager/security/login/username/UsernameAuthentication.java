package com.iwhalecloud.byai.manager.security.login.username;

import com.iwhalecloud.byai.manager.entity.users.Users;
import lombok.Getter;
import lombok.Setter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.Authentication;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description SpringSecurity传输登录认证的数据的载体，相当一个Dto 必须是 {@link Authentication} 实现类
 */

@Getter
@Setter
public class UsernameAuthentication extends AbstractAuthenticationToken {

    private String accountCode;

    private String accountPwd;

    private Users users;

    public UsernameAuthentication() {
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
        return isAuthenticated() ? users : accountCode;
    }

    /**
     * 根据SpringSecurity的设计，授权成后，Credential（比如，登录密码）信息需要被清空
     *
     * @return 密码信息
     */
    @Override
    public Object getCredentials() {
        return isAuthenticated() ? null : accountPwd;
    }

}
