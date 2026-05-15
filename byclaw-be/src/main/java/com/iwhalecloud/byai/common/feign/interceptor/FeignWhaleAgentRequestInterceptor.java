package com.iwhalecloud.byai.common.feign.interceptor;

import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

import feign.RequestTemplate;
import jakarta.servlet.http.HttpServletRequest;

public class FeignWhaleAgentRequestInterceptor extends AbstractFeignRequestInterceptor {

    @Autowired
    private JwtService jwtService;

    @Override
    protected void doIntercept(RequestTemplate requestTemplate) {
        ServletRequestAttributes attributes = (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        if (attributes != null) {
            HttpServletRequest request = attributes.getRequest();
            addCookie(requestTemplate, request);
            addHeadersIfPresent(requestTemplate, request, getSignatureHeaders());
        }

        ensureBeyondToken(requestTemplate);
        addHeaderIfAbsent(requestTemplate, "System-Code", "BYAI");
    }

    private Map<String, Object> buildJwtPayload(String userCode) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("userCode", userCode);
        return payload;
    }

    private List<String> getSignatureHeaders() {
        return Arrays.asList("x-signature-sessionid", "x-signature-appkey", "sso-token", "beyond-token",
            "x-signature-nonce", "x-signature-timestamp", "x-signature-value", "language", "x-language");
    }

    private void addHeadersIfPresent(RequestTemplate requestTemplate, HttpServletRequest request, List<String> headerNames) {
        for (String headerName : headerNames) {
            String headerValue = request.getHeader(headerName);
            if (headerValue != null) {
                requestTemplate.header(headerName, headerValue);
            }
        }
    }

    private void ensureBeyondToken(RequestTemplate requestTemplate) {
        if (hasHeaderValue(requestTemplate, "Beyond-Token")) {
            return;
        }

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo != null) {
            requestTemplate.header("Beyond-Token", jwtService.createJwt(loginInfo));
            return;
        }

        String userCode = StringUtils.trimToEmpty(WhaleAgentUserContextHolder.getUserCode());
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalStateException("WhaleAgent request userCode is required when loginInfo is absent");
        }
        requestTemplate.header("Beyond-Token", jwtService.createJwt(buildJwtPayload(userCode)));
    }

    private void addHeaderIfAbsent(RequestTemplate requestTemplate, String headerName, String headerValue) {
        if (!hasHeaderValue(requestTemplate, headerName)) {
            requestTemplate.header(headerName, headerValue);
        }
    }

    private boolean hasHeaderValue(RequestTemplate requestTemplate, String headerName) {
        for (Map.Entry<String, Collection<String>> entry : requestTemplate.headers().entrySet()) {
            if (!StringUtils.equalsIgnoreCase(entry.getKey(), headerName)) {
                continue;
            }
            Collection<String> values = entry.getValue();
            if (values == null) {
                continue;
            }
            for (String value : values) {
                if (StringUtils.isNotBlank(value)) {
                    return true;
                }
            }
        }
        return false;
    }
}
