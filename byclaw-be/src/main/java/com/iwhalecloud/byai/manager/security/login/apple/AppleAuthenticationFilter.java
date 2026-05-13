package com.iwhalecloud.byai.manager.security.login.apple;

import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;

import java.io.IOException;

/**
 * @description 苹果登录过滤器
 * 处理苹果登录请求的过滤器
 */
public class AppleAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

    private static final Logger logger = LoggerFactory.getLogger(AppleAuthenticationFilter.class);

    public AppleAuthenticationFilter(RequestMatcher pathRequestMatcher,
                                     AuthenticationManager authenticationManager,
                                     AuthenticationSuccessHandler authenticationSuccessHandler,
                                     AuthenticationFailureHandler authenticationFailureHandler) {
        super(pathRequestMatcher);
        setAuthenticationManager(authenticationManager);
        setAuthenticationSuccessHandler(authenticationSuccessHandler);
        setAuthenticationFailureHandler(authenticationFailureHandler);
    }

    /**
     * 从请求中获取认证信息
     *
     * @param request 请求
     * @param response 响应
     * @return 返回认证对象
     * @throws AuthenticationException 认证异常
     * @throws IOException IO异常
     * @throws ServletException Servlet异常
     */
    @Override
    public Authentication attemptAuthentication(HttpServletRequest request, HttpServletResponse response)
        throws AuthenticationException, IOException, ServletException {

        // 从请求参数中获取苹果登录信息
        String identityToken = request.getParameter("identityToken");
        String authorizationCode = request.getParameter("authorizationCode");

        logger.info("苹果登录identityToken:{}, authorizationCode:{}", identityToken, authorizationCode);

        // 验证必要参数
        if (identityToken == null || identityToken.trim().isEmpty()) {
            throw new AuthenticationException("苹果identityToken不能为空") { };
        }

        // 封装成Spring Security需要的对象
        AppleAuthentication authentication = new AppleAuthentication();
        authentication.setIdentityToken(identityToken);
        authentication.setAuthorizationCode(authorizationCode);
        authentication.setAuthenticated(false);

        // 开始登录认证。SpringSecurity会利用 Authentication对象去寻找 AuthenticationProvider进行登录认证
        return getAuthenticationManager().authenticate(authentication);
    }
}