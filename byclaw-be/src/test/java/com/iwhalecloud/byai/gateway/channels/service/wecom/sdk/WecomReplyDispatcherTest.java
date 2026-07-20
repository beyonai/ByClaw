package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Payload-shape verification for {@link WecomReplyDispatcher}. Regression guard
 * for the bug where notice replies used {@code msgtype=text}, which WeCom's
 * {@code aibot_respond_msg} does not support (only stream / template_card /
 * markdown / file / voice / image / video), so the frames were silently
 * dropped and users saw nothing. Notice replies must go out as markdown.
 */
class WecomReplyDispatcherTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private ScheduledExecutorService scheduler;

    @BeforeEach
    void setUp() {
        scheduler = Executors.newScheduledThreadPool(1);
    }

    @AfterEach
    void tearDown() {
        scheduler.shutdownNow();
    }

    private JsonNode captureFrame(java.util.function.Consumer<WecomReplyDispatcher> action) {
        AtomicReference<String> captured = new AtomicReference<>();
        WecomReplyQueue queue = new WecomReplyQueue(json -> {
            captured.set(json);
            return true;
        }, scheduler, 5_000, 500);
        WecomReplyDispatcher dispatcher = new WecomReplyDispatcher(mapper, queue);
        action.accept(dispatcher);
        assertThat(captured.get()).as("a frame was sent").isNotNull();
        try {
            return mapper.readTree(captured.get());
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }

    @Test
    void replyTextSendsMarkdownOnRespondMsgCmd() {
        JsonNode frame = captureFrame(d -> d.replyText("r1", "未找到匹配的系统用户"));

        assertThat(frame.path("cmd").asText()).isEqualTo(WecomWsCmd.RESPONSE);
        assertThat(frame.path("headers").path("req_id").asText()).isEqualTo("r1");
        // aibot_respond_msg does NOT support msgtype=text; notices must be markdown.
        assertThat(frame.path("body").path("msgtype").asText()).isEqualTo("markdown");
        assertThat(frame.path("body").path("markdown").path("content").asText())
                .isEqualTo("未找到匹配的系统用户");
        assertThat(frame.path("body").has("text")).isFalse();
    }

    @Test
    void replyWelcomeTextKeepsTextOnWelcomeCmd() {
        JsonNode frame = captureFrame(d -> d.replyWelcomeText("r2", "欢迎"));

        // Welcome uses a different command that DOES support msgtype=text.
        assertThat(frame.path("cmd").asText()).isEqualTo(WecomWsCmd.RESPONSE_WELCOME);
        assertThat(frame.path("body").path("msgtype").asText()).isEqualTo("text");
        assertThat(frame.path("body").path("text").path("content").asText()).isEqualTo("欢迎");
    }
}
