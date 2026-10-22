package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;

/** 发布快照可能由另一种语言创建；仅将系统生成的提示按查看者语言显示，保留自定义内容。 */
final class EmployeePublicationMessages {
    private static final Map<String, String> MESSAGE_KEYS = messageKeys();

    private EmployeePublicationMessages() { }

    static String localize(String value) {
        if (value == null || value.isBlank()) return value;
        String key = MESSAGE_KEYS.get(value);
        return key == null ? value : I18nUtil.get(key);
    }

    private static Map<String, String> messageKeys() {
        Map<String, String> keys = new HashMap<>();
        for (Locale locale : new Locale[] {Locale.SIMPLIFIED_CHINESE, Locale.US}) {
            ResourceBundle bundle = ResourceBundle.getBundle("i18n/messages", locale);
            for (String key : bundle.keySet()) {
                if (!key.startsWith("employee.publication.")) continue;
                String text = bundle.getString(key);
                // 带资源名称的参数化文案不能当作普通文本匹配，避免改写用户输入。
                if (text.contains("{0}")) continue;
                keys.put(text, key);
                keys.put(key, key);
            }
        }
        return Map.copyOf(keys);
    }
}
