package com.iwhalecloud.byai.common.jwt;

import java.util.Collection;

import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.GrantedAuthority;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class JwtAuthentication extends AbstractAuthenticationToken {

    private String jwtToken;

    /**
     * 认证信息
     */
    public JwtAuthentication() {
        super(null);
    }

    /**
     * 认证信息和权限信息
     * 
     * @param authorities 权限俗话上
     */
    public JwtAuthentication(Collection<? extends GrantedAuthority> authorities) {
        super(authorities);
    }

    /**
     * 根据SpringSecurity的设计，授权成功之前，getPrincipal返回的客户端传过来的数据。授权成功后，返回当前登陆用户的信息
     * 
     * @return Object 认证信息
     */
    @Override
    public Object getPrincipal() {
        return isAuthenticated() ? null : jwtToken;
    }

    /**
     * 根据SpringSecurity的设计，授权成后，Credential（比如，登录密码）信息需要被清空l
     *
     * @return Object
     */
    @Override
    public Object getCredentials() {
        return isAuthenticated() ? null : jwtToken;
    }

}
