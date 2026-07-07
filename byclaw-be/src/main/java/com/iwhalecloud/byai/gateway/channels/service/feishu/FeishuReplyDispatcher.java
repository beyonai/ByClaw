package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

/**
 * 飞书消息发送器。
 *
 * <p>当前统一封装飞书文本消息和卡片消息。
 * 流式回复会先创建一张机器人卡片，再用飞书「更新消息」接口不断覆盖这张卡片内容，
 * 因此调用方需要拿到创建消息后返回的 message_id。</p>
 */
@Service
public class FeishuReplyDispatcher {

    private static final Logger logger = LoggerFactory.getLogger(FeishuReplyDispatcher.class);
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final String DEFAULT_FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试";
    private static final String MESSAGE_REPLY_URL_PREFIX = "https://open.feishu.cn/open-apis/im/v1/messages/";
    private static final String MESSAGE_REPLY_URL_SUFFIX = "/reply";
    private static final String MESSAGE_SEND_URL = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id";

    private final OkHttpClient okHttpClient = new OkHttpClient();
    private final ObjectMapper objectMapper;

    public FeishuReplyDispatcher(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public String replyTextMessage(String tenantAccessToken, String messageId, String replyContent) throws IOException {
        if (!StringUtils.hasText(messageId)) {
            throw new IllegalArgumentException("Feishu messageId is empty");
        }
        String url = MESSAGE_REPLY_URL_PREFIX + encodePath(messageId) + MESSAGE_REPLY_URL_SUFFIX;
        return extractMessageId(doPostMessage(tenantAccessToken, url, buildTextMessageBody(normalizeReplyContent(replyContent))));
    }

    public String sendTextMessage(String tenantAccessToken, String chatId, String replyContent) throws IOException {
        if (!StringUtils.hasText(chatId)) {
            throw new IllegalArgumentException("Feishu chatId is empty");
        }
        Map<String, Object> body = buildTextMessageBody(normalizeReplyContent(replyContent));
        body.put("receive_id", chatId);
        return extractMessageId(doPostMessage(tenantAccessToken, MESSAGE_SEND_URL, body));
    }

    public String replyCardMessage(
            String tenantAccessToken,
            String messageId,
            String title,
            String replyContent
    ) throws IOException {
        if (!StringUtils.hasText(messageId)) {
            throw new IllegalArgumentException("Feishu messageId is empty");
        }
        String url = MESSAGE_REPLY_URL_PREFIX + encodePath(messageId) + MESSAGE_REPLY_URL_SUFFIX;
        return extractMessageId(doPostMessage(tenantAccessToken, url, buildCardMessageBody(title, replyContent)));
    }

    public void updateCardMessage(
            String tenantAccessToken,
            String messageId,
            String title,
            String replyContent
    ) throws IOException {
        if (!StringUtils.hasText(messageId)) {
            throw new IllegalArgumentException("Feishu messageId is empty");
        }
        String url = MESSAGE_REPLY_URL_PREFIX + encodePath(messageId);
        doPatchMessage(tenantAccessToken, url, buildCardMessageUpdateBody(title, replyContent));
    }

    private Map<String, Object> buildTextMessageBody(String content) {
        Map<String, Object> text = new HashMap<>();
        text.put("text", content);

        Map<String, Object> body = new HashMap<>();
        body.put("msg_type", "text");
        body.put("content", toJson(text));
        return body;
    }

    private Map<String, Object> buildCardMessageBody(String title, String content) {
        Map<String, Object> body = new HashMap<>();
        body.put("msg_type", "interactive");
        body.put("content", buildCardContent(title, content));
        return body;
    }

    private Map<String, Object> buildCardMessageUpdateBody(String title, String content) {
        Map<String, Object> body = new HashMap<>();
        body.put("content", buildCardContent(title, content));
        return body;
    }

    /**
     * 飞书更新消息接口只能更新卡片消息；文本消息会返回 "This message is NOT a card"。
     * 因此流式回复统一使用 interactive 卡片，正文放到 markdown 元素里持续覆盖。
     */
    private String buildCardContent(String title, String content) {
        Map<String, Object> card = new LinkedHashMap<>();

        Map<String, Object> config = new HashMap<>();
        config.put("wide_screen_mode", true);
        card.put("config", config);

        if (StringUtils.hasText(title)) {
            Map<String, Object> titleNode = new HashMap<>();
            titleNode.put("tag", "plain_text");
            titleNode.put("content", title);

            Map<String, Object> header = new HashMap<>();
            header.put("title", titleNode);
            card.put("header", header);
        }

        Map<String, Object> markdown = new HashMap<>();
        markdown.put("tag", "markdown");
        markdown.put("content", normalizeReplyContent(content));

        List<Map<String, Object>> elements = new ArrayList<>();
        elements.add(markdown);
        card.put("elements", elements);

        return toJson(card);
    }

    private JsonNode doPostMessage(String tenantAccessToken, String url, Map<String, Object> body) throws IOException {
        return doMessageRequest(tenantAccessToken, url, "POST", body);
    }

    private JsonNode doPatchMessage(String tenantAccessToken, String url, Map<String, Object> body) throws IOException {
        return doMessageRequest(tenantAccessToken, url, "PATCH", body);
    }

    private JsonNode doMessageRequest(String tenantAccessToken, String url, String method, Map<String, Object> body) throws IOException {
        if (!StringUtils.hasText(tenantAccessToken)) {
            throw new IllegalArgumentException("Feishu tenantAccessToken is empty");
        }

        RequestBody requestBody = RequestBody.create(toJson(body), JSON_MEDIA_TYPE);
        Request.Builder requestBuilder = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + tenantAccessToken)
                .header("Content-Type", "application/json; charset=utf-8");

        Request request = "PATCH".equalsIgnoreCase(method)
                ? requestBuilder.method("PATCH", requestBody).build()
                : requestBuilder.post(requestBody).build();

        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException("Feishu message API returned " + response.code() + ": " + responseBody);
            }
            JsonNode root = objectMapper.readTree(responseBody);
            if (root.path("code").asInt(-1) != 0) {
                logger.warn("Feishu message API failed, code={}, msg={}, body={}",
                        root.path("code").asInt(), root.path("msg").asText(""), responseBody);
                throw new IOException("Feishu message API failed, code="
                        + root.path("code").asInt() + ", msg=" + root.path("msg").asText(""));
            }
            return root;
        }
    }

    private String extractMessageId(JsonNode root) {
        String messageId = root.path("data").path("message_id").asText("");
        if (StringUtils.hasText(messageId)) {
            return messageId;
        }
        return root.path("data").path("message").path("message_id").asText("");
    }

    private String normalizeReplyContent(String replyContent) {
        return replyContent == null || replyContent.isBlank() ? DEFAULT_FALLBACK_REPLY : replyContent;
    }

    private String encodePath(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private String toJson(Object data) {
        try {
            return objectMapper.writeValueAsString(data);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Serialize Feishu message payload failed", e);
        }
    }
}
