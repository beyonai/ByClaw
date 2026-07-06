package com.iwhalecloud.byai.gateway.channels.service.feishu;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
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
 * <p>MVP 使用文本回复：优先按 message_id 回复原消息，失败时可由调用方选择按 chat_id 发送普通消息。
 * 后续如果要做飞书卡片或流式更新，建议新增 card service，不要把卡片细节塞进这个文本发送器。</p>
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

    public void replyTextMessage(String tenantAccessToken, String messageId, String replyContent) throws IOException {
        if (!StringUtils.hasText(messageId)) {
            throw new IllegalArgumentException("Feishu messageId is empty");
        }
        String url = MESSAGE_REPLY_URL_PREFIX + encodePath(messageId) + MESSAGE_REPLY_URL_SUFFIX;
        doPostMessage(tenantAccessToken, url, buildTextMessageBody(normalizeReplyContent(replyContent)));
    }

    public void sendTextMessage(String tenantAccessToken, String chatId, String replyContent) throws IOException {
        if (!StringUtils.hasText(chatId)) {
            throw new IllegalArgumentException("Feishu chatId is empty");
        }
        Map<String, Object> body = buildTextMessageBody(normalizeReplyContent(replyContent));
        body.put("receive_id", chatId);
        doPostMessage(tenantAccessToken, MESSAGE_SEND_URL, body);
    }

    private Map<String, Object> buildTextMessageBody(String content) {
        Map<String, Object> text = new HashMap<>();
        text.put("text", content);

        Map<String, Object> body = new HashMap<>();
        body.put("msg_type", "text");
        body.put("content", toJson(text));
        return body;
    }

    private void doPostMessage(String tenantAccessToken, String url, Map<String, Object> body) throws IOException {
        if (!StringUtils.hasText(tenantAccessToken)) {
            throw new IllegalArgumentException("Feishu tenantAccessToken is empty");
        }

        RequestBody requestBody = RequestBody.create(toJson(body), JSON_MEDIA_TYPE);
        Request request = new Request.Builder()
                .url(url)
                .header("Authorization", "Bearer " + tenantAccessToken)
                .header("Content-Type", "application/json; charset=utf-8")
                .post(requestBody)
                .build();

        try (Response response = okHttpClient.newCall(request).execute()) {
            String responseBody = response.body() == null ? "" : response.body().string();
            if (!response.isSuccessful()) {
                throw new IOException("Feishu message API returned " + response.code() + ": " + responseBody);
            }
            JsonNode root = objectMapper.readTree(responseBody);
            if (root.path("code").asInt(-1) != 0) {
                logger.warn("Feishu message API failed, code={}, msg={}, body={}",
                        root.path("code").asInt(), root.path("msg").asText(""), responseBody);
            }
        }
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
