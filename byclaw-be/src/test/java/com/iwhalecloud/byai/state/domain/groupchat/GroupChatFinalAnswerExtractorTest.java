package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatFinalAnswerExtractor;

class GroupChatFinalAnswerExtractorTest {
    @Test
    void ignoresThoughtAndToolEvents() {
        JSONObject event = new JSONObject();
        event.put("event_type", "reasoningLogDelta");
        event.put("content", "思考过程");
        assertNull(GroupChatFinalAnswerExtractor.content(event));
    }

    @Test
    void extractsOnlyFinalContent() {
        JSONObject event = new JSONObject();
        event.put("event_type", "final_answer");
        event.put("final_content", "最终回答");
        assertEquals("最终回答", GroupChatFinalAnswerExtractor.content(event));
    }

    @Test
    void prefersFinalAnswerEventBeforeStreamCompletion() {
        GroupChatFinalAnswerExtractor extractor = new GroupChatFinalAnswerExtractor();
        JSONObject event = new JSONObject();
        event.put("event_type", "finalAnswer");
        event.put("content", "最终正文");
        assertEquals("最终正文", extractor.accept(event));
    }

    @Test
    void joinsOnlyTheLastAnswerDeltaSegmentUntilCompletion() {
        GroupChatFinalAnswerExtractor extractor = new GroupChatFinalAnswerExtractor();
        extractor.accept(event("reasoningLogDelta", "不要保存"));
        extractor.accept(event("answerDelta", "第一段"));
        extractor.accept(event("answerDelta", "第二段"));
        assertNull(extractor.accept(event("appStreamResponse", null)));
        assertEquals("第一段第二段", extractor.finish());
    }

    @Test
    void ignoresContentCarriedByAppStreamResponse() {
        GroupChatFinalAnswerExtractor extractor = new GroupChatFinalAnswerExtractor();
        extractor.accept(event("answerDelta", "正文"));
        assertNull(extractor.accept(event("appStreamResponse", "不应使用")));
        assertEquals("正文", extractor.finish());
    }

    private JSONObject event(String type, String content) {
        JSONObject event = new JSONObject();
        event.put("event_type", type);
        if (content != null) {
            event.put("content", content);
        }
        return event;
    }
}
