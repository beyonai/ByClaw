package com.iwhalecloud.byai.manager.security.login.iwhale;

import java.io.IOException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 用户名密码登录 AbstractAuthenticationProcessingFilter 的实现类要做的工作：
 */
public class IwhaleAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

    private static final Logger logger = LoggerFactory.getLogger(IwhaleAuthenticationFilter.class);

    public IwhaleAuthenticationFilter(RequestMatcher pathRequestMatcher,
        AuthenticationManager authenticationManager, AuthenticationSuccessHandler authenticationSuccessHandler,
        AuthenticationFailureHandler authenticationFailureHandler) {
        super(pathRequestMatcher);
        setAuthenticationManager(authenticationManager);
        setAuthenticationSuccessHandler(authenticationSuccessHandler);
        setAuthenticationFailureHandler(authenticationFailureHandler);
    }

    /**
     * 认证信息获取
     * 
     * @param request 请求
     * @param response 响应
     * @return 返回
     * @throws AuthenticationException 认证异常
     * @throws IOException IO异常
     * @throws ServletException Servlet异常
     */
    @Override
    public Authentication attemptAuthentication(HttpServletRequest request, HttpServletResponse response)
        throws AuthenticationException, IOException, ServletException {

        String code = request.getParameter("code");

        logger.info("鲸登陆验证码:{}", code);

        // 封装成Spring Security需要的对象
        IwhaleAuthentication authentication = new IwhaleAuthentication();
        authentication.setCode(code);
        authentication.setAuthenticated(false);

        // 开始登录认证。SpringSecurity会利用 Authentication对象去寻找 AuthenticationProvider进行登录认证
        return getAuthenticationManager().authenticate(authentication);
    }

}
