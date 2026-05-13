package com.iwhalecloud.byai.manager.security.exception;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.IOException;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 认证成功(Authentication), 但无权访问时。会执行这个方法
 */

@Component
public class MultAccessDeniedExceptionHandler implements AccessDeniedHandler {

    private static final Logger logger = LoggerFactory.getLogger(MultAccessDeniedExceptionHandler.class);


    @Override
    public void handle(HttpServletRequest request, HttpServletResponse response,

        AccessDeniedException accessDeniedException) throws IOException {

        logger.error("拒绝当前用户访问资源:{},详情:{}", request.getRequestURI(), accessDeniedException);

        // 返回状态401
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        response.getWriter().write(JSON.toJSONString(LoginResponse.fail(I18nUtil.get("login.request.denied"))));
    }
}
