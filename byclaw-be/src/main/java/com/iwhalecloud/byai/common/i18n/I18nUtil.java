package com.iwhalecloud.byai.common.i18n;

import java.util.Locale;
import java.util.function.UnaryOperator;

import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;

/**
 * 获取国际化信息
 */
public final class I18nUtil {

    /**
     * 中文语言
     */
    public static final String CHINSES = "zh_CN";

    /**
     * 英文语言
     */
    public static final String ENGLISH = "en_US";

    /**
     * 语言标识，请求头传
     */
    public static final String LANGUAGE = "language";

    private I18nUtil() {
        // 私有化构造器
    }

    private static volatile MessageSource messageSource;

    private static final Logger logger = LoggerFactory.getLogger(I18nUtil.class);
    private static volatile UnaryOperator<String> messageTransformer = UnaryOperator.identity();

    /**
     * 获取国际化参数，可变参数
     *
     * @param key 参数值
     * @param args 要替换的可变参数
     * @return String
     */
    public static String get(String key, Object... args) {
        String message = getMessageSource().getMessage(key, args, LocaleContextHolder.getLocale());
        try {
            return messageTransformer.apply(message);
        }
        catch (RuntimeException exception) {
            logger.warn("Failed to transform i18n message, key={}", key, exception);
            return message;
        }
    }

    /**
     * Registers a customer-facing terminology transformer without coupling this common utility
     * to a concrete domain service.
     *
     * @param transformer message transformer
     */
    public static void registerMessageTransformer(UnaryOperator<String> transformer) {
        messageTransformer = transformer == null ? UnaryOperator.identity() : transformer;
    }

    private static MessageSource getMessageSource() {
        MessageSource current = messageSource;
        if (current != null) {
            return current;
        }

        synchronized (I18nUtil.class) {
            if (messageSource == null) {
                messageSource = ApplicationContextUtil.getBean(MessageSource.class);
            }
            return messageSource;
        }
    }

    /**
     * 从Header获取当前语言
     *
     * @return Locale
     */
    public static Locale getLanguage(String language) {
        Locale locale;
        if (StringUtil.isEmpty(language)) {
            // 设置为中文
            locale = Locale.SIMPLIFIED_CHINESE;
        }
        else if (language.contains("-") || language.contains("_")) {
            String[] split = language.replaceAll("-", "_").split("_");
            locale = new Locale(split[0], split[1]);
        }
        else if (language.startsWith("en")) {
            locale = Locale.US;
        }
        else {
            locale = Locale.SIMPLIFIED_CHINESE;
        }
        return locale;
    }

    /**
     * 设置本地语言,可能当前语言是zh/en/tw
     *
     * @param language 保存的语言
     */
    public static void setLocale(String language) {
        LocaleContextHolder.setLocale(getLanguage(language));
    }

}
