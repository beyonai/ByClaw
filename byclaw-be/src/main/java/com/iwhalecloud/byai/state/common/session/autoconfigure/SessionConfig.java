package com.iwhalecloud.byai.state.common.session.autoconfigure;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;

/**
 * 会话配置类
 * 提供自定义的 Cookie 序列化器
 */
@Configuration
public class SessionConfig {

    @Value("${server.session.cookie.name:SESSION}")
    private String cookieName;

    @Value("${server.session.cookie.path:/}")
    private String cookiePath;

    @Value("${server.session.cookie.domain:}")
    private String cookieDomain;

    @Value("${server.session.cookie.max-age:86400}")
    private Integer cookieMaxAge;

    @Value("${server.session.cookie.http-only:true}")
    private Boolean cookieHttpOnly;

    @Value("${server.session.cookie.secure:false}")
    private Boolean cookieSecure;

    @Value("${server.session.cookie.same-site:}")
    private String cookieSameSite;

    @Value("${server.session.cookie.encoding:false}")
    private Boolean useBase64Encoding;

    /**
     * 自定义 Cookie 序列化器，用于会话 ID 的持久化
     */
    @Bean
    public CookieSerializer cookieSerializer() {
        DefaultCookieSerializer serializer = new DefaultCookieSerializer();
        serializer.setCookieName(cookieName);
        serializer.setCookiePath(cookiePath);
        
        if (cookieDomain != null && !cookieDomain.isEmpty()) {
            serializer.setDomainName(cookieDomain);
        }
        
        serializer.setCookieMaxAge(cookieMaxAge);
        serializer.setUseHttpOnlyCookie(cookieHttpOnly);
        serializer.setUseSecureCookie(cookieSecure);
        serializer.setUseBase64Encoding(useBase64Encoding);

        if (cookieSameSite != null && !cookieSameSite.isEmpty()) {
            serializer.setSameSite(cookieSameSite);
        }
        
        return serializer;
    }
} 