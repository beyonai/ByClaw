package com.iwhalecloud.byai.manager.domain.tenant;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;

/** Adapts plain worker replies to the existing chat history rendering contract. */
final class TenantChatHistoryProjection {

    private static final Pattern THINK_BLOCK = Pattern.compile("(?s)^\\s*<think>(.*?)</think>\\s*");
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private TenantChatHistoryProjection() {
    }

    static MessageView project(MessageView message) {
        if (message != null) {
            message.setMessageStruct(numericRenderSequences(message.getMessageStruct()));
            message.setInferLog(numericRenderSequences(message.getInferLog()));
        }
        if (message == null || !("assistant".equals(message.getRole())
            || Integer.valueOf(2).equals(message.getUsage()))
            || message.getMessageStruct() != null && !message.getMessageStruct().isBlank()) {
            return message;
        }
        String content = message.getMessageContent();
        if (content == null || content.isBlank()) return message;

        Matcher thinking = THINK_BLOCK.matcher(content);
        if (thinking.find()) {
            message.setInferLog(textEvent(1001, thinking.group(1)));
            content = content.substring(thinking.end()).trim();
        }
        if (!content.isBlank()) message.setMessageStruct(textEvent(1002, content));
        return message;
    }

    static List<MessageView> project(List<MessageView> messages) {
        if (messages != null) messages.forEach(TenantChatHistoryProjection::project);
        return messages;
    }

    /** Read old Node mirrors without converting their opaque IDs or modifying stored history. */
    private static String numericRenderSequences(String value) {
        if (value == null || value.isBlank()) return value;
        try {
            var records = MAPPER.readTree(value);
            if (!records.isArray()) return value;
            boolean changed = false;
            for (var record : records) {
                var seq = record.get("seq");
                if (record.isObject() && seq != null && seq.isTextual() && seq.textValue().matches("[0-9]{1,16}")) {
                    long number = Long.parseLong(seq.textValue());
                    if (number <= 9007199254740991L) {
                        ((com.fasterxml.jackson.databind.node.ObjectNode) record).put("seq", number);
                        changed = true;
                    }
                }
            }
            return changed ? MAPPER.writeValueAsString(records) : value;
        } catch (JsonProcessingException error) {
            return value;
        }
    }

    private static String textEvent(int contentType, String content) {
        try {
            return MAPPER.writeValueAsString(List.of(new TextEvent(contentType,
                List.of(new Choice(new Delta(content))))));
        } catch (JsonProcessingException error) {
            throw new IllegalStateException("Could not encode tenant chat history", error);
        }
    }

    private record TextEvent(int contentType, List<Choice> choices) {
    }

    private record Choice(Delta delta) {
    }

    private record Delta(String content) {
    }
}
