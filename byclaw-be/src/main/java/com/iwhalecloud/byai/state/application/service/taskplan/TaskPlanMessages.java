package com.iwhalecloud.byai.state.application.service.taskplan;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.ResourceBundle;

/** 任务状态可能由不同语言的请求或后台执行器写入；响应时按查看者语言解析系统提示，保留第三方原始错误。 */
final class TaskPlanMessages {
    private static final Map<String, String> MESSAGE_KEYS = messageKeys();

    private TaskPlanMessages() { }

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
                if (!key.startsWith("taskplan.")) continue;
                String text = bundle.getString(key);
                // 不推断包含用户数据的参数化消息；固定系统提示才允许反向映射。
                if (text.contains("{0}")) continue;
                keys.put(text, key);
                keys.put(key, key);
            }
        }
        return Map.copyOf(keys);
    }
}
