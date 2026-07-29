package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.message;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomWsClient;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.WecomReplyDispatcher;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.function.LongSupplier;

/**
 * WeCom streaming sink for {@code channelService.chat(dto, OutputStream)}.
 *
 * <p>Extends {@link ByteArrayOutputStream} because {@code CompletionsUtils} only
 * writes the streaming JSON-event blocks when the stream is a
 * {@code ByteArrayOutputStream} subclass (mirror of
 * {@code DingtalkCardStreamingOutputStream}, plan §Task 8). The bytes written
 * are CONTINUOUS compact JSON objects with NO delimiter; each object carries an
 * {@code event} property ({@code answerStart}/{@code answerDelta}/{@code answerEnd},
 * {@code reasoningLog*}) and the visible text lives at
 * {@code choices[0].delta.content}. They are NOT top-level {@code answerDelta}
 * fields.
 *
 * <p>WeCom {@code stream.content} is cumulative full text, so we accumulate the
 * answer deltas locally and push the full buffer each time. Intermediate frames
 * are throttled (>= ~2s/frame) and skipped while a prior ACK is still pending;
 * the final {@code finish=true} frame always sends (plan §6.6, §6.4 rate limits).
 */
public class WecomStreamOutputStream extends ByteArrayOutputStream {

    private static final Logger logger = LoggerFactory.getLogger(WecomStreamOutputStream.class);

    private static final String EVENT_ANSWER_START = "answerStart";
    private static final String EVENT_ANSWER_DELTA = "answerDelta";
    private static final String EVENT_ANSWER_END = "answerEnd";
    private static final String EVENT_REASON_START = "reasoningLogStart";
    private static final String EVENT_REASON_DELTA = "reasoningLogDelta";
    private static final String EVENT_REASON_END = "reasoningLogEnd";
    private static final String EVENT_APP_STREAM_RESPONSE = "appStreamResponse";
    private static final String DONE_MARKER = "[DONE]";
    private static final String MARKDOWN_SECTION_SEPARATOR = "\n\n---\n\n";

    /**
     * Answer contentTypes we stream as visible text (mirror of DingTalk's
     * {@code SUPPORTED_ANSWER_STREAMING_CONTENT_TYPES}): 1001/1002 are plain
     * text/markdown. Structured answer payloads (forms, cards, tasks, images)
     * carry other contentTypes; pushing their raw JSON into WeCom
     * {@code stream.content} would show garbage, so they are skipped.
     */
    private static final java.util.Set<String> SUPPORTED_ANSWER_CONTENT_TYPES =
            java.util.Set.of("1001", "1002");

    private static final java.util.Set<String> SUPPORTED_REASONING_CONTENT_TYPES =
            java.util.Set.of("1001", "1002", "3003", "3009");

    /** WeCom stream.content byte cap (~20480). Leave headroom for multibyte. */
    private static final int MAX_CONTENT_BYTES = 20000;
    private static final String TRUNCATION_MARKER = "\n\n[内容较长已截断]";
    private static final long DEFAULT_MIN_UPDATE_INTERVAL_MILLIS = 2_000L;

    private final ObjectMapper objectMapper;
    private final WecomReplyDispatcher dispatcher;
    private final String reqId;
    private final String streamId;
    private final long minUpdateIntervalMillis;
    private final LongSupplier currentTimeMillis;
    private final boolean showReasoning;

    private final StringBuilder pendingPayload = new StringBuilder();
    private final StringBuilder reasoningBuffer = new StringBuilder();
    private final StringBuilder answerBuffer = new StringBuilder();
    /** Holds bytes not yet decodable as complete UTF-8 chars, across write calls. */
    private final ByteArrayOutputStream undecoded = new ByteArrayOutputStream();
    private final Object activityMonitor = new Object();

