package com.iwhalecloud.byai.manager.security.login.sso;

import java.io.IOException;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
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
public class SSOAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

    private static final Logger logger = LoggerFactory.getLogger(SSOAuthenticationFilter.class);

    public SSOAuthenticationFilter(RequestMatcher pathRequestMatcher,
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

        logger.debug("use UsernameAuthenticationFilter");

        // 提取请求数据
        String systemCode = request.getParameter("systemCode");
        String beyondToken = request.getParameter("beyondToken");
        if (StringUtil.isEmpty(beyondToken)) {
            throw new BadCredentialsException(I18nUtil.get("login.ssotoken.notnull"));
        }

        // 封装成Spring Security需要的对象
        SSOAuthentication ssoAuthentication = new SSOAuthentication();
        ssoAuthentication.setSystemCode(systemCode);
        ssoAuthentication.setBeyondToken(beyondToken);
        ssoAuthentication.setAuthenticated(false);

        // 开始登录认证。SpringSecurity会利用 Authentication对象去寻找 AuthenticationProvider进行登录认证
        return getAuthenticationManager().authenticate(ssoAuthentication);
    }

}
