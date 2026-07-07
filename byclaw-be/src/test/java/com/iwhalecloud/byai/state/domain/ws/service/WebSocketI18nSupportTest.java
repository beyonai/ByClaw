package com.iwhalecloud.byai.state.domain.ws.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;

class WebSocketI18nSupportTest {

    @AfterEach
    void tearDown() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void resolveLanguageUsesMessageBeforeUserLanguage() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.getParamMap().put("language", "zh-CN");

        assertThat(WebSocketI18nSupport.resolveLanguage("en-US", loginInfo)).isEqualTo("en-US");
    }

    @Test
    void resolveLanguageUsesUserBeforeSystemLanguage() {
        LocaleContextHolder.setLocale(Locale.US);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.getParamMap().put("language", "zh-CN");

        assertThat(WebSocketI18nSupport.resolveLanguage(null, loginInfo)).isEqualTo("zh-CN");
    }

    @Test
    void resolveLanguageUsesSystemBeforeDefaultLanguage() {
        LocaleContextHolder.setLocale(Locale.US);

        assertThat(WebSocketI18nSupport.resolveLanguage(null, null)).isEqualTo("en-US");
    }

    @Test
    void resolveLanguageFallsBackToDefaultLanguage() {
        LocaleContextHolder.setLocale(Locale.ROOT);
        Locale originalDefault = Locale.getDefault();
        Locale.setDefault(Locale.ROOT);
        try {
            assertThat(WebSocketI18nSupport.resolveLanguage(null, null)).isEqualTo("zh-CN");
        }
        finally {
            Locale.setDefault(originalDefault);
        }
    }
}
