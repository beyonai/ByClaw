package com.iwhalecloud.byai.common.constants.login;

/**
 * @author he.duming
 * @date 2025-06-06 00:01:00
 * @description 登陆拦截的类型
 */
public final class FilterType {

    private FilterType() {
    }

    /**
     * jwt请求
     */
    public static final String JWT_FILTER = "JwtFilter";

    /**
     * 共享session的方式
     */
    public static final String SESSION_FILTER = "SessionFilter";

    /**
     * 用户名+密码请求
     */
    public static final String PASSWD_TOKEN_FILTER = "PasswdTokenFilter";

    /**
     * 令牌认证
     */
    public static final String ACCESS_TOKEN_FILTER = "AccessTokenFilter";

    /**
     * 鲸加登陆认证
     */
    public static final String SSO_TOKEN_FILTER = "SsoTokenFilter";

}
