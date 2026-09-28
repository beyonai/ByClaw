package com.iwhalecloud.byai.manager.security.login.wechatphone;

import com.fasterxml.jackson.core.JsonParser;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.authentication.AbstractAuthenticationProcessingFilter;
import org.springframework.security.web.authentication.AuthenticationFailureHandler;
import org.springframework.security.web.authentication.AuthenticationSuccessHandler;
import org.springframework.security.web.util.matcher.RequestMatcher;

public class WechatPhoneAuthenticationFilter extends AbstractAuthenticationProcessingFilter {

    private static final int MAX_REQUEST_BYTES = 2048;
    private final ObjectMapper mapper = new ObjectMapper()
        .enable(JsonParser.Feature.STRICT_DUPLICATE_DETECTION)
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private final WechatPhoneLoginRateLimiter rateLimiter;

    public WechatPhoneAuthenticationFilter(RequestMatcher matcher, AuthenticationManager manager,
        AuthenticationSuccessHandler success, AuthenticationFailureHandler failure,
        WechatPhoneLoginRateLimiter rateLimiter) {
        super(matcher);
        this.rateLimiter = rateLimiter;
        setAuthenticationManager(manager);
        setAuthenticationSuccessHandler(success);
        setAuthenticationFailureHandler(failure);
    }

    @Override
    public Authentication attemptAuthentication(HttpServletRequest request, HttpServletResponse response)
        throws AuthenticationException {
        String contentType = request.getContentType();
        if (!"POST".equals(request.getMethod()) || contentType == null) {
            throw new BadCredentialsException("微信手机号授权请求无效");
        }
        try {
            if (!MediaType.APPLICATION_JSON.isCompatibleWith(MediaType.parseMediaType(contentType))) {
                throw new BadCredentialsException("微信手机号授权请求无效");
            }
            byte[] body = request.getInputStream().readNBytes(MAX_REQUEST_BYTES + 1);
            if (body.length > MAX_REQUEST_BYTES) {
                throw new BadCredentialsException("微信手机号授权请求无效");
            }
            JsonNode root = mapper.readTree(body);
            // 公共请求层会附带 language；除此之外不接受客户端自报的身份字段。
            if (root == null || !root.isObject() || root.size() > 2
                || (root.size() == 2 && !root.has("language"))) {
                throw new BadCredentialsException("微信手机号授权请求无效");
            }
            JsonNode code = root.get("phoneCode");
            JsonNode language = root.get("language");
            if (code == null || !code.isTextual() || code.textValue().isBlank()
                || code.textValue().length() > 512
                || (language != null && (!language.isTextual() || language.textValue().isBlank()
                    || language.textValue().length() > 32))) {
                throw new BadCredentialsException("微信手机号授权请求无效");
            }
            // 只使用连接地址，避免未经网关净化的转发头绕过匿名入口限流。
            rateLimiter.check(request.getRemoteAddr());
            return getAuthenticationManager().authenticate(new WechatPhoneAuthentication(code.textValue()));
        } catch (IOException | IllegalArgumentException e) {
            throw new BadCredentialsException("微信手机号授权请求无效");
        }
    }
}
