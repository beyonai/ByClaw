package com.iwhalecloud.byai.state.domain.chat.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class ChatChainLogTest {
    @Test
    void diagnosticsSurviveTheJavaGatewayWireFormat() throws Exception {
        AssistantChatDto dto = new AssistantChatDto();
        dto.setClientRequestId("fixture-request");
        var chain = ChatChainLog.dispatchIdentity(dto, 1);
        var header = com.iwhaleai.byai.framework.core.protocol.MessageHeader.builder()
            .messageId("fixture-answer").sessionId("fixture-session").traceId("fixture-trace")
            .userCode("fixture-user").targetAgentType("BYCLAW_DSH_fixture")
            .metadata(Map.of("requestId", ChatChainLog.requestId(dto), "chatChain", chain)).build();
        var command = com.iwhaleai.byai.framework.core.protocol.AskAgentCommand.of(header, "fixture", false, Map.of());
        String wire = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(command);
        JSONObject restored = JSON.parseObject(wire).getJSONObject("header").getJSONObject("metadata").getJSONObject("chatChain");
        assertThat(restored.getString("invocationId")).isEqualTo(chain.get("invocationId"));
        assertThat(restored.getString("dispatchId")).isEqualTo(chain.get("dispatchId"));
        assertThat(restored.getIntValue("attempt")).isEqualTo(1);
        String fixture = System.getProperty("chat.chain.fixture");
        if (fixture != null) java.nio.file.Files.writeString(java.nio.file.Path.of(fixture), wire);
    }
    @Test
    void duplicateClientIdsAndContinuedTracesStillHaveIndependentServerIdentities() {
        AssistantChatDto first = new AssistantChatDto();
        AssistantChatDto second = new AssistantChatDto();
        first.setExtParams(Map.of("requestId", "reused-client-id"));
        second.setExtParams(Map.of("requestId", "reused-client-id"));
        first.setTraceId("continued-trace");
        second.setTraceId("continued-trace");
        try {
            com.iwhalecloud.byai.common.log.util.RequestContextUtil.setRequestId(987654321L);
            TenantRequestContextHolder.set(new TenantRequestContext(1L, 101L, "MEMBER"));
            var a = ChatChainLog.begin(first);
            TenantRequestContextHolder.set(new TenantRequestContext(2L, 202L, "MEMBER"));
            var b = ChatChainLog.begin(second);
            assertThat(a.requestId()).isEqualTo(b.requestId());
            assertThat(a.invocationId()).isNotEqualTo(b.invocationId());
            assertThat(UUID.fromString(a.invocationId()).toString()).isEqualTo(a.invocationId());
            assertThat(a.tenantId()).isEqualTo("101");
            assertThat(a.ingressRequestId()).isEqualTo("987654321");
            assertThat(b.tenantId()).isEqualTo("202");
            assertThat(ChatChainLog.begin(first)).isSameAs(a);
            var attempt1 = ChatChainLog.dispatchIdentity(first, 1);
            var attempt2 = ChatChainLog.dispatchIdentity(first, 2);
            assertThat(attempt1).containsEntry("invocationId", a.invocationId()).containsEntry("attempt", 1)
                .containsEntry("tenantId", "101");
            assertThat(attempt2).containsEntry("invocationId", a.invocationId()).containsEntry("attempt", 2);
            assertThat(attempt1.get("dispatchId")).isNotEqualTo(attempt2.get("dispatchId"));
        } finally {
            TenantRequestContextHolder.clear();
            com.iwhalecloud.byai.common.log.util.RequestContextUtil.clear();
        }
    }

    @Test
    void missingOrInvalidCorrelationIsGeneratedWithoutTruncationCollisionsOrClientIdentityInjection() throws Exception {
        AssistantChatDto first = JSON.parseObject("{\"chatChainContext\":{\"invocationId\":\"forged\"},"
            + "\"clientRequestId\":\"lane\",\"extParams\":{\"requestId\":\"\"}}", AssistantChatDto.class);
        assertThat(first.getChatChainContext()).isNull();
        assertThat(ChatChainLog.begin(first).requestId()).isEqualTo("lane");
        assertThat(JSON.toJSONString(first)).doesNotContain("chatChainContext", "startedNanos");
        assertThat(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(first))
            .doesNotContain("chatChainContext", "startedNanos");
        AssistantChatDto missing = new AssistantChatDto();
        missing.setExtParams(Map.of("requestId", "x".repeat(200)));
        var chain = ChatChainLog.begin(missing);
        assertThat(UUID.fromString(chain.requestId()).toString()).isEqualTo(chain.requestId());
        assertThat(chain.scope()).isEqualTo("personal");
        AssistantChatDto numeric = new AssistantChatDto();
        numeric.setExtParams(Map.of("requestId", 123L));
        assertThat(ChatChainLog.begin(numeric).requestId()).isEqualTo("123");
    }

    @Test
    void initiationLogUsesNumericLocalDurationsAndDoesNotSerializePayloadsOrCredentials() {
        Logger logger = (Logger) LoggerFactory.getLogger(ChatChainLog.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            AssistantChatDto dto = new AssistantChatDto();
            dto.setChatContent("private-prompt");
            dto.setMetadata("private-credentials");
            ChatChainLog.accept(dto);
            ChatChainLog.stage(dto, "trace", "be.dispatch", "end", "failed", System.nanoTime(),
                "attempt", 2, "errorCode", "SEND_FAILED");
            assertThat(appender.list).hasSize(2);
            String line = appender.list.getLast().getFormattedMessage();
            JSONObject event = JSON.parseObject(line.substring("chat_chain ".length()));
            assertThat(event.get("durationMs")).isInstanceOf(Number.class);
            assertThat(event.get("elapsedMs")).isInstanceOf(Number.class);
            assertThat(event.get("attempt")).isEqualTo(2);
            assertThat(event.getString("invocationId")).isEqualTo(dto.getChatChainContext().invocationId());
            assertThat(line).doesNotContain("private-prompt", "private-credentials");
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
    @Test
    void tenantChatFramesCarryTheSelectedEnterpriseForClientRouting() throws Exception {
        EmbeddedChannel channel = new EmbeddedChannel(new ChannelInboundHandlerAdapter());
        channel.attr(Constant.ATT_ENTERPRISE_ID).set("11221076");
        try (NettyArrayOutputStream output = new NettyArrayOutputStream(
            channel.pipeline().firstContext(), "request-1", "CHAT_STREAM")) {
            output.write("{\"event\":\"appStreamResponse\",\"sessionId\":\"11221552\"}"
                .getBytes(StandardCharsets.UTF_8));
            TextWebSocketFrame frame = channel.readOutbound();
            assertThat(JSON.parseObject(frame.text()).getString("enterpriseId")).isEqualTo("11221076");
            frame.release();
        }
        channel.finishAndReleaseAll();
    }

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
