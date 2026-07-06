package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuMsgType;
import org.springframework.stereotype.Service;

/**
 * 解析飞书事件回调。
 *
 * <p>当前按飞书 v2 事件结构读取：
 * header 中放 event_id/app_id/event_type，event.message 中放 message_id/chat_id/content。
 * 如果后续接入飞书加密事件，应先在 Controller 层完成解密，再把明文 JsonNode 交给此解析器。</p>
 */
@Service
public class FeishuCallbackMessageParser {

    private final ObjectMapper objectMapper;

    public FeishuCallbackMessageParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public FeishuCallbackMessage parse(JsonNode root) {
        FeishuCallbackMessage message = new FeishuCallbackMessage();
        JsonNode header = root.path("header");
        JsonNode event = root.path("event");
        JsonNode messageNode = event.path("message");
        JsonNode senderId = event.path("sender").path("sender_id");

        message.setEventId(header.path("event_id").asText(""));
        message.setAppId(header.path("app_id").asText(""));
        message.setTenantKey(header.path("tenant_key").asText(""));
        message.setMessageId(messageNode.path("message_id").asText(""));
        message.setChatId(messageNode.path("chat_id").asText(""));
        message.setChatType(messageNode.path("chat_type").asText(""));
        message.setMessageType(messageNode.path("message_type").asText(""));
        message.setTextContent(extractTextContent(messageNode.path("content"), message.getMessageType()));
        message.setSenderOpenId(senderId.path("open_id").asText(""));
        message.setSenderUnionId(senderId.path("union_id").asText(""));
        message.setSenderUserId(senderId.path("user_id").asText(""));
        message.setSenderType(event.path("sender").path("sender_type").asText(""));
        message.setRawEvent(event);
        return message;
    }

    private String extractTextContent(JsonNode contentNode, String messageType) {
        if (!FeishuMsgType.TEXT.matches(messageType)) {
            return "";
        }
        String rawContent = contentNode.isTextual() ? contentNode.asText("") : contentNode.toString();
        if (rawContent.isBlank()) {
            return "";
        }
        try {
            return objectMapper.readTree(rawContent).path("text").asText("");
        } catch (Exception e) {
            return "";
        }
    }
}
