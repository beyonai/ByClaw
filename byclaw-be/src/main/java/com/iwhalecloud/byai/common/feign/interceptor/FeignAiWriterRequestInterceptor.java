package com.iwhalecloud.byai.common.feign.interceptor;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Arrays;
import java.util.List;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import feign.RequestTemplate;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;

/**
 * 局部配置，公共配置，使用用户名密码，不加cookie
 */
@Slf4j
public class FeignAiWriterRequestInterceptor extends AbstractFeignRequestInterceptor {

    private static final Logger logger = LoggerFactory.getLogger(FeignAiWriterRequestInterceptor.class);


    @Autowired
    private JwtService jwtService;

    @Override
    protected void doIntercept(RequestTemplate requestTemplate) {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        logger.info("=============Start preparing the request headers for adding feign requests==================");
        header(requestTemplate, attributes);
    }

    private void header(RequestTemplate requestTemplate, ServletRequestAttributes attributes) {
        if (attributes != null) {
            HttpServletRequest request = attributes.getRequest();

            // 添加Cookie（复用FeignCommonRequestInterceptor的逻辑）
            addCookie(requestTemplate, request);

            // 添加签名相关的请求头，进行空值校验避免空指针异常
            addHeadersIfPresent(requestTemplate, request, getSignatureHeaders());

        }
        else {
            // 适配netty
             LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
            requestTemplate.header("beyond-token", jwtService.createJwt(loginInfo));
        }
    }

    /**
     * 获取需要添加的签名相关请求头名称列表
     *
     * @return 请求头名称列表
     */
    private List<String> getSignatureHeaders() {
        return Arrays.asList("x-signature-sessionid", "x-signature-appkey", "sso-token", "beyond-token",
            "x-signature-nonce", "x-signature-timestamp", "x-signature-value", "language", "x-language");
    }

    /**
     * 批量添加请求头（如果存在） 从请求中获取指定的请求头，如果存在则添加到请求模板中
     *
     * @param requestTemplate Feign请求模板
     * @param request HTTP请求对象
     * @param headerNames 需要添加的请求头名称列表
     */
    private void addHeadersIfPresent(RequestTemplate requestTemplate, HttpServletRequest request,
        List<String> headerNames) {
        for (String headerName : headerNames) {
            String headerValue = request.getHeader(headerName);
            if (headerValue != null) {
                requestTemplate.header(headerName, headerValue);
            }
        }
    }

}
