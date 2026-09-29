package com.iwhalecloud.byai.state.domain.chat.model;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import org.apache.commons.lang3.StringUtils;

/** Normalizes explicit final events without treating structured cards or completion markers as prose. */
public final class FinalAnswerContent {
    private FinalAnswerContent() {
    }

    public static boolean isFinalEvent(String eventType) {
        return "finalAnswer".equals(eventType) || "final_answer".equals(eventType);
    }

    public static String extract(Object payload) {
        return extract(payload, 0);
    }

    private static String extract(Object payload, int depth) {
        if (depth > 4) {
            return null;
        }
        if (payload instanceof String) {
            try {
                return extract(JSON.parseObject((String) payload), depth + 1);
            }
            catch (RuntimeException ignored) {
                return null;
            }
        }
        if (!(payload instanceof JSONObject)) {
            return null;
        }
        JSONObject object = (JSONObject) payload;
        for (String key : new String[] {"final_content", "content"}) {
            String text = text(object.get(key));
            if (text != null) {
                return text;
            }
        }
        Object rawChoices = object.get("choices");
        if (rawChoices instanceof JSONArray) {
            for (Object choice : (JSONArray) rawChoices) {
                if (choice instanceof JSONObject) {
                    Object delta = ((JSONObject) choice).get("delta");
                    if (delta instanceof JSONObject) {
                        String text = text(((JSONObject) delta).get("content"));
                        if (text != null) {
                            return text;
                        }
                    }
                }
            }
        }
        return extract(object.get("data"), depth + 1);
    }

    private static String text(Object value) {
        if (!(value instanceof String) || StringUtils.isBlank((String) value)
            || "[DONE]".equals(((String) value).trim())) {
            return null;
        }
        return (String) value;
    }
}