    private long lastUpdateAtMillis;
    private long lastWriteActivityAtMillis;
    private boolean truncated;
    private boolean streamingFailed;
    private CompletableFuture<WecomWsFrame> finalFrameFuture;
    private final CompletableFuture<WecomWsFrame> completionFuture = new CompletableFuture<>();

    public WecomStreamOutputStream(ObjectMapper objectMapper, WecomReplyDispatcher dispatcher, String reqId) {
        this(objectMapper, dispatcher, reqId, false);
    }

    public WecomStreamOutputStream(ObjectMapper objectMapper, WecomReplyDispatcher dispatcher, String reqId,
                                   boolean showReasoning) {
        this(objectMapper, dispatcher, reqId,
                WecomWsClient.generateReqId("stream"),
                DEFAULT_MIN_UPDATE_INTERVAL_MILLIS,
                System::currentTimeMillis,
                showReasoning);
    }

    WecomStreamOutputStream(ObjectMapper objectMapper, WecomReplyDispatcher dispatcher, String reqId,
                            String streamId, long minUpdateIntervalMillis, LongSupplier currentTimeMillis) {
        this(objectMapper, dispatcher, reqId, streamId, minUpdateIntervalMillis, currentTimeMillis, false);
    }

    WecomStreamOutputStream(ObjectMapper objectMapper, WecomReplyDispatcher dispatcher, String reqId,
                            String streamId, long minUpdateIntervalMillis, LongSupplier currentTimeMillis,
                            boolean showReasoning) {
        this.objectMapper = objectMapper;
        this.dispatcher = dispatcher;
        this.reqId = reqId;
        this.streamId = streamId;
        this.minUpdateIntervalMillis = Math.max(0L, minUpdateIntervalMillis);
        this.currentTimeMillis = currentTimeMillis == null ? System::currentTimeMillis : currentTimeMillis;
        this.showReasoning = showReasoning;
        this.lastWriteActivityAtMillis = this.currentTimeMillis.getAsLong();
    }

    @Override
    public synchronized void write(byte[] b, int off, int len) {
        super.write(b, off, len);
        markWriteActivity();
        appendDecoded(b, off, len);
        processPendingPayload();
    }

    @Override
    public synchronized void write(int b) {
        super.write(b);
        markWriteActivity();
        appendDecoded(new byte[]{(byte) b}, 0, 1);
        processPendingPayload();
    }

    /**
     * Decode incoming bytes as UTF-8 into {@link #pendingPayload}, retaining any
     * trailing incomplete multibyte sequence in {@link #undecoded} until the
     * continuation bytes arrive on a later write. Fixes UTF-8 corruption when a
     * multibyte char is split across write calls (esp. byte-at-a-time
     * {@code write(int)}), which a naive {@code new String(...)} / {@code (char) b}
     * would mangle into replacement chars.
     */
    private void appendDecoded(byte[] b, int off, int len) {
        undecoded.write(b, off, len);
        byte[] all = undecoded.toByteArray();
        int complete = completeUtf8PrefixLength(all);
        if (complete == 0) {
            return;
        }
        pendingPayload.append(new String(all, 0, complete, StandardCharsets.UTF_8));
        undecoded.reset();
        if (complete < all.length) {
            undecoded.write(all, complete, all.length - complete);
        }
    }

    /** Length of the prefix of {@code b} that ends on a complete UTF-8 char boundary. */
    private static int completeUtf8PrefixLength(byte[] b) {
        int len = b.length;
        if (len == 0) {
            return 0;
        }
        int i = len - 1;
        int cont = 0;
        while (i >= 0 && (b[i] & 0xC0) == 0x80 && cont < 3) {
            i--;
            cont++;
        }
        if (i < 0) {
            return len; // all continuation bytes (malformed) — hand off, decoder will substitute
        }
        int lead = b[i] & 0xFF;
        int need;
        if (lead < 0x80) {
            need = 1;
        } else if ((lead & 0xE0) == 0xC0) {
            need = 2;
        } else if ((lead & 0xF0) == 0xE0) {
            need = 3;
        } else if ((lead & 0xF8) == 0xF0) {
            need = 4;
        } else {
            need = 1; // malformed lead — treat as single byte
        }
        // seqLen = the lead byte + its trailing continuation bytes we walked back over.
        int seqLen = cont + 1;
        return seqLen >= need ? len : i;
    }

