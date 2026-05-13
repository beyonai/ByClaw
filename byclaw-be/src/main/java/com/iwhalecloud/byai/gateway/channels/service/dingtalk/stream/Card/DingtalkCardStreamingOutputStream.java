package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.card;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Set;

/**
 * 兼容 ByteArrayOutputStream 的增量输出流。
 * 作用有两层：
 * 1. 继续作为 chat() 的输出目标，完整保留现有对 ByteArrayOutputStream 的兼容行为；
 * 2. 在写入过程中实时解析 answerDelta / reasoningLogDelta 事件，并把累计内容同步到钉钉卡片。
 *
 * 之所以继承 ByteArrayOutputStream，而不是自定义一个全新的 OutputStream，
 * 是因为现有 CompletionsUtils/AssistantChatService 在识别到 ByteArrayOutputStream 时，
 * 会按“连续 JSON”方式写出增量事件；这里复用该约定，改造成本最低。
 */
public class DingtalkCardStreamingOutputStream extends ByteArrayOutputStream {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkCardStreamingOutputStream.class);

    private static final String EVENT_ANSWER_START = "answerStart";
    private static final String EVENT_ANSWER_DELTA = "answerDelta";
    private static final String EVENT_ANSWER_END = "answerEnd";
    private static final String EVENT_REASON_START = "reasoningLogStart";
    private static final String EVENT_REASON_DELTA = "reasoningLogDelta";
    private static final String EVENT_REASON_END = "reasoningLogEnd";
    private static final String ROOT_PARENT_ORDER_ID = "-1";
    private static final String MARKDOWN_LINE_BREAK = "\n\n";
    private static final String MARKDOWN_SECTION_SEPARATOR = "\n\n---\n\n";
    private static final String REASONING_TITLE_MARKER = "- ";
    private static final String REASONING_TEXT_INDENT = "&emsp;&emsp;";
    private static final String REASONING_TEXT_STYLE_PREFIX = "<span style=\"color:#a4aab2;\"><em>";
    private static final String REASONING_TEXT_STYLE_SUFFIX = "</em></span>";
    /**
     * 当前允许直接流式刷到钉钉卡片的 answer contentType。
     * 后续如果要放开更多类型，只需在这里追加，主流程无需改动。
     */
    private static final Set<String> SUPPORTED_ANSWER_STREAMING_CONTENT_TYPES = Set.of("1001", "1002");
    /**
     * 当前需要以灰色斜体展示的 reasoning contentType。
     * 后续如果有更多“弱化展示”的推理类型，只需在这里扩展。
     */
    private static final Set<String> STYLED_REASONING_CONTENT_TYPES = Set.of("1001", "1002");
    /**
     * 当前允许流式刷到钉钉卡片的 reasoning contentType。
     * 后续如果要放开更多推理类型，只需在这里追加。
     */
    private static final Set<String> SUPPORTED_REASONING_STREAMING_CONTENT_TYPES = Set.of("1001", "1002", "3003", "3009");

    private final ObjectMapper objectMapper;
    private final DingtalkCardService dingtalkCardService;
    private final DingtalkCardStreamSession session;
    /**
     * 暂存尚未拼成完整 JSON 对象的输出片段。
     * chat() 写入时可能一次只写入部分字符串，因此需要先缓冲，再按完整 JSON 块解析。
     */
    private final StringBuilder pendingPayload = new StringBuilder();
    /**
     * 卡片展示使用的 reasoning 缓冲区。
     * 只承载推理展示内容，最终由 updateStreamingContent 统一与 answer 合并。
     */
    private final StringBuilder reasoningBuffer = new StringBuilder();
    /**
     * 当前处于打开状态的 1001/1002 推理文本段。
     * 仅保存前缀和已转义正文，不提前写入样式闭合标签。
     */
    private final StringBuilder reasoningTextBuffer = new StringBuilder();
    /**
     * 卡片展示使用的 answer 缓冲区。
     * 只承载答案正文，最终由 updateStreamingContent 统一与 reasoning 合并。
     */
    private final StringBuilder answerBuffer = new StringBuilder();
    /**
     * 最近一次成功写入 reasoningBuffer 的 reasoning contentType。
     * 用于在推理流 contentType 发生切换时插入 Markdown 段落换行。
     */
    private String lastReasoningContentType;
    private String lastReasoningOrderId;
    /**
     * 标记卡片 streamingUpdate 是否已经失败。
     * 一旦失败，后续只保留答案文本，不再继续尝试更新卡片，避免连续报错。
     */
    private boolean streamingFailed;

    public DingtalkCardStreamingOutputStream(
            ObjectMapper objectMapper,
            DingtalkCardService dingtalkCardService,
            DingtalkCardStreamSession session
    ) {
        this.objectMapper = objectMapper;
        this.dingtalkCardService = dingtalkCardService;
        this.session = session;
    }

    @Override
    public synchronized void write(byte[] b, int off, int len) {
        // super.write(...) 保留原始输出内容，便于后续仍可整体读取完整 chat 结果。
        super.write(b, off, len);
        pendingPayload.append(new String(b, off, len, StandardCharsets.UTF_8));
        processPendingPayload();
    }

    @Override
    public synchronized void write(int b) {
        // 兼容逐字节写入场景，逻辑与 write(byte[], off, len) 保持一致。
        super.write(b);
        pendingPayload.append((char) b);
        processPendingPayload();
    }

    /**
     * 在 chat() 结束后补一次终态更新。
     * 当前策略：
     * 1. copyContent 通过 updateCard 按 key 更新，不参与 streamingUpdate；
     * 2. 最终统一由主 content 承担 finalize。
     * 如果实时 streaming 过程中已经失败，或者卡片本身已 finalize，则直接跳过。
     */
    public synchronized void finish() throws Exception {
        if (streamingFailed || session.isFinalized()) {
            return;
        }
        flushReasoningTextBuffer();
        updateCopyContent();
        if (!session.isFinalized()) {
            dingtalkCardService.streamingUpdateAssistantReply(session, buildDisplayContent(), true);
        }
    }

    public boolean hasStreamingFailed() {
        return streamingFailed;
    }

    /**
     * 从 pendingPayload 中持续切分出“完整 JSON 对象”，并逐块处理。
     * 这里使用 while 循环，是因为一次 write 可能同时带来多个 JSON 事件。
     */
    private void processPendingPayload() {
        while (true) {
            discardNonJsonPrefix();
            int endIndex = findCompleteJsonEnd();
            if (endIndex < 0) {
                return;
            }
            String jsonBlock = pendingPayload.substring(0, endIndex);
            pendingPayload.delete(0, endIndex);
            handleJsonBlock(jsonBlock);
        }
    }

    /**
     * 丢弃 JSON 之前的噪声内容。
     * 主要处理换行、空白、[DONE] 等非 JSON 标记，保证后续解析从 '{' 开始。
     */
    private void discardNonJsonPrefix() {
        while (!pendingPayload.isEmpty()) {
            char first = pendingPayload.charAt(0);
            if (first == '{') {
                return;
            }
            if (pendingPayload.indexOf("[DONE]") == 0) {
                pendingPayload.delete(0, "[DONE]".length());
                continue;
            }
            pendingPayload.deleteCharAt(0);
        }
    }

    /**
     * 通过花括号深度判断当前缓冲区中是否已经形成一个完整 JSON 对象。
     * 这里同时处理字符串、转义字符，避免字符串里的 '{' '}' 干扰切分。
     */
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
                continue;
            }
            if (ch == '{') {
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

    /**
     * 处理单个完整 JSON 事件。
     * 当前识别 answer* / reasoningLog* 两类流式事件，
     * 分别按同样的增量提取逻辑处理 choices[0].delta.content。
     * 注意：answerEnd 不作为卡片结束标志，最终 finalize 统一由 finish() 控制。
     */
    private void handleJsonBlock(String jsonBlock) {
        try {
            JsonNode root = objectMapper.readTree(jsonBlock);
            String event = root.path("event").asText("");
            logger.info("Received event: {}, root: {}", event, root);
            switch (event) {
                case EVENT_ANSWER_START, EVENT_ANSWER_DELTA, EVENT_ANSWER_END -> handleAnswerDelta(root);
                case EVENT_REASON_START, EVENT_REASON_DELTA, EVENT_REASON_END -> handleReasonDelta(root, event);
                default -> {
                    // ignore
                }
            }
        } catch (Exception e) {
            logger.debug("Skip unparsable streaming block. block={}", jsonBlock, e);
        }
    }

    private void handleAnswerDelta(JsonNode root) {
        if (!supportsAnswerStreamingContentType(root)) {
            return;
        }

        String deltaContent = extractDeltaContent(root);
        if (deltaContent == null || deltaContent.isBlank()) {
            return;
        }

        answerBuffer.append(deltaContent);
        updateStreamingContent();
    }

    private void handleReasonDelta(JsonNode root, String event) {
        if (!supportsReasoningStreamingContentType(root)) {
            return;
        }

        String deltaContent = extractDeltaContent(root);
        String currentContentType = extractContentType(root);

        String parentOrderId = root.path("parentOrderId").asText("");
        String orderId = root.path("orderId").asText("");

        boolean isRootParentOrder = ROOT_PARENT_ORDER_ID.equals(parentOrderId);
        boolean isSameOrderId = Objects.equals(lastReasoningOrderId, orderId);

        boolean isEmptyDeltaContent = deltaContent == null || deltaContent.isBlank();
        boolean typeChanged = !Objects.equals(lastReasoningContentType, currentContentType);

        boolean isNewMessageItem = !isSameOrderId && (typeChanged || isRootParentOrder || EVENT_REASON_END.equals(event));

        if (!isEmptyDeltaContent) {
            if (hasOpenReasoningTextSegment() && (isNewMessageItem || !STYLED_REASONING_CONTENT_TYPES.contains(currentContentType))) {
                flushReasoningTextBuffer();
            }

            if (STYLED_REASONING_CONTENT_TYPES.contains(currentContentType)) {
                appendReasoningTextContent(deltaContent);
            } else {
                if (!reasoningBuffer.isEmpty()) {
                    if (isNewMessageItem) {
                        reasoningBuffer.append(MARKDOWN_LINE_BREAK);
                    }
                }
                reasoningBuffer.append(formatReasoningContent(deltaContent, currentContentType, typeChanged, isRootParentOrder));
            }
            lastReasoningContentType = currentContentType;
            lastReasoningOrderId = orderId;
        }

        if (EVENT_REASON_END.equals(event)) {
            flushReasoningTextBuffer();
        }

        if (isEmptyDeltaContent && !EVENT_REASON_END.equals(event)) {
            return;
        }

        updateStreamingContent();
    }

    private void updateStreamingContent() {
        if (streamingFailed) {
            return;
        }
        try {
            String displayContent = buildDisplayContent();
            // logger.info("updateStreamingContent, displayContent: {}", displayContent);
            // 真流式路径下，这里每收到一段增量就立即把“当前累计内容”刷到卡片上。
            dingtalkCardService.streamingUpdateAssistantReply(session, displayContent, false);
        } catch (Exception e) {
            streamingFailed = true;
            logger.warn("Streaming update failed during chat output, stop card streaming. outTrackId={}",
                    session.getOutTrackId(), e);
        }
    }

    /**
     * 统一构造卡片展示内容。
     * 只有 reasoning 与 answer 都存在时，才在二者之间插入 Markdown 分割线；
     * 这样可以避免在 answer 首段写入时污染原始 buffer，也能兼容仅有单侧内容的场景。
     */
    private String buildDisplayContent() {
        String reasoningDisplayContent = buildReasoningDisplayContent();
        if (reasoningDisplayContent.isEmpty()) {
            return answerBuffer.toString();
        }
        if (answerBuffer.isEmpty()) {
            return reasoningDisplayContent;
        }
        return reasoningDisplayContent + MARKDOWN_SECTION_SEPARATOR + answerBuffer.toString();
    }

    private void updateCopyContent() {
        if (answerBuffer.isEmpty()) {
            return;
        }
        try {
            dingtalkCardService.updateCopyContent(session, answerBuffer.toString());
        } catch (Exception e) {
            logger.warn("Update card copyContent failed, continue with content finalize. outTrackId={}",
                    session.getOutTrackId(), e);
        }
    }

    private boolean supportsAnswerStreamingContentType(JsonNode root) {
        return SUPPORTED_ANSWER_STREAMING_CONTENT_TYPES.contains(extractContentType(root));
    }

    private String extractContentType(JsonNode root) {
        return root.path("contentType").asText("");
    }

    private boolean supportsReasoningStreamingContentType(JsonNode root) {
        return SUPPORTED_REASONING_STREAMING_CONTENT_TYPES.contains(extractContentType(root));
    }

    private String buildReasoningDisplayContent() {
        if (reasoningTextBuffer.isEmpty()) {
            return reasoningBuffer.toString();
        }
        if (reasoningBuffer.isEmpty()) {
            return reasoningTextBuffer.toString() + REASONING_TEXT_STYLE_SUFFIX;
        }
        return reasoningBuffer.toString() + MARKDOWN_LINE_BREAK
                + reasoningTextBuffer + REASONING_TEXT_STYLE_SUFFIX;
    }

    private boolean hasOpenReasoningTextSegment() {
        return !reasoningTextBuffer.isEmpty();
    }

    private void appendReasoningTextContent(String deltaContent) {
        if (!hasOpenReasoningTextSegment()) {
            reasoningTextBuffer.append(REASONING_TEXT_STYLE_PREFIX)
                    .append(REASONING_TEXT_INDENT)
                    .append(escapeHtml(deltaContent));
            return;
        }
        reasoningTextBuffer.append(escapeHtml(deltaContent));
    }

    private void flushReasoningTextBuffer() {
        if (reasoningTextBuffer.isEmpty()) {
            return;
        }
        if (!reasoningBuffer.isEmpty()) {
            reasoningBuffer.append(MARKDOWN_LINE_BREAK);
        }
        reasoningBuffer.append(reasoningTextBuffer).append(REASONING_TEXT_STYLE_SUFFIX);
        reasoningTextBuffer.setLength(0);
    }

    private String formatReasoningContent(String deltaContent, String contentType, boolean typeChanged, boolean isRootParentOrder) {
        if ("3003".equals(contentType) || "3009".equals(contentType)) {
            String titlePrefix = typeChanged || isRootParentOrder ? REASONING_TITLE_MARKER : "";
            return titlePrefix + "**" + deltaContent + "**";
        }

        return deltaContent;
    }

    private String escapeHtml(String text) {
        return text
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    /**
     * 从 answerDelta 事件中提取 choices[0].delta.content。
     * 当前只关心文本增量，其它结构化内容暂不在这里处理。
     */
    private String extractDeltaContent(JsonNode root) {
        JsonNode firstChoice = root.path("choices").isArray() && !root.path("choices").isEmpty()
                ? root.path("choices").get(0)
                : null;
        if (firstChoice == null) {
            return "";
        }
        JsonNode contentNode = firstChoice.path("delta").path("content");
        if (contentNode.isMissingNode() || contentNode.isNull()) {
            return "";
        }
        return contentNode.isTextual() ? contentNode.asText() : contentNode.toString();
    }
}
