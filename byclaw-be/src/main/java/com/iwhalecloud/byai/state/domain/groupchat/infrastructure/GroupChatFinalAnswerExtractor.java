package com.iwhalecloud.byai.state.domain.groupchat.infrastructure;

import com.alibaba.fastjson.JSONObject;

/** 从 Gateway 事件中提取群聊可持久化的最终正文。 */
public final class GroupChatFinalAnswerExtractor {
    private final StringBuilder answerDelta = new StringBuilder();
    private String finalAnswer;
    private boolean completed;
    private boolean answerSegmentOpen;

    public String accept(JSONObject event) {
        if (event == null) {
            return null;
        }
        String type = eventType(event);
        if ("finalAnswer".equalsIgnoreCase(type) || "final_answer".equalsIgnoreCase(type)) {
            finalAnswer = extractContent(event);
            completed = true;
            return finalAnswer;
        }
        if ("answerDelta".equalsIgnoreCase(type)) {
            String content = extractContent(event);
            if (content != null) {
                answerDelta.append(content);
                answerSegmentOpen = true;
            }
            return null;
        }
        if ("reasoningLogDelta".equalsIgnoreCase(type)) {
            if (answerSegmentOpen) {
                answerDelta.setLength(0);
                answerSegmentOpen = false;
            }
            return null;
        }
        if ("appStreamResponse".equalsIgnoreCase(type)) {
            completed = true;
        }
        return null;
    }

    public String finish() {
        if (!completed) {
            return null;
        }
        if (finalAnswer != null && !finalAnswer.isBlank()) {
            return finalAnswer;
        }
        String result = answerDelta.toString();
        return result.isBlank() ? null : result;
    }

    public static boolean isTerminal(JSONObject event) {
        if (event == null) {
            return false;
        }
        String type = eventType(event);
        return "finalAnswer".equalsIgnoreCase(type)
            || "final_answer".equalsIgnoreCase(type)
            || "appStreamResponse".equalsIgnoreCase(type)
            || "error".equalsIgnoreCase(type);
    }

    /** 兼容单事件调用：仅 finalAnswer 携带可直接持久化的正文。 */
    public static String content(JSONObject event) {
        if (event == null) {
            return null;
        }
        String type = eventType(event);
        if (!"finalAnswer".equalsIgnoreCase(type) && !"final_answer".equalsIgnoreCase(type)) {
            return null;
        }
        return extractContent(event);
    }

    private static String eventType(JSONObject event) {
        String type = event.getString("event_type");
        return type == null ? event.getString("event") : type;
    }

    private static String extractContent(JSONObject event) {
        String content = event.getString("final_content");
        if (content == null) {
            content = event.getString("content");
        }
        JSONObject data = event.getJSONObject("data");
        if (content == null && data != null) {
            content = data.getString("content");
            if (content == null && data.getJSONArray("choices") != null && !data.getJSONArray("choices").isEmpty()) {
                JSONObject delta = data.getJSONArray("choices").getJSONObject(0).getJSONObject("delta");
                if (delta != null) {
                    content = delta.getString("content");
                }
            }
        }
        if (content == null || content.isBlank() || "[DONE]".equals(content)) {
            return null;
        }
        return content;
    }
}
