package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.text.MessageFormat;
import java.text.ParsePosition;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.ResourceBundle;

/** 后台执行没有请求语言；只在结果展示时翻译已知系统模板，原始报告、日志和用户内容不变。 */
public final class IntegrationRunMessages {
    private static final List<MessageTemplate> TEMPLATES = templates();

    private IntegrationRunMessages() { }

    public static String localize(String value) {
        if (value == null || value.isBlank()) return value;
        for (MessageTemplate template : TEMPLATES) {
            if (!template.pattern().contains("{0}")) {
                if (template.pattern().equals(value)) return I18nUtil.get(template.key());
                continue;
            }
            // MessageFormat 非线程安全；每次独立解析，并要求完整往返匹配，避免改写自定义错误。
            MessageFormat format = new MessageFormat(template.pattern(), template.locale());
            ParsePosition position = new ParsePosition(0);
            Object[] arguments = format.parse(value, position);
            if (arguments != null && position.getIndex() == value.length()
                    && format.format(arguments).equals(value)) {
                return I18nUtil.get(template.key(), arguments);
            }
        }
        return value;
    }

    private static List<MessageTemplate> templates() {
        List<MessageTemplate> templates = new ArrayList<>();
        for (Locale locale : new Locale[] {Locale.SIMPLIFIED_CHINESE, Locale.US}) {
            ResourceBundle bundle = ResourceBundle.getBundle("i18n/messages", locale);
            for (String key : bundle.keySet()) {
                if (key.startsWith("devloop.integration.")) {
                    templates.add(new MessageTemplate(key, bundle.getString(key), locale));
                }
            }
        }
        return List.copyOf(templates);
    }

    private record MessageTemplate(String key, String pattern, Locale locale) { }
}
