package com.iwhalecloud.byai.state.domain.ws.model;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;

/**
 * 会话级模型选择的入参契约：WS 帧顶层 {@code relModelId} 必须是字符串类型，
 * 以同时接受数字模型主键（网页端）与桌面本地模型 id（非数字），并兼容既有的 -1 默认信号。
 */
class ChatMessageRelModelIdTest {

    @Test
    void parsesNumericModelIdFromWebPayload() {
        ChatMessage message = JSON.parseObject(
            "{\"type\":\"LLM_MESSAGE\",\"relModelId\":9001,\"chatContent\":\"hi\"}", ChatMessage.class);

        assertThat(message.getType()).isEqualTo(MessageType.LLM_MESSAGE);
        assertThat(message.getRelModelId()).isEqualTo("9001");
    }

    @Test
    void parsesStringModelIdAndDefaultSignal() {
        ChatMessage message = JSON.parseObject(
            "{\"type\":\"LLM_MESSAGE\",\"relModelId\":\"-1\",\"chatContent\":\"hi\"}", ChatMessage.class);

        assertThat(message.getRelModelId()).isEqualTo("-1");
    }

    @Test
    void parsesNonNumericDesktopLocalModelIdWithoutFailing() {
        ChatMessage message = JSON.parseObject(
            "{\"type\":\"LLM_MESSAGE\",\"relModelId\":\"claude-sonnet-4-5\",\"chatContent\":\"hi\"}",
            ChatMessage.class);

        assertThat(message.getRelModelId()).isEqualTo("claude-sonnet-4-5");
    }

    @Test
    void keepsRelModelIdNullWhenAbsent() {
        ChatMessage message = JSON.parseObject("{\"type\":\"LLM_MESSAGE\",\"chatContent\":\"hi\"}", ChatMessage.class);

        assertThat(message.getRelModelId()).isNull();
    }
}
