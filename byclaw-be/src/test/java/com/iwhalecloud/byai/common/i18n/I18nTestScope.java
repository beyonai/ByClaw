package com.iwhalecloud.byai.common.i18n;

import java.util.Locale;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.ResourceBundleMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

/** 为不启动 Spring 的测试加载真实语言包，并在结束时恢复共享消息源与语言。 */
public final class I18nTestScope implements AutoCloseable {
    private final Object previousMessageSource;
    private final LocaleContext previousLocale;

    public I18nTestScope(Locale locale) {
        previousMessageSource = ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        previousLocale = LocaleContextHolder.getLocaleContext();
        ResourceBundleMessageSource messages = new ResourceBundleMessageSource();
        messages.setBasename("i18n/messages");
        messages.setDefaultEncoding("UTF-8");
        messages.setFallbackToSystemLocale(false);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        LocaleContextHolder.setLocale(locale);
    }

    @Override
    public void close() {
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", previousMessageSource);
        LocaleContextHolder.setLocaleContext(previousLocale);
    }
}
