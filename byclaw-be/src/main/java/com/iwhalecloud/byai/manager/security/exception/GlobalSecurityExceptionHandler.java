package com.iwhalecloud.byai.manager.security.exception;

import java.io.IOException;
import java.io.PrintWriter;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * @author he.duming
 * @date 2025-05-02 14:12:45
 * @description 捕捉Spring security filter chain 中抛出的未知异常
 */
@Component
public class GlobalSecurityExceptionHandler extends OncePerRequestFilter {

    public static final Logger logger = LoggerFactory.getLogger(GlobalSecurityExceptionHandler.class);

    @Override
    public void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {

        try {
            filterChain.doFilter(request, response);
        }
        catch (BaseException e) {
            logger.error(e.getMessage(), e);

            // 自定义异常
            ResponseUtil responseUtil = ResponseUtil.fail(e.getMessage());
            response.setContentType(MediaType.APPLICATION_JSON_UTF8_VALUE);
            PrintWriter writer = response.getWriter();
            writer.write(JSON.toJSONString(responseUtil));
            writer.flush();
            writer.close();
        }
        catch (AuthenticationException | AccessDeniedException e) {
            logger.error(e.getMessage(), e);
            ResponseUtil responseUtil = ResponseUtil.fail(e.getMessage());
            response.setContentType(MediaType.APPLICATION_JSON_UTF8_VALUE);
            response.setStatus(HttpStatus.FORBIDDEN.value());
            PrintWriter writer = response.getWriter();
            writer.print(JSON.toJSONString(responseUtil));
            writer.flush();
            writer.close();
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            // 未知异常

            ResponseUtil responseUtil = ResponseUtil.fail("system error:" + e.getMessage());
            response.setContentType(MediaType.APPLICATION_JSON_UTF8_VALUE);
            response.setStatus(HttpStatus.INTERNAL_SERVER_ERROR.value());
            PrintWriter writer = response.getWriter();
            writer.write(JSON.toJSONString(responseUtil));
            writer.flush();
            writer.close();
        }
    }
}
