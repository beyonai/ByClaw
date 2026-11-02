package com.iwhalecloud.byai.manager.interfaces.response;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

class ResponseUtilI18nTest {

    private MessageSource previousMessageSource;

    @BeforeEach
    void setUp() {
        previousMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("i18n.messages");
        messages.setDefaultEncoding("UTF-8");
        messages.setFallbackToSystemLocale(false);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void preservesLocalizedDetailsAndUsesLocalizedFallbackForEmptyMessages() {
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(ResponseUtil.fail("文件大小不能超过 1MB").getMsg()).isEqualTo("文件大小不能超过 1MB");
        assertThat(ResponseUtil.fail("").getMsg()).isEqualTo("系统发生错误，请稍后重试");
        LocaleContextHolder.setLocale(Locale.US);
        assertThat(ResponseUtil.fail("Robot (问数数字员工) is already bound").getMsg())
            .isEqualTo("Robot (问数数字员工) is already bound");
    }

    @Test
    void failedResponsesUseRequestLanguage() {
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        assertThat(ResponseUtil.failI18n("i18n.error.sandbox.running.notFound").getMsg())
            .isEqualTo("未找到该资源正在运行的沙箱");

        LocaleContextHolder.setLocale(Locale.US);
        assertThat(ResponseUtil.failI18n("i18n.error.sandbox.running.notFound").getMsg())
            .isEqualTo("No running sandbox found for this resource");
    }
}
