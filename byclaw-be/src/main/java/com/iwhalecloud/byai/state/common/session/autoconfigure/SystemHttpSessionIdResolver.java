package com.iwhalecloud.byai.state.common.session.autoconfigure;

import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.List;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.session.web.http.CookieHttpSessionIdResolver;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.HttpSessionIdResolver;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson.JSONObject;
import com.alibaba.ttl.TransmittableThreadLocal;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
public class SystemHttpSessionIdResolver implements HttpSessionIdResolver {
    private static final String WRITTEN_SESSION_ID_ATTR = CookieHttpSessionIdResolver.class.getName()
        .concat(".WRITTEN_SESSION_ID_ATTR");

    @Autowired
    private CookieSerializer cookieSerializer;

    protected final Logger logger = LoggerFactory.getLogger(this.getClass());

    private TransmittableThreadLocal<String> httpSessionIdResolverThreadLocal = new TransmittableThreadLocal<>();

    @Value("${server.session.header.name:x-signature-sessionId}")
    private String headerSessionName;

    @Value("${server.session.cookie.name:SESSION}")
    private String cookieName;

    @Value("${server.session.cookie.encoding:false}")
    private Boolean useBase64Encoding;

    @Value("${server.session.cookie.route:''}")
    private String jvmRoute;

    @Override
    public List<String> resolveSessionIds(HttpServletRequest request) {
        String sessionId = request.getHeader(headerSessionName);
        if (StringUtils.isBlank(sessionId)) {
            httpSessionIdResolverThreadLocal.set("CookieHttpSessionIdResolver");
            List<String> sessionIdList = readCookieValues(request);
            logger.debug("CookieHttpSessionIdResolver获取到的sessionId为|{}|", JSONObject.toJSONString(sessionIdList));
            return sessionIdList;
        }
        httpSessionIdResolverThreadLocal.set("HeaderHttpSessionIdResolver");
        logger.debug("HeaderHttpSessionIdResolver获取到的sessionId为|{}|", sessionId);
        return Collections.singletonList(sessionId);
    }

    @Override
    public void setSessionId(HttpServletRequest request, HttpServletResponse response, String sessionId) {
        if (StringUtils.equals(httpSessionIdResolverThreadLocal.get(), "CookieHttpSessionIdResolver")) {
            if (!sessionId.equals(request.getAttribute(WRITTEN_SESSION_ID_ATTR))) {
                request.setAttribute(WRITTEN_SESSION_ID_ATTR, sessionId);
                this.cookieSerializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, sessionId));
            }
        }
        else {
            response.setHeader(headerSessionName, sessionId);
        }
    }

    @Override
    public void expireSession(HttpServletRequest request, HttpServletResponse response) {
        if (StringUtils.equals(httpSessionIdResolverThreadLocal.get(), "CookieHttpSessionIdResolver")) {
            this.cookieSerializer.writeCookieValue(new CookieSerializer.CookieValue(request, response, ""));
        }
        else {
            response.setHeader(headerSessionName, "");
        }

    }

    private List<String> readCookieValues(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        List<String> matchingCookieValues = new ArrayList<>();
        if (cookies != null) {
            Cookie[] var4;
            var4 = cookies;
            int var5 = cookies.length;

            for (int var6 = 0; var6 < var5; ++var6) {
                Cookie cookie = var4[var6];
                if (this.cookieName.equals(cookie.getName())) {
                    String sessionId = this.useBase64Encoding ? this.base64Decode(cookie.getValue())
                        : cookie.getValue();
                    if (sessionId != null) {
                        if (this.jvmRoute != null && sessionId.endsWith(this.jvmRoute)) {
                            sessionId = sessionId.substring(0, sessionId.length() - this.jvmRoute.length());
                        }

                        matchingCookieValues.add(sessionId);
                    }
                }
            }
        }

        return matchingCookieValues;
    }

    private String base64Decode(String base64Value) {
        try {
            byte[] decodedCookieBytes = Base64.getDecoder().decode(base64Value);
            return new String(decodedCookieBytes, "UTF-8");
        }
        catch (Exception var3) {
            logger.debug("Unable to Base64 decode value: " + base64Value);
            return null;
        }
    }

}
