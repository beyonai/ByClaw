package com.iwhalecloud.byai.state.infrastructure.utils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.assertj.core.api.Assertions.assertThat;

class ChatUtilsTest {

    @BeforeEach
    void setUp() {
        RequestContextHolder.resetRequestAttributes();
        LocaleContextHolder.resetLocaleContext();
    }

    @AfterEach
    void tearDown() {
        RequestContextHolder.resetRequestAttributes();
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void getLanguage_returnsRequestAttributeWhenPresent() {
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(I18nUtil.LANGUAGE, "en-US");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(ChatUtils.getLanguage()).isEqualTo("en-US");
    }

    @Test
    void getLanguage_returnsRequestAttributeForPostRequestWhenHeaderMissing() {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/chat/superAgentChat");
        request.setAttribute(I18nUtil.LANGUAGE, "en-US");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

        assertThat(ChatUtils.getLanguage()).isEqualTo("en-US");
    }

    @Test
    void getLanguage_returnsLocaleContextWhenAttributeMissing() {
        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/chat/superAgentChat");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        LocaleContextHolder.setLocale(Locale.US);

        assertThat(ChatUtils.getLanguage()).isEqualTo("en_US");
    }

    @Test
    void getLanguage_returnsLocaleContextWithoutHttpRequest() {
        LocaleContextHolder.setLocale(Locale.US);

        assertThat(ChatUtils.getLanguage()).isEqualTo("en_US");
    }

    @Test
    void getLanguage_returnsDefaultLocaleWithoutRequestOrExplicitLocale() {
        assertThat(ChatUtils.getLanguage()).isEqualTo(LocaleContextHolder.getLocale().toString());
    }

    @Test
    void getLanguage_returnsLocaleRequestAttributeBeforeLocaleContext() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setAttribute(I18nUtil.LANGUAGE, Locale.SIMPLIFIED_CHINESE);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));
        LocaleContextHolder.setLocale(Locale.US);

        assertThat(ChatUtils.getLanguage()).isEqualTo("zh_CN");
    }
}
