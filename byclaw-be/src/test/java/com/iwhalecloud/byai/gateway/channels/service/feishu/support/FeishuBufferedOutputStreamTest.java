package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class FeishuBufferedOutputStreamTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void getDisplayContent_excludesReasoningWhenShowReasoningDisabled() {
        FeishuBufferedOutputStream outputStream = new FeishuBufferedOutputStream(objectMapper, false);

        writeEvent(outputStream, "reasoningLogDelta", "1001", "reasoning");
        writeEvent(outputStream, "answerDelta", "1001", "answer");

        assertThat(outputStream.getDisplayContent()).isEqualTo("answer");
    }

    @Test
    void getDisplayContent_includesReasoningWhenShowReasoningEnabled() {
        FeishuBufferedOutputStream outputStream = new FeishuBufferedOutputStream(objectMapper, true);

        writeEvent(outputStream, "reasoningLogDelta", "1001", "reasoning");
        writeEvent(outputStream, "answerDelta", "1001", "answer");

        assertThat(outputStream.getDisplayContent()).isEqualTo("reasoning\n\n---\n\nanswer");
    }

    private void writeEvent(FeishuBufferedOutputStream outputStream, String event, String contentType, String content) {
        String payload = """
                {"event":"%s","contentType":"%s","parentOrderId":"-1","orderId":"1","choices":[{"delta":{"content":"%s"}}]}
                """.formatted(event, contentType, content);
        byte[] bytes = payload.getBytes(StandardCharsets.UTF_8);
        outputStream.write(bytes, 0, bytes.length);
    }
}
