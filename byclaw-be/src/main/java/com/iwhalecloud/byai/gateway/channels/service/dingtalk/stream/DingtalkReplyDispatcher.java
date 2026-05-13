package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;

/**
 * 统一发送钉钉文本回复消息。
 */
@Service
public class DingtalkReplyDispatcher {

    private static final Logger logger = LoggerFactory.getLogger(DingtalkReplyDispatcher.class);
    private static final MediaType JSON_MEDIA_TYPE = MediaType.parse("application/json; charset=utf-8");
    private static final String DEFAULT_FALLBACK_REPLY = "抱歉，遇到了点问题，请稍后再试";

    private final OkHttpClient okHttpClient = new OkHttpClient();
    private final ObjectMapper objectMapper;

    public DingtalkReplyDispatcher(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
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
                String responseBody = response.body() == null ? "" : response.body().string();
                logger.warn("DingTalk webhook reply failed, code={}, body={}", response.code(), responseBody);
            }
        }
    }

    private String normalizeReplyContent(String replyContent) {
        return replyContent == null || replyContent.isBlank() ? DEFAULT_FALLBACK_REPLY : replyContent;
    }

    private String toJson(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(data);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Serialize reply payload failed", e);
        }
    }
}
