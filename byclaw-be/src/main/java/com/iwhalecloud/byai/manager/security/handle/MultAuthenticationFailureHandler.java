package com.iwhalecloud.byai.manager.security.handle;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

import com.iwhalecloud.byai.manager.application.service.log.LoginLogApplicationService;
import com.iwhalecloud.byai.manager.security.exception.bean.AppleUserBindRequiredException;
import com.iwhalecloud.byai.manager.security.exception.bean.LoginAuthenticationException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.stereotype.Component;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/***
 * 认证失败处理类
 */
@Component
public class MultAuthenticationFailureHandler implements AuthenticationFailureHandler {

    @Autowired
    private LoginLogApplicationService loginLogApplicationService;

    /**
     * @param request 请求
     * @param response 响应
     * @param exception 异常
     * @throws IOException 异常信息
     * @throws ServletException 异常
     */

    @Override
    public void onAuthenticationFailure(HttpServletRequest request, HttpServletResponse response,
        AuthenticationException exception) throws IOException, ServletException {

        // 如果是抛出正定义的登陆异常，记录错误日志
        if (exception instanceof LoginAuthenticationException) {
            LoginAuthenticationException loginAuthenticationException = (LoginAuthenticationException) exception;
            Long userId = loginAuthenticationException.getUserId();
            String loginType = loginAuthenticationException.getLoginType();
            loginLogApplicationService.saveFailLog(request, userId, loginType, exception.getMessage());
        }

        Object responseData;

        // 处理苹果用户需要绑定的异常
        if (exception instanceof AppleUserBindRequiredException) {
            AppleUserBindRequiredException appleBindException = (AppleUserBindRequiredException) exception;
            Map<String, Object> bindResponse = new HashMap<>();
            bindResponse.put("code", AppleUserBindRequiredException.APPLE_BIND_REQUIRED_CODE);
            bindResponse.put("msg", exception.getMessage());
            bindResponse.put("appleUserId", appleBindException.getAppleUserId());
            bindResponse.put("appleEmail", appleBindException.getAppleEmail());
            bindResponse.put("bindToken", appleBindException.getBindToken());
            bindResponse.put("bindRequired", true);
            responseData = bindResponse;
        }
        else {
            // 登陆失败响应信息
            responseData = LoginResponse
                    .fail(I18nUtil.get("login.login.auth.fail") + exception.getMessage());
        }

        response.setHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE);
        ServletOutputStream outputStream = response.getOutputStream();
        ObjectMapper objectMapper = new ObjectMapper();
        objectMapper.writeValue(outputStream, responseData);
        outputStream.flush();
    }

}
