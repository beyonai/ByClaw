package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuMsgType;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

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
        message.setMentions(messageNode.path("mentions"));
        message.setMentionedBot(isMentionedBot(messageNode.path("mentions"), message.getAppId()));
        message.setTextContent(removeMentionText(
                extractTextContent(messageNode.path("content"), message.getMessageType()),
                messageNode.path("mentions")
        ));
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

    /**
     * 飞书群聊长连接会把普通群消息也推给应用，所以业务侧必须自己判断是否 @ 机器人。
     *
     * <p>SDK 对 mention 字段做 Jackson 序列化时字段名是 mentionedType；HTTP 回调原始 JSON
     * 使用 mentioned_type。这里两个都兼容。通常 @ 机器人时 mentionedType=app；如果事件里
     * 直接带 app_id，也用当前 appId 做一次精确匹配。</p>
     */
    private boolean isMentionedBot(JsonNode mentionsNode, String appId) {
        if (mentionsNode == null || !mentionsNode.isArray() || mentionsNode.isEmpty()) {
            return false;
        }
        for (JsonNode mentionNode : mentionsNode) {
            if (isCurrentAppMention(mentionNode, appId) || isBotTypeMention(mentionNode)) {
                return true;
            }
        }
        return false;
    }

    private boolean isCurrentAppMention(JsonNode mentionNode, String appId) {
        if (!StringUtils.hasText(appId) || mentionNode == null || mentionNode.isMissingNode()) {
            return false;
        }
        return appId.equals(mentionNode.path("app_id").asText(""))
                || appId.equals(mentionNode.path("appId").asText(""))
                || appId.equals(mentionNode.path("id").path("app_id").asText(""))
                || appId.equals(mentionNode.path("id").path("appId").asText(""));
    }

    private boolean isBotTypeMention(JsonNode mentionNode) {
        if (mentionNode == null || mentionNode.isMissingNode()) {
            return false;
        }
        String mentionedType = mentionNode.path("mentioned_type").asText("");
        if (!StringUtils.hasText(mentionedType)) {
            mentionedType = mentionNode.path("mentionedType").asText("");
        }
        return "app".equalsIgnoreCase(mentionedType)
                || "bot".equalsIgnoreCase(mentionedType)
                || "robot".equalsIgnoreCase(mentionedType);
    }

    /**
     * content.text 里常带有 @_user_1 或 @机器人名称，真实提问不应该把这段前缀发给数字员工。
     */
    private String removeMentionText(String textContent, JsonNode mentionsNode) {
        if (!StringUtils.hasText(textContent)
                || mentionsNode == null
                || !mentionsNode.isArray()
                || mentionsNode.isEmpty()) {
            return textContent;
        }
        String result = textContent;
        for (JsonNode mentionNode : mentionsNode) {
            result = removeMentionToken(result, mentionNode.path("key").asText(""));
            result = removeMentionToken(result, "@" + mentionNode.path("name").asText(""));
        }
        return result.strip();
    }

    private String removeMentionToken(String source, String token) {
        if (!StringUtils.hasText(source) || !StringUtils.hasText(token)) {
            return source;
        }
        return source.replace(token, "").strip();
    }
}
