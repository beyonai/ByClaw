package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyQueue;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyDispatcher;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Regression tests for the P1 stream-output fixes: the truncation logic must
 * append the fitting prefix (not drop it) AND keep the final content within the
 * 20000-byte cap (marker included). Also verifies the answerDelta JSON block
 * parsing (event property + choices[0].delta.content).
 */
class WecomStreamOutputStreamTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private ScheduledExecutorService scheduler;
    /** Captured cumulative contents from every stream frame the dispatcher sent. */
    private List<String> sentContents;
    private List<Boolean> sentFinishes;
    private WecomReplyDispatcher dispatcher;

    @BeforeEach
    void setUp() {
        scheduler = Executors.newScheduledThreadPool(2);
        sentContents = new CopyOnWriteArrayList<>();
        sentFinishes = new CopyOnWriteArrayList<>();
        // Queue whose sender records the stream.content then auto-ACKs so frames
        // flow without a live socket.
        WecomReplyQueue[] holder = new WecomReplyQueue[1];
        WecomReplyQueue queue = new WecomReplyQueue(json -> {
            try {
                var root = mapper.readTree(json);
                String content = root.path("body").path("stream").path("content").asText("");
                boolean finish = root.path("body").path("stream").path("finish").asBoolean(false);
                sentContents.add(content);
                sentFinishes.add(finish);
                String reqId = root.path("headers").path("req_id").asText();
                // Auto-ACK on the scheduler thread so send() resolves.
                scheduler.execute(() -> holder[0].onAck(ackFrame(reqId)));
            } catch (Exception ignored) {
            }
            return true;
        }, scheduler, 5_000, 500);
        holder[0] = queue;
        dispatcher = new WecomReplyDispatcher(mapper, queue);
    }

    @AfterEach
    void tearDown() {
        scheduler.shutdownNow();
    }

    private com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame ackFrame(String reqId) {
        var f = new com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame();
        var h = new com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame.Headers();
        h.setReqId(reqId);
        f.setHeaders(h);
        f.setErrcode(0);
        return f;
    }

    private byte[] answerDeltaBlock(String content) {
        return answerDeltaBlock(content, "1001");
    }

    private byte[] answerDeltaBlock(String content, String contentType) {
        ObjectNode root = mapper.createObjectNode();
        root.put("event", "answerDelta");
        root.put("contentType", contentType);
        ObjectNode delta = root.putArray("choices").addObject().putObject("delta");
        delta.put("content", content);
        return root.toString().getBytes(StandardCharsets.UTF_8);
    }

    private byte[] reasoningDeltaBlock(String content, String contentType) {
        ObjectNode root = mapper.createObjectNode();
        root.put("event", "reasoningLogDelta");
        root.put("contentType", contentType);
        root.put("parentOrderId", "-1");
        root.put("orderId", "reason-1");
        ObjectNode delta = root.putArray("choices").addObject().putObject("delta");
        delta.put("content", content);
        return root.toString().getBytes(StandardCharsets.UTF_8);
    }

    private byte[] appStreamResponseBlock() {
        ObjectNode root = mapper.createObjectNode();
        root.put("event", "appStreamResponse");
        root.put("sessionId", 10046601L);
        root.put("messageId", 10047533L);
        return root.toString().getBytes(StandardCharsets.UTF_8);
    }

    @Test
    void accumulatesAnswerDeltaContent() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-1");
        out.write(answerDeltaBlock("Hello "));
        out.write(answerDeltaBlock("world"));
        out.finish().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(out.getAccumulatedContent()).isEqualTo("Hello world");
        // Final frame carries the full cumulative content.
        assertThat(sentContents).isNotEmpty();
        assertThat(sentContents.get(sentContents.size() - 1)).isEqualTo("Hello world");
    }

    @Test
    void truncatesWithinByteCapAndKeepsFittingPrefix() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-2");
        // 30000 ASCII chars = 30000 bytes, well over the 20000 cap.
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 30000; i++) {
            big.append('a');
        }
        out.write(answerDeltaBlock(big.toString()));
        out.finish().get(2, java.util.concurrent.TimeUnit.SECONDS);

        String content = out.getAccumulatedContent();
        int bytes = content.getBytes(StandardCharsets.UTF_8).length;
        // Must NOT exceed the cap (marker included) — the old code overran it.
        assertThat(bytes).isLessThanOrEqualTo(20000);
        // Must have kept the fitting prefix (old code dropped it entirely).
        assertThat(content).startsWith("aaaa");
        assertThat(content).contains("已截断");
    }

    @Test
    void multibyteTruncationStaysWithinByteCap() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-3");
        // Chinese chars are 3 bytes each in UTF-8; 10000 chars = 30000 bytes.
        StringBuilder big = new StringBuilder();
        for (int i = 0; i < 10000; i++) {
            big.append('中');
        }
        out.write(answerDeltaBlock(big.toString()));
        out.finish().get(2, java.util.concurrent.TimeUnit.SECONDS);

        int bytes = out.getAccumulatedContent().getBytes(StandardCharsets.UTF_8).length;
        // Never split a multibyte char in a way that overruns the cap.
        assertThat(bytes).isLessThanOrEqualTo(20000);
    }

    @Test
    void skipsUnsupportedContentTypeAnswerBlocks() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-4");
        // 1001/1002 are the only streamable (plain text/markdown) answer types.
        out.write(answerDeltaBlock("visible ", "1001"));
        // A structured answer payload (e.g. form/card/task) carries another
        // contentType; its raw content must NOT leak into stream.content.
        out.write(answerDeltaBlock("{\"widget\":\"form\"}", "2001"));
        out.write(answerDeltaBlock("text", "1002"));
        out.finish().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(out.getAccumulatedContent()).isEqualTo("visible text");
        assertThat(out.getAccumulatedContent()).doesNotContain("widget");
    }

    @Test
    void byteAtATimeWritesPreserveMultibyteUtf8() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-5");
        // Emit the JSON block one byte at a time via write(int). Multibyte chars
        // (中文, emoji) are split across write calls; the decoder must retain the
        // incomplete sequence and never corrupt into replacement chars.
        byte[] block = answerDeltaBlock("你好🌍 world");
        for (byte b : block) {
            out.write(b & 0xFF);
        }
        out.finish().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(out.getAccumulatedContent()).isEqualTo("你好🌍 world");
        assertThat(out.getAccumulatedContent()).doesNotContain("�");
    }

    @Test
    void appStreamResponseSendsFinalStreamFrame() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-6");
        out.write(answerDeltaBlock("您好！请问"));
        out.write(answerDeltaBlock("有什么企业微信使用问题需要帮您解答吗？"));

        out.write(appStreamResponseBlock());
        out.completionFuture().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(out.getAccumulatedContent()).isEqualTo("您好！请问有什么企业微信使用问题需要帮您解答吗？");
        assertThat(sentContents).isNotEmpty();
        assertThat(sentContents.get(sentContents.size() - 1)).isEqualTo("您好！请问有什么企业微信使用问题需要帮您解答吗？");
        assertThat(sentFinishes.get(sentFinishes.size() - 1)).isTrue();
    }

    @Test
    void completionFutureWaitsForAppStreamResponse() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-wait");
        out.write(answerDeltaBlock("个人助理正在启动中，请等待"));

        assertThat(out.completionFuture()).isNotDone();
        assertThat(sentFinishes).doesNotContain(true);

        out.write(answerDeltaBlock("您好！"));
        out.write(appStreamResponseBlock());

        out.completionFuture().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(sentContents.get(sentContents.size() - 1)).isEqualTo("个人助理正在启动中，请等待您好！");
        assertThat(sentFinishes.get(sentFinishes.size() - 1)).isTrue();
    }

    @Test
    void completionIdleTimeoutResetsOnEachWrite() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-idle");
        ExecutorService waiter = Executors.newSingleThreadExecutor();
        try {
            Future<Boolean> completed = waiter.submit(() -> {
                try {
                    out.awaitCompletionAfterIdle(250, TimeUnit.MILLISECONDS);
                    return true;
                } catch (java.util.concurrent.TimeoutException e) {
                    return false;
                }
            });

            Thread.sleep(150);
            out.write(answerDeltaBlock("慢"));
            Thread.sleep(150);

            assertThat(completed).isNotDone();

            out.write(answerDeltaBlock("回答"));
            out.write(appStreamResponseBlock());

            assertThat(completed.get(2, TimeUnit.SECONDS)).isTrue();
            assertThat(sentContents.get(sentContents.size() - 1)).isEqualTo("慢回答");
            assertThat(sentFinishes.get(sentFinishes.size() - 1)).isTrue();
        } finally {
            waiter.shutdownNow();
        }
    }

    @Test
    void reasoningBlocksAreIgnoredByDefault() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-7");

        out.write(reasoningDeltaBlock("企业微信 智能体已就绪", "3003"));
        out.write(answerDeltaBlock("您好"));
        out.write(appStreamResponseBlock());
        out.completionFuture().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(out.getAccumulatedContent()).isEqualTo("您好");
        assertThat(sentContents.get(sentContents.size() - 1)).isEqualTo("您好");
    }

    @Test
    void reasoningBlocksAreShownWhenEnabled() throws Exception {
        WecomStreamOutputStream out = new WecomStreamOutputStream(mapper, dispatcher, "cb-8", true);

        out.write(reasoningDeltaBlock("企业微信 智能体已就绪", "3003"));
        out.write(answerDeltaBlock("您好"));
        out.write(appStreamResponseBlock());
        out.completionFuture().get(2, java.util.concurrent.TimeUnit.SECONDS);

        assertThat(out.getAccumulatedContent()).isEqualTo("您好");
        assertThat(sentContents.get(sentContents.size() - 1))
                .isEqualTo("**企业微信 智能体已就绪**\n\n---\n\n您好");
        assertThat(sentFinishes.get(sentFinishes.size() - 1)).isTrue();
    }
}
