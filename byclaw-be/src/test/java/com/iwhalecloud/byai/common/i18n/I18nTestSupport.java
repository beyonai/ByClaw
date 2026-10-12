package com.iwhalecloud.byai.common.i18n;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

/** Uses the checked-in translations and restores static/thread state after each test. */
public abstract class I18nTestSupport {
    private Object previousMessageSource;
    private LocaleContext previousLocaleContext;

    @BeforeEach
    void initializeMessages() {
        previousMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        previousLocaleContext = LocaleContextHolder.getLocaleContext();
        ResourceBundleMessageSource source = new ResourceBundleMessageSource();
        source.setBasename("i18n/messages");
        source.setDefaultEncoding("UTF-8");
        source.setFallbackToSystemLocale(false);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", source);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
    }

    @AfterEach
    void restoreMessages() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessageSource);
        LocaleContextHolder.setLocaleContext(previousLocaleContext);
    }
}
