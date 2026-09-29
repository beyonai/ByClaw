package com.iwhalecloud.byai.state.domain.chat.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;

class ChatChainLogTest {
    @Test
    void rootIdentitySurvivesSerializationWithoutChangingLaneIdentity() {
        AssistantChatDto dto = new AssistantChatDto();
        dto.setClientRequestId("lane-2");
        dto.setExtParams(Map.of("requestId", "root"));
        AssistantChatDto restored = JSON.parseObject(JSON.toJSONString(dto), AssistantChatDto.class);
        assertThat(ChatChainLog.requestId(restored)).isEqualTo("root");
        assertThat(restored.getClientRequestId()).isEqualTo("lane-2");
    }

    @Test
    void emitsOnlyTerminalWriteCompletionAndKeepsPayloadIntact() throws Exception {
        Logger logger = (Logger) LoggerFactory.getLogger(ChatChainLog.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        EmbeddedChannel channel = new EmbeddedChannel(new ChannelInboundHandlerAdapter());
        try (NettyArrayOutputStream output = new NettyArrayOutputStream(channel.pipeline().firstContext(), "lane", "CHAT_STREAM", "root")) {
            output.write("{\"event\":\"answerDelta\",\"data\":\"secret\"}".getBytes(StandardCharsets.UTF_8));
            TextWebSocketFrame delta = channel.readOutbound();
            delta.release();
            assertThat(appender.list).isEmpty();
            output.write("{\"event\":\"appStreamResponse\",\"sessionId\":\"session\",\"data\":\"secret\"}".getBytes(StandardCharsets.UTF_8));
            channel.runPendingTasks();
            TextWebSocketFrame frame = channel.readOutbound();
            JSONObject body = JSON.parseObject(frame.text());
            assertThat(body.getString("requestId")).isEqualTo("root");
            assertThat(body.getString("clientRequestId")).isEqualTo("lane");
            assertThat(body.getJSONObject("data").getString("data")).isEqualTo("secret");
            frame.release();
            assertThat(appender.list).hasSize(1);
            assertThat(appender.list.getFirst().getFormattedMessage()).contains("be.ws_written", "root", "\"result\":\"ok\"").doesNotContain("secret");
            channel.close();
            output.write("{\"event\":\"appStreamResponse\"}".getBytes(StandardCharsets.UTF_8));
            assertThat(appender.list.getLast().getFormattedMessage()).contains("inactive");
        } finally {
            channel.finishAndReleaseAll();
            logger.detachAppender(appender);
            appender.stop();
        }
    }

    @Test
    void failedWriteIsNotReportedAsDeliveredAndMalformedMetadataDoesNotThrow() {
        Logger logger = (Logger) LoggerFactory.getLogger(ChatChainLog.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        EmbeddedChannel channel = new EmbeddedChannel();
        try {
            JSONObject frame = JSON.parseObject("{\"event\":\"appStreamResponse\",\"requestId\":\"root\"}");
            ChatChainLog.wsWritten(channel.newFailedFuture(new IllegalStateException("secret")), frame, System.nanoTime());
            channel.runPendingTasks();
            assertThat(appender.list.getFirst().getFormattedMessage()).contains("\"result\":\"failed\"").doesNotContain("secret");
            assertThat(ChatChainLog.requestId(JSON.parseObject("{\"metadata\":\"invalid\"}"))).isEmpty();
            assertThat(ChatChainLog.safe(Map.of("token", "secret"))).isEmpty();
        } finally {
            logger.detachAppender(appender);
            channel.finishAndReleaseAll();
        }
    }
}
