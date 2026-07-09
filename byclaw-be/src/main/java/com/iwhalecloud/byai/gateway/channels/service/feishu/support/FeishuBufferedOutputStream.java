package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Objects;
import java.util.Set;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 飞书文本回复使用的聊天输出流。
 *
 * <p>AssistantChatService 对 ByteArrayOutputStream 会写出连续 JSON 事件。
 * 钉钉通过卡片流式消费这些事件；飞书文本通道复用这份解析逻辑累计最终展示文本。
 * 子类可以通过 {@link #onDisplayContentChanged(String)} 在内容变化时触发消息更新。</p>
 */
public class FeishuBufferedOutputStream extends ByteArrayOutputStream {

    private static final Logger logger = LoggerFactory.getLogger(FeishuBufferedOutputStream.class);

    private static final String EVENT_ANSWER_START = "answerStart";
    private static final String EVENT_ANSWER_DELTA = "answerDelta";
    private static final String EVENT_ANSWER_END = "answerEnd";
    private static final String EVENT_REASON_START = "reasoningLogStart";
    private static final String EVENT_REASON_DELTA = "reasoningLogDelta";
    private static final String EVENT_REASON_END = "reasoningLogEnd";
    private static final String ROOT_PARENT_ORDER_ID = "-1";
    private static final String SECTION_SEPARATOR = "\n\n---\n\n";
    private static final Set<String> SUPPORTED_ANSWER_CONTENT_TYPES = Set.of("1001", "1002");
    private static final Set<String> SUPPORTED_REASONING_CONTENT_TYPES = Set.of("1001", "1002", "3003", "3009");

    private final ObjectMapper objectMapper;
    private final StringBuilder pendingPayload = new StringBuilder();
    private final StringBuilder reasoningBuffer = new StringBuilder();
    private final StringBuilder answerBuffer = new StringBuilder();
    private final boolean showReasoning;
    private String lastReasoningContentType;
    private String lastReasoningOrderId;

    public FeishuBufferedOutputStream(ObjectMapper objectMapper) {
        this(objectMapper, true);
    }

    public FeishuBufferedOutputStream(ObjectMapper objectMapper, boolean showReasoning) {
        this.objectMapper = objectMapper;
        this.showReasoning = showReasoning;
    }

    @Override
    public synchronized void write(byte[] b, int off, int len) {
        super.write(b, off, len);
        pendingPayload.append(new String(b, off, len, StandardCharsets.UTF_8));
        processPendingPayload();
    }

    @Override
    public synchronized void write(int b) {
        super.write(b);
        pendingPayload.append((char) b);
        processPendingPayload();
    }

    public synchronized String getDisplayContent() {
        if (reasoningBuffer.isEmpty()) {
            return answerBuffer.toString();
        }
        if (answerBuffer.isEmpty()) {
            return reasoningBuffer.toString();
        }
        return reasoningBuffer + SECTION_SEPARATOR + answerBuffer;
    }

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
     * 按 JSON 花括号深度切分完整对象；同时处理字符串转义，避免正文里的括号误判。
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

    private void handleJsonBlock(String jsonBlock) {
        try {
            JsonNode root = objectMapper.readTree(jsonBlock);
            String event = root.path("event").asText("");
            switch (event) {
                case EVENT_ANSWER_START, EVENT_ANSWER_DELTA, EVENT_ANSWER_END -> handleAnswerDelta(root);
                case EVENT_REASON_START, EVENT_REASON_DELTA, EVENT_REASON_END -> handleReasonDelta(root, event);
                default -> {
                    // 非 answer/reasoning 事件对飞书文本展示没有贡献，直接忽略。
                }
            }
        } catch (Exception e) {
            logger.debug("Skip unparsable Feishu output block. block={}", jsonBlock, e);
        }
    }

    private void handleAnswerDelta(JsonNode root) {
        if (!SUPPORTED_ANSWER_CONTENT_TYPES.contains(extractContentType(root))) {
            return;
        }
        String deltaContent = extractDeltaContent(root);
        if (deltaContent == null || deltaContent.isBlank()) {
            return;
        }
        answerBuffer.append(deltaContent);
        notifyDisplayContentChanged();
    }

    private void handleReasonDelta(JsonNode root, String event) {
        if (!showReasoning) {
            return;
        }
        if (!SUPPORTED_REASONING_CONTENT_TYPES.contains(extractContentType(root))) {
            return;
        }

        String deltaContent = extractDeltaContent(root);
        if (deltaContent == null || deltaContent.isBlank()) {
            return;
        }

        String currentContentType = extractContentType(root);
        String parentOrderId = root.path("parentOrderId").asText("");
        String orderId = root.path("orderId").asText("");
        boolean isRootParentOrder = ROOT_PARENT_ORDER_ID.equals(parentOrderId);
        boolean isSameOrderId = Objects.equals(lastReasoningOrderId, orderId);
        boolean typeChanged = !Objects.equals(lastReasoningContentType, currentContentType);
        boolean isNewMessageItem = !isSameOrderId && (typeChanged || isRootParentOrder || EVENT_REASON_END.equals(event));

        if (!reasoningBuffer.isEmpty() && isNewMessageItem) {
            reasoningBuffer.append("\n\n");
        }
        reasoningBuffer.append(deltaContent);
        lastReasoningContentType = currentContentType;
        lastReasoningOrderId = orderId;
        notifyDisplayContentChanged();
    }

    private void notifyDisplayContentChanged() {
        onDisplayContentChanged(getDisplayContent());
    }

    protected void onDisplayContentChanged(String displayContent) {
        // 默认只累计内容；流式子类会覆写这里，把累计内容同步到飞书消息。
    }

    private String extractContentType(JsonNode root) {
        return root.path("contentType").asText("");
    }

    /**
     * 从 answerDelta/reasoningLogDelta 事件里提取真正要展示的文本。
     *
     * <p>当前聊天输出遵循 OpenAI SSE 风格：正文位于 choices[0].delta.content。
     * 这里不直接链式 asText("")，是为了在 choices 为空、content 缺失或 content 为结构化 JSON 时，
     * 都能给出明确的空值或可读字符串，避免飞书最终误回兜底文案。</p>
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
