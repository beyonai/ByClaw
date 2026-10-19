package com.iwhalecloud.byai.state.application.service.recorder;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import java.text.MessageFormat;
import java.text.ParsePosition;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.ResourceBundle;

/** 录制异步任务不绑定查看者语言；仅在返回结果时翻译已知系统模板，保留原始结果。 */
public final class RecorderMessages {
    private static final List<MessageTemplate> TEMPLATES = templates();

    private RecorderMessages() { }

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

    /** 仅遍历录制协议中的展示字段；脚本、候选接口响应和任意 details 不参与翻译。 */
    public static Map<String, Object> localizeResponse(Map<String, Object> data) {
        Map<String, Object> translated = new LinkedHashMap<>(data);
        if (data.get("error") instanceof Map<?, ?> error) {
            Map<Object, Object> copy = new LinkedHashMap<>(error);
            for (String field : List.of("message", "hint")) {
                if (error.get(field) instanceof String text) copy.put(field, localize(text));
            }
            translated.put("error", copy);
        }
        for (String field : List.of("result", "verify")) {
            if (data.get(field) instanceof Map<?, ?> nested) {
                translated.put(field, localizeResponse(stringKeyMap(nested)));
            }
        }
        if (data.get("drafts") instanceof List<?> drafts) {
            translated.put("drafts", drafts.stream().map(draft -> draft instanceof Map<?, ?> item
                ? localizeResponse(stringKeyMap(item)) : draft).toList());
        }
        // pending verification 是前端识别未验证状态的既有标记，不作为文案模板翻译。
        if (data.get("reasons") instanceof List<?> reasons) {
            translated.put("reasons", reasons.stream().map(reason -> reason instanceof String text
                ? localize(text) : reason).toList());
        }
        return translated;
    }

    private static Map<String, Object> stringKeyMap(Map<?, ?> input) {
        Map<String, Object> copy = new LinkedHashMap<>();
        input.forEach((key, value) -> copy.put((String) key, value));
        return copy;
    }

    private static List<MessageTemplate> templates() {
        List<MessageTemplate> templates = new ArrayList<>();
        for (Locale locale : new Locale[] {Locale.SIMPLIFIED_CHINESE, Locale.US}) {
            ResourceBundle bundle = ResourceBundle.getBundle("i18n/messages", locale);
            for (String key : bundle.keySet()) {
                if (key.startsWith("recorder.error.")) {
                    templates.add(new MessageTemplate(key, bundle.getString(key), locale));
                }
            }
        }
        return List.copyOf(templates);
    }

    private record MessageTemplate(String key, String pattern, Locale locale) { }
}
