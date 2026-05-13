package com.iwhalecloud.byai.manager.security.login.phone;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.crypto.codec.Base64;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.ecrypt.AesUtils;
import com.iwhalecloud.byai.common.login.bean.LoginForm;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 用户名密码登录 AbstractAuthenticationProcessingFilter 的实现类要做的工作：
 */
public class PhoneAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

    private static final Logger logger = LoggerFactory.getLogger(PhoneAuthenticationFilter.class);

    public PhoneAuthenticationFilter(RequestMatcher pathRequestMatcher,
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

        logger.debug("use PhoneAuthenticationFilter");

        // 提取请求数据
        LoginForm loginForm = this.obtainLoginForm(request);

        String phone = loginForm.getPhone();
        String verifyCode = loginForm.getVerifyCode();
        phone = this.decodeUserName(phone);
        // 封装成Spring Security需要的对象
        PhoneAuthentication authentication = new PhoneAuthentication();
        authentication.setPhone(phone);
        authentication.setVerifyCode(verifyCode);
        authentication.setAuthenticated(false);

        // 开始登录认证。SpringSecurity会利用 Authentication对象去寻找 AuthenticationProvider进行登录认证
        return getAuthenticationManager().authenticate(authentication);
    }

    /**
     * 获取表单参数
     *
     * @return LoginForm
     */
    private LoginForm obtainLoginForm(HttpServletRequest request) {

        ServletServerHttpRequest serverRequest = new ServletServerHttpRequest(request);
        HttpHeaders headers = serverRequest.getHeaders();

        // 尝试从body中读取
        if (headers.getContentType() != null && headers.getContentType().isCompatibleWith(MediaType.APPLICATION_JSON)) {
            try {
                ObjectMapper objectMapper = new ObjectMapper();
                return objectMapper.readValue(request.getInputStream(), LoginForm.class);
            }
            catch (Exception e) {
                logger.error(e.getMessage(), e);
            }
        }

        // 从表单中读取
        LoginForm loginForm = new LoginForm();
        loginForm.setPhone(request.getParameter("phone"));
        loginForm.setVerifyCode(request.getParameter("verifyCode"));
        return loginForm;
    }

    /***
     * 解密用户名
     *
     * @param accountCode 账号
     * @return String
     */
    private String decodeUserName(String accountCode) {
        try {
            byte[] key = AesUtils.AES_KEY.getBytes(StandardCharsets.UTF_8);
            byte[] enbytes = Base64.decode(accountCode.getBytes(StandardCharsets.UTF_8));
            return new String(AesUtils.decrypt(new String(enbytes, StandardCharsets.UTF_8), key),
                StandardCharsets.UTF_8);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return null;
    }

}
