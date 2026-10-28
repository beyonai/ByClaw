package com.iwhalecloud.byai.state.domain.chat.service;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.ws.manager.NettyArrayOutputStream;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import java.nio.charset.StandardCharsets;
import static org.assertj.core.api.Assertions.assertThat;

class ChatReplyLogTest {
    private JSONObject event(String invocation, String reply) {
        JSONObject chain = JSON.parseObject("{\"requestId\":\"reused\",\"checkpoint\":true,\"tenantId\":\"101\","
            + "\"messageId\":\"source-answer\",\"traceId\":\"continued-trace\",\"eventTraceId\":\"continued-trace\"}");
        chain.put("invocationId", invocation);
        chain.put("replyEventId", reply);
        chain.put("secret", "private-token");
        JSONObject event = JSON.parseObject("{\"session_id\":\"10\",\"trace_id\":\"continued-trace\","
            + "\"event_type\":\"finalAnswer\",\"data\":\"private-answer\",\"stream_id\":\"1-0\"}");
        event.put("metadata", new JSONObject(java.util.Map.of("chatChain", chain)));
        return event;
    }

    @Test
    void separatesOriginFromActualLaneAndRetainsExactEventDuringReplays() {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 20L;
        ctx.traceId = "root-trace";
        ctx.clientRequestId = "root-client";
        ctx.assistantChatDto = new AssistantChatDto();
        var actual = ChatChainLog.begin(ctx.assistantChatDto);
        MessageContext message = new MessageContext();
        message.setMessageId(222L);
        ctx.multiAgentMessageContextsByTraceId.put("continued-trace", message);
        ctx.multiAgentLaneMetadataByTraceId.put("continued-trace", JSON.parseObject("{\"clientRequestId\":\"lane-client\"}"));
        JSONObject old = event("origin-invocation", "reply-old");
        var identity = ChatReplyLog.bind(ctx, old);
        assertThat(identity).containsEntry("invocationId", "origin-invocation")
            .containsEntry("targetInvocationId", actual.invocationId()).containsEntry("targetMessageId", "222")
            .containsEntry("targetClientRequestId", "lane-client").containsEntry("targetSessionId", "20");
        assertThat(identity).doesNotContainKey("secret");
        ChatReplyLog.bind(ctx, event("origin-invocation", "reply-new"));
        Logger logger = (Logger) LoggerFactory.getLogger(ChatChainLog.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start(); logger.addAppender(appender);
        try {
            ChatReplyLog.log("be.reply_route", old, ctx, "replay");
            String line = appender.list.getFirst().getFormattedMessage();
            assertThat(line).contains("reply-old", "targetMessageId", "222").doesNotContain("reply-new", "private-answer", "private-token");
        } finally { logger.detachAppender(appender); appender.stop(); }
    }

    @Test
    void selectsExactLaneAndDoesNotGuessForAnAmbiguousFrame() throws Exception {
        EmbeddedChannel channel = new EmbeddedChannel(new ChannelInboundHandlerAdapter());
        try {
            NettyArrayOutputStream stream = new NettyArrayOutputStream(channel.pipeline().firstContext(), "root", "CHAT_STREAM");
            JSONObject a = ChatReplyLog.envelope(event("inv-a", "reply-a"));
            JSONObject b = ChatReplyLog.envelope(event("inv-b", "reply-b"));
            a.put("targetTraceId", "a"); b.put("targetTraceId", "b");
            stream.registerReply("a", "111", a);
            stream.registerReply("b", "222", b);
            String firstFrameId = null;
            for (String trace : java.util.List.of("b", "a", "unknown", "")) {
                JSONObject body = new JSONObject(); body.put("event", "appStreamResponse");
                if (!trace.isEmpty()) body.put("traceId", trace);
                stream.write(body.toJSONString().getBytes(StandardCharsets.UTF_8));
                TextWebSocketFrame frame = channel.readOutbound();
                JSONObject output = JSON.parseObject(frame.text()); frame.release();
                JSONObject chain = output.getJSONObject("chatChain");
                if (trace.equals("unknown") || trace.isEmpty()) assertThat(chain).isNull();
                else {
                    assertThat(chain.getString("invocationId")).isEqualTo("inv-" + trace);
                    assertThat(chain.getString("targetTraceId")).isEqualTo(trace);
                    assertThat(chain.getString("replyEventId")).isEqualTo("reply-" + trace);
                    assertThat(chain.getString("frameId")).isNotBlank().isNotEqualTo(firstFrameId);
                    firstFrameId = chain.getString("frameId");
                }
            }
        } finally { channel.finishAndReleaseAll(); }
    }

    @Test
    void extractsNestedStoredMetadataAndUsesOneFrameIdAcrossBroadcastRecipients() {
        JSONObject ws = new JSONObject();
        ws.put("type", "NEW_MESSAGE"); ws.put("sessionId", "20");
        ws.put("data", new JSONObject(java.util.Map.of("metadata", event("inv", "reply").getJSONObject("metadata").toJSONString())));
        String first = ChatReplyLog.frame(ws.toJSONString());
        String second = ChatReplyLog.frame(first);
        assertThat(ChatReplyLog.envelope(JSON.parseObject(first)).getString("frameId"))
            .isEqualTo(ChatReplyLog.envelope(JSON.parseObject(second)).getString("frameId"));
        assertThat(ChatReplyLog.envelope(JSON.parseObject(first))).doesNotContainKey("secret");
        assertThat(ChatReplyLog.frame("not-json")).isEqualTo("not-json");
        assertThat(ChatReplyLog.safeEnvelope(JSON.parseObject("{\"secret\":\"x\"}"))).isNull();
    }
}