    /**
     * Flush the final cumulative content with finish=true (always sent).
     * Returns the ACK future for the final frame so the caller can observe a
     * late ACK error/timeout — a fire-and-forget final frame would hide it.
     * Returns a completed future if the final frame could not be enqueued.
     */
    public synchronized CompletableFuture<WecomWsFrame> finish() {
        if (finalFrameFuture != null) {
            String displayContent = buildDisplayContent();
            logger.info("WeCom stream finish already requested. reqId={}, streamId={}, contentLength={}, content={}",
                    reqId, streamId, displayContent.length(), displayContent);
            return finalFrameFuture;
        }
        String displayContent = buildDisplayContent();
        logger.info("WeCom stream finish requested. reqId={}, streamId={}, contentLength={}, content={}",
                reqId, streamId, displayContent.length(), displayContent);
        finalFrameFuture = pushStreamTracked(true);
        finalFrameFuture.whenComplete((frame, ex) -> {
            if (ex != null) {
                completionFuture.completeExceptionally(ex);
                notifyActivityWaiters();
                return;
            }
            completionFuture.complete(frame);
            notifyActivityWaiters();
        });
        return finalFrameFuture;
    }

    public CompletableFuture<WecomWsFrame> completionFuture() {
        return completionFuture;
    }

    public WecomWsFrame awaitCompletionAfterIdle(long idleTimeout, TimeUnit unit)
            throws InterruptedException, ExecutionException, TimeoutException {
        long timeoutMillis = Math.max(1L, unit.toMillis(idleTimeout));
        resetIdleTimeout();
        while (true) {
            if (completionFuture.isDone()) {
                return completionFuture.get();
            }
            long waitMillis;
            synchronized (activityMonitor) {
                if (completionFuture.isDone()) {
                    return completionFuture.get();
                }
                long idleMillis = currentTimeMillis.getAsLong() - lastWriteActivityAtMillis;
                waitMillis = timeoutMillis - idleMillis;
                if (waitMillis <= 0L) {
                    throw new TimeoutException("No WeCom stream output for " + timeoutMillis + "ms");
                }
                activityMonitor.wait(waitMillis);
            }
        }
    }

    public boolean hasStreamingFailed() {
        return streamingFailed;
    }

    public synchronized String getAccumulatedContent() {
        return answerBuffer.toString();
    }

    private void resetIdleTimeout() {
        synchronized (activityMonitor) {
            lastWriteActivityAtMillis = currentTimeMillis.getAsLong();
            activityMonitor.notifyAll();
        }
    }

    private void markWriteActivity() {
        resetIdleTimeout();
    }

    private void notifyActivityWaiters() {
        synchronized (activityMonitor) {
            activityMonitor.notifyAll();
        }
    }

    // ---- JSON block splitting (continuous objects, brace-depth) -----------

    private void processPendingPayload() {
        while (true) {
            discardNonJsonPrefix();
            int endIndex = findCompleteJsonEnd();
            if (endIndex < 0) {
                return;
            }
            String jsonBlock = pendingPayload.substring(0, endIndex);
            pendingPayload.delete(0, endIndex);
            logger.info("WeCom stream pending json block. reqId={}, jsonBlock={}", reqId, jsonBlock);
            handleJsonBlock(jsonBlock);
        }
    }

    private void discardNonJsonPrefix() {
        while (pendingPayload.length() > 0) {
            char first = pendingPayload.charAt(0);
            if (first == '{') {
                return;
            }
            if (pendingPayload.indexOf(DONE_MARKER) == 0) {
                pendingPayload.delete(0, DONE_MARKER.length());
                continue;
            }
            pendingPayload.deleteCharAt(0);
        }
    }

