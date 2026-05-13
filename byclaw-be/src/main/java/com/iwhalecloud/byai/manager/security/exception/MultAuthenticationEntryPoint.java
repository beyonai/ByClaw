package com.iwhalecloud.byai.manager.security.exception;

import java.io.IOException;

import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 登陆认证失败时，会执行这个方法。将失败原因告知客户端
 */
@Component
public class MultAuthenticationEntryPoint implements AuthenticationEntryPoint {

    /**
     * 未登陆拒绝访问
     *
     * @param request 请求
     * @param response 响应
     * @param authException 授权
     * @throws IOException IOException异常
     */
    @Override
    public void commence(HttpServletRequest request, HttpServletResponse response,
        AuthenticationException authException) throws IOException {
        response.sendError(HttpServletResponse.SC_FORBIDDEN, "Access Denied");
        response.setContentType("application/json");
        ResponseUtil responseUtil = ResponseUtil.fail(I18nUtil.get("auth.access.denied.not.logged.in"));
        response.getWriter().append(JSON.toJSONString(responseUtil));
    }

}
