package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * 统一发送钉钉文本回复消息。
 */
@Service
public class DingtalkReplyDispatcher {

    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final String DEFAULT_FALLBACK_REPLY_KEY = "channel.error.retry";

    private final OkHttpClient okHttpClient;
    private final ObjectMapper objectMapper;

    public DingtalkReplyDispatcher(ObjectMapper objectMapper, DingtalkHttpClientFactory httpClientFactory) {
        this.objectMapper = objectMapper;
        this.okHttpClient = httpClientFactory.webhookClient();
    }

    public void sendTextMessage(String webhook, String replyContent) throws IOException {
        Map<String, Object> requestBodyMap = new HashMap<>();
        requestBodyMap.put("msgtype", "text");

        Map<String, Object> text = new HashMap<>();
        text.put("content", normalizeReplyContent(replyContent));
        requestBodyMap.put("text", text);

        String jsonBody = toJson(requestBodyMap);
        RequestBody body = RequestBody.create(jsonBody, JSON_MEDIA_TYPE);
        Request request = new Request.Builder().url(webhook).post(body).build();
        try (Response response = okHttpClient.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("DingTalk webhook reply failed, httpCode=" + response.code());
            }
            if (response.body() != null) {
                com.fasterxml.jackson.databind.JsonNode result = objectMapper.readTree(response.body().string());
                if (result != null && result.path("errcode").asInt(0) != 0) {
                    throw new IOException("DingTalk webhook reply failed, errcode=" + result.path("errcode").asText());
                }
            }
        }
    }

    private String normalizeReplyContent(String replyContent) {
        return replyContent == null || replyContent.isBlank() ? I18nUtil.get(DEFAULT_FALLBACK_REPLY_KEY) : replyContent;
    }

    private String toJson(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(data);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Serialize reply payload failed", e);
        }
    }
}
