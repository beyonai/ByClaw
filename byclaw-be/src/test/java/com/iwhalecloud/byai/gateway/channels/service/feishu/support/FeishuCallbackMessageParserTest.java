package com.iwhalecloud.byai.gateway.channels.service.feishu.support;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import org.junit.jupiter.api.Test;

class FeishuCallbackMessageParserTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final FeishuCallbackMessageParser parser = new FeishuCallbackMessageParser(objectMapper);

    @Test
    void parse_marksGroupMessageMentionedWhenRawCallbackUsesAppMention() throws Exception {
        FeishuCallbackMessage message = parser.parse(objectMapper.readTree("""
                {
                  "header": {
                    "event_id": "evt-1",
                    "event_type": "im.message.receive_v1",
                    "app_id": "cli_1"
                  },
                  "event": {
                    "sender": {
                      "sender_type": "user",
                      "sender_id": {"open_id": "ou_1"}
                    },
                    "message": {
                      "message_id": "om_1",
                      "chat_type": "group",
                      "message_type": "text",
                      "content": "{\\"text\\":\\"@_user_1 你好\\"}",
                      "mentions": [
                        {
                          "key": "@_user_1",
                          "mentioned_type": "app",
                          "name": "byai测试"
                        }
                      ]
                    }
                  }
                }
                """));

        assertTrue(message.isMentionedBot());
        assertEquals("你好", message.getTextContent());
    }

    @Test
    void parse_marksGroupMessageMentionedWhenLongConnectionUsesSdkFieldName() throws Exception {
        FeishuCallbackMessage message = parser.parse(objectMapper.readTree("""
                {
                  "header": {
                    "event_id": "evt-1",
                    "event_type": "im.message.receive_v1",
                    "app_id": "cli_1"
                  },
                  "event": {
                    "sender": {
                      "sender_type": "user",
                      "sender_id": {"open_id": "ou_1"}
                    },
                    "message": {
                      "message_id": "om_1",
                      "chat_type": "group",
                      "message_type": "text",
                      "content": "{\\"text\\":\\"@byai测试 你好\\"}",
                      "mentions": [
                        {
                          "key": "@_user_1",
                          "mentionedType": "app",
                          "name": "byai测试"
                        }
                      ]
                    }
                  }
                }
                """));

        assertTrue(message.isMentionedBot());
        assertEquals("你好", message.getTextContent());
    }

    @Test
    void parse_keepsGroupMessageUnmentionedWhenMentionsAreMissing() throws Exception {
        FeishuCallbackMessage message = parser.parse(objectMapper.readTree("""
                {
                  "header": {
                    "event_id": "evt-1",
                    "event_type": "im.message.receive_v1",
                    "app_id": "cli_1"
                  },
                  "event": {
                    "sender": {
                      "sender_type": "user",
                      "sender_id": {"open_id": "ou_1"}
                    },
                    "message": {
                      "message_id": "om_1",
                      "chat_type": "group",
                      "message_type": "text",
                      "content": "{\\"text\\":\\"普通群消息\\"}"
                    }
                  }
                }
                """));

        assertFalse(message.isMentionedBot());
        assertEquals("普通群消息", message.getTextContent());
    }
}
