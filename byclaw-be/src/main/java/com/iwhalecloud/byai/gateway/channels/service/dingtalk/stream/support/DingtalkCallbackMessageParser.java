package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support;

import java.util.Collection;
import java.util.Map;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkMsgType;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

/**
 * 解析钉钉 Stream 回调原始 Map，产出业务层可直接使用的 {@link DingtalkCallbackMessage}。
 */
@Service
public class DingtalkCallbackMessageParser {

    private final ObjectMapper objectMapper;

    public DingtalkCallbackMessageParser(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 从回调数据中抽取业务关心的字段并封装。
     *
     * @param callbackData 钉钉 Stream 回调原始 Map
     * @return 封装后的消息对象；入参为 null 时返回全空字段对象
     */
    public DingtalkCallbackMessage parse(Map<String, Object> callbackData) {
        DingtalkCallbackMessage message = new DingtalkCallbackMessage();
        if (callbackData == null || callbackData.isEmpty()) {
            message.setMsgId("");
            message.setSessionWebhook("");
            message.setConversationType("");
            message.setConversationId("");
            message.setSenderStaffId("");
            message.setRobotCode("");
            message.setMsgtype("");
            return message;
        }

        message.setMsgId(resolveMsgId(callbackData));
        message.setSessionWebhook(getAsText(callbackData, "sessionWebhook"));
        message.setConversationType(getAsText(callbackData, "conversationType"));
        message.setConversationId(getAsText(callbackData, "conversationId"));
        message.setSenderStaffId(getAsText(callbackData, "senderStaffId"));
        message.setRobotCode(getAsText(callbackData, "robotCode"));
        message.setMsgtype(getAsText(callbackData, "msgtype"));
        message.setTextContent(extractContent(callbackData, message.getMsgtype()));
        message.setContent(callbackData.get("content"));
        return message;
    }

    private String resolveMsgId(Map<String, Object> callbackData) {
        String msgId = getAsText(callbackData, "msgId");
        if (!msgId.isBlank()) {
            return msgId;
        }
        Object headersNode = callbackData.get("headers");
        if (headersNode instanceof Map<?, ?> headersMap) {
            Object messageId = headersMap.get("messageId");
            return messageId == null ? "" : String.valueOf(messageId);
        }
        return "";
    }

    private String extractContent(Map<String, Object> callbackData, String msgtype) {
        if (DingtalkMsgType.TEXT.matches(msgtype)) {
            return extractTextContent(callbackData.get("text"));
        }
        if (DingtalkMsgType.RICH_TEXT.matches(msgtype)) {
            return extractRichTextContent(callbackData.get("content"));
        }
        if (DingtalkMsgType.AUDIO.matches(msgtype)) {
            return extractAudioRecognition(callbackData.get("content"));
        }
        return "";
    }

    private String extractTextContent(Object textNode) {
        if (textNode instanceof Map<?, ?> textMap) {
            Object content = textMap.get("content");
            return content == null ? "" : String.valueOf(content);
        }
        return "";
    }

    private String extractRichTextContent(Object contentNode) {
        if (!(contentNode instanceof Map<?, ?> contentMap)) {
            return "";
        }
        Object richTextNode = contentMap.get("richText");
        if (!(richTextNode instanceof Collection<?> richTextItems)) {
            return "";
        }

        StringBuilder builder = new StringBuilder();
        for (Object richTextItem : richTextItems) {
            if (!(richTextItem instanceof Map<?, ?> itemMap)) {
                continue;
            }
            Object text = itemMap.get("text");
            if (text == null) {
                continue;
            }
            String textValue = String.valueOf(text);
            if (textValue.isBlank()) {
                continue;
            }
            if (builder.length() > 0) {
                builder.append('\n');
            }
            builder.append(textValue);
        }
        return builder.toString();
    }

    private String extractAudioRecognition(Object contentNode) {
        if (contentNode instanceof Map<?, ?> contentMap) {
            Object recognition = contentMap.get("recognition");
            return recognition == null ? "" : String.valueOf(recognition);
        }
        return "";
    }

    private String getAsText(Map<String, Object> source, String key) {
        Object value = source.get(key);
        return value == null ? "" : String.valueOf(value);
    }
}
