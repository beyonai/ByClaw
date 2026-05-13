package com.iwhalecloud.byai.state.common.filter;

import com.alibaba.fastjson2.JSON;
import com.alibaba.fastjson2.JSONObject;
import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.springframework.stereotype.Component;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.common.filter.request.RequestWrapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 全局国际化过滤器，保证所有请求都能正确设置 Locale
 */
@Component
public class GlobalI18nFilter extends OncePerRequestFilter {

    /***
     * 国限流
     * 
     * @param request 请求
     * @param response 响应
     * @param filterChain 拦截器链
     * @throws ServletException ServletException异常
     * @throws IOException IOException异常
     */
    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
        throws ServletException, IOException {
        HttpServletRequest currentRequest = wrapRequestIfNeeded(request);

        // 1.优先header
        String language = currentRequest.getHeader(I18nUtil.LANGUAGE);
        if (StringUtil.isEmpty(language)) {
            language = currentRequest.getHeader("x-language");
        }

        // 2. 从 parameter 获取
        if (StringUtil.isEmpty(language)) {
            language = currentRequest.getParameter(I18nUtil.LANGUAGE);
        }

        // 3. JSON POST 从 body 获取
        if (StringUtil.isEmpty(language)) {
            language = resolveLanguageFromBody(currentRequest);
        }

        // 4. 最后从 attribute 获取
        if (StringUtil.isEmpty(language)) {
            language = resolveLanguage(currentRequest.getAttribute(I18nUtil.LANGUAGE));
        }

        if (StringUtil.isEmpty(language)) {
            language = I18nUtil.CHINSES;
        }

        currentRequest.setAttribute(I18nUtil.LANGUAGE, I18nUtil.getLanguage(language));

        // 设置语言环境
        I18nUtil.setLocale(language);

        filterChain.doFilter(currentRequest, response);
    }

    private HttpServletRequest wrapRequestIfNeeded(HttpServletRequest request) throws IOException {
        if (!"POST".equalsIgnoreCase(request.getMethod()) || !isJsonRequest(request)) {
            return request;
        }
        if (request instanceof RequestWrapper) {
            return request;
        }
        return new RequestWrapper(request);
    }

    private String resolveLanguageFromBody(HttpServletRequest request) {
        if (!isJsonRequest(request)) {
            return null;
        }
        try {
            byte[] body = request.getInputStream().readAllBytes();
            if (body.length == 0) {
                return null;
            }
            JSONObject jsonObject = JSON.parseObject(new String(body, resolveCharset(request)));
            return jsonObject == null ? null : jsonObject.getString(I18nUtil.LANGUAGE);
        }
        catch (Exception e) {
            return null;
        }
    }

    private boolean isJsonRequest(HttpServletRequest request) {
        String contentType = request.getContentType();
        return StringUtil.isNotEmpty(contentType)
            && contentType.toLowerCase().contains(MediaType.APPLICATION_JSON_VALUE);
    }

    private Charset resolveCharset(HttpServletRequest request) {
        String encoding = request.getCharacterEncoding();
        if (StringUtil.isEmpty(encoding)) {
            return StandardCharsets.UTF_8;
        }
        try {
            return Charset.forName(encoding);
        }
        catch (Exception e) {
            return StandardCharsets.UTF_8;
        }
    }

    private String resolveLanguage(Object language) {
        if (language == null) {
            return null;
        }
        if (language instanceof Locale locale) {
            return locale.toString();
        }
        return language.toString();
    }
}