    private int findCompleteJsonEnd() {
        int depth = 0;
        boolean inString = false;
        boolean escaped = false;
        for (int i = 0; i < pendingPayload.length(); i++) {
            char ch = pendingPayload.charAt(i);
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (ch == '\\') {
                    escaped = true;
                } else if (ch == '"') {
                    inString = false;
                }
                continue;
            }
            if (ch == '"') {
                inString = true;
            } else if (ch == '{') {
                depth++;
            } else if (ch == '}') {
                depth--;
                if (depth == 0) {
                    return i + 1;
                }
            }
        }
        return -1;
    }

    private void handleJsonBlock(String jsonBlock) {
        try {
            JsonNode root = objectMapper.readTree(jsonBlock);
            String event = root.path("event").asText("");
            switch (event) {
                case EVENT_ANSWER_START, EVENT_ANSWER_DELTA, EVENT_ANSWER_END -> {
                    // Gate by contentType (mirror DingTalk): only stream plain
                    // text/markdown answers. Structured payloads (forms, cards,
                    // tasks, images) carry other contentTypes; pushing their raw
                    // JSON into WeCom stream.content would render as garbage.
                    if (!SUPPORTED_ANSWER_CONTENT_TYPES.contains(root.path("contentType").asText(""))) {
                        break;
                    }
                    String delta = extractDeltaContent(root);
                    if (delta != null && !delta.isEmpty()) {
                        appendCapped(delta);
                        pushStream(false);
                    }
                }
                case EVENT_REASON_START, EVENT_REASON_DELTA, EVENT_REASON_END -> {
                    if (!showReasoning || !SUPPORTED_REASONING_CONTENT_TYPES.contains(root.path("contentType").asText(""))) {
                        break;
                    }
                    String delta = extractDeltaContent(root);
                    if (delta != null && !delta.isEmpty()) {
                        appendReasoning(delta, root.path("contentType").asText(""));
                        pushStream(false);
                    }
                }
                case EVENT_APP_STREAM_RESPONSE -> {
                    String displayContent = buildDisplayContent();
                    logger.info("WeCom appStreamResponse received, finishing stream. reqId={}, contentLength={}, content={}",
                            reqId, displayContent.length(), displayContent);
                    finish();
                }
                default -> {
                    // reasoningLog* and other events are not surfaced in WeCom stream text
                }
            }
        } catch (Exception e) {
            logger.debug("Skip unparsable WeCom streaming block.", e);
        }
    }

    private void appendReasoning(String delta, String contentType) {
        if (!reasoningBuffer.isEmpty()) {
            reasoningBuffer.append("\n\n");
        }
        if ("3003".equals(contentType) || "3009".equals(contentType)) {
            reasoningBuffer.append("**").append(delta).append("**");
            return;
        }
        reasoningBuffer.append(delta);
    }

    private void appendCapped(String delta) {
        if (truncated) {
            return;
        }
        // Cap on UTF-8 byte length, not char count.
        int currentBytes = answerBuffer.toString().getBytes(StandardCharsets.UTF_8).length;
        int deltaBytes = delta.getBytes(StandardCharsets.UTF_8).length;
        if (currentBytes + deltaBytes <= MAX_CONTENT_BYTES) {
            answerBuffer.append(delta);
            return;
        }
        // Over the cap: append only the prefix that fits WHILE leaving room for
        // the truncation marker, so the final content never exceeds the cap.
        int markerBytes = TRUNCATION_MARKER.getBytes(StandardCharsets.UTF_8).length;
        int budget = MAX_CONTENT_BYTES - currentBytes - markerBytes;
        if (budget > 0) {
            int fitChars = 0;
            int usedBytes = 0;
            for (int i = 0; i < delta.length(); i++) {
                int chBytes = String.valueOf(delta.charAt(i)).getBytes(StandardCharsets.UTF_8).length;
                if (usedBytes + chBytes > budget) {
                    break;
                }
                usedBytes += chBytes;
                fitChars = i + 1;
            }
            if (fitChars > 0) {
                answerBuffer.append(delta, 0, fitChars);
            }
        }
        truncated = true;
        answerBuffer.append(TRUNCATION_MARKER);
        logger.info("WeCom stream content hit byte cap, truncated. reqId={}", reqId);
    }

    // ---- push -------------------------------------------------------------

    private void pushStream(boolean finish) {
        pushStreamTracked(finish);
    }

    /**
     * Send a stream frame and return its ACK future. For intermediate frames a
     * throttle/skip returns an already-completed future (nothing sent). For the
     * final frame the returned future lets the caller observe a late ACK
     * error/timeout instead of losing it.
     */
    private CompletableFuture<WecomWsFrame> pushStreamTracked(boolean finish) {
        if (streamingFailed && !finish) {
            return CompletableFuture.completedFuture(null);
        }
        // Intermediate frames: throttle + skip while a prior ACK is pending.
        if (!finish) {
            long elapsedMillis = elapsedSinceLastUpdate();
            if (shouldThrottle(elapsedMillis)) {
                logger.info("WeCom stream intermediate frame skipped by throttle. reqId={}, streamId={}, elapsedMs={}, minIntervalMs={}, contentLength={}, content={}",
                        reqId, streamId, elapsedMillis, minUpdateIntervalMillis,
                        buildDisplayContent().length(), buildDisplayContent());
                return CompletableFuture.completedFuture(null);
            }
            if (dispatcher.hasPendingAck(reqId)) {
                logger.info("WeCom stream intermediate frame skipped by pending ack. reqId={}, streamId={}, contentLength={}, content={}",
                        reqId, streamId, buildDisplayContent().length(), buildDisplayContent());
                return CompletableFuture.completedFuture(null);
            }
        }
        try {
            CompletableFuture<WecomWsFrame> future =
                    dispatcher.replyStream(reqId, streamId, buildDisplayContent(), finish)
                            .whenComplete((ok, ex) -> {
                                if (ex != null) {
                                    streamingFailed = true;
                                    logger.warn("WeCom stream frame failed. reqId={}, finish={}", reqId, finish, ex);
                                }
                            });
            lastUpdateAtMillis = currentTimeMillis.getAsLong();
            return future;
        } catch (Exception e) {
            streamingFailed = true;
            logger.warn("WeCom stream push error. reqId={}", reqId, e);
            CompletableFuture<WecomWsFrame> failed = new CompletableFuture<>();
            failed.completeExceptionally(e);
            return failed;
        }
    }

    private boolean shouldThrottle(long elapsedMillis) {
        if (minUpdateIntervalMillis <= 0L || lastUpdateAtMillis == 0L) {
            return false;
        }
        return elapsedMillis < minUpdateIntervalMillis;
    }

    private long elapsedSinceLastUpdate() {
        return lastUpdateAtMillis == 0L ? Long.MAX_VALUE : currentTimeMillis.getAsLong() - lastUpdateAtMillis;
    }

    private String extractDeltaContent(JsonNode root) {
        JsonNode choices = root.path("choices");
        if (!choices.isArray() || choices.isEmpty()) {
            return "";
        }
        JsonNode contentNode = choices.get(0).path("delta").path("content");
        if (contentNode.isMissingNode() || contentNode.isNull()) {
            return "";
        }
        return contentNode.isTextual() ? contentNode.asText() : contentNode.toString();
    }

    private String buildDisplayContent() {
        if (!showReasoning || reasoningBuffer.isEmpty()) {
            return answerBuffer.toString();
        }
        if (answerBuffer.isEmpty()) {
            return reasoningBuffer.toString();
        }
        return reasoningBuffer + MARKDOWN_SECTION_SEPARATOR + answerBuffer;
    }
}
