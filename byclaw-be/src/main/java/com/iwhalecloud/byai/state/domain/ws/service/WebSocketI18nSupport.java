package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.Locale;
import java.util.Map;

import org.apache.commons.lang3.StringUtils;
import org.springframework.context.i18n.LocaleContextHolder;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;

public final class WebSocketI18nSupport {

    public static final String DEFAULT_LANGUAGE = "zh-CN";

    private WebSocketI18nSupport() {
    }

    public static String applyLocale(String messageLanguage, LoginInfo userInfo) {
        String language = resolveLanguage(messageLanguage, userInfo);
        I18nUtil.setLocale(language);
        return language;
    }

    public static String applyLocale(LoginInfo userInfo) {
        return applyLocale(null, userInfo);
    }

    public static String resolveLanguage(String messageLanguage, LoginInfo userInfo) {
        String resolved = StringUtils.trimToNull(messageLanguage);
        if (resolved != null) {
            return resolved;
        }

        resolved = resolveUserLanguage(userInfo);
        if (resolved != null) {
            return resolved;
        }

        resolved = resolveSystemLanguage();
        return resolved == null ? DEFAULT_LANGUAGE : resolved;
    }

    private static String resolveUserLanguage(LoginInfo userInfo) {
        if (userInfo == null || userInfo.getParamMap() == null || userInfo.getParamMap().isEmpty()) {
            return null;
        }
        Map<String, String> params = userInfo.getParamMap();
        String language = StringUtils.trimToNull(params.get(I18nUtil.LANGUAGE));
        if (language == null) {
            language = StringUtils.trimToNull(params.get("x-language"));
        }
        return language;
    }

    private static String resolveSystemLanguage() {
        Locale locale = LocaleContextHolder.getLocale();
        if (locale == null || Locale.ROOT.equals(locale)) {
            locale = Locale.getDefault();
        }
        if (locale == null || Locale.ROOT.equals(locale)) {
            return null;
        }
        String language = StringUtils.trimToNull(locale.toLanguageTag());
        if ("und".equalsIgnoreCase(language)) {
            return null;
        }
        return language;
    }
}
