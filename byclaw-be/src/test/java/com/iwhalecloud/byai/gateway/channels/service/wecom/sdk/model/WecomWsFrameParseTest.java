package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Task 2 verification: the two-stage parse contract holds for the three frame
 * kinds — message callback, event callback, and cmd-less ACK. Uses a plain
 * (default camelCase) ObjectMapper to mirror be's Jackson config.
 */
class WecomWsFrameParseTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void parsesMessageCallbackEnvelopeAndKeepsBodyRaw() throws Exception {
        String json = """
                {
                  "cmd": "aibot_msg_callback",
                  "headers": { "req_id": "cb_123" },
                  "body": {
                    "msgid": "m1",
                    "aibotid": "bot1",
                    "chattype": "single",
                    "msgtype": "text",
                    "from": { "userid": "u1" },
                    "text": { "content": "hello" }
                  }
                }
                """;
        WecomWsFrame frame = mapper.readValue(json, WecomWsFrame.class);

        assertThat(frame.getCmd()).isEqualTo("aibot_msg_callback");
        assertThat(frame.isAck()).isFalse();
        assertThat(frame.reqId()).isEqualTo("cb_123");
        // body stays a raw JsonNode — bind by msgtype downstream, not in one pass.
        assertThat(frame.getBody()).isNotNull();
        assertThat(frame.getBody().path("msgtype").asText()).isEqualTo("text");
        assertThat(frame.getBody().path("text").path("content").asText()).isEqualTo("hello");
        assertThat(frame.getBody().path("from").path("userid").asText()).isEqualTo("u1");
    }

    @Test
    void parsesEventCallbackAndReadsEventtype() throws Exception {
        String json = """
                {
                  "cmd": "aibot_event_callback",
                  "headers": { "req_id": "evt_9" },
                  "body": {
                    "msgid": "e1",
                    "msgtype": "event",
                    "event": { "eventtype": "disconnected_event" }
                  }
                }
                """;
        WecomWsFrame frame = mapper.readValue(json, WecomWsFrame.class);

        assertThat(frame.getCmd()).isEqualTo("aibot_event_callback");
        assertThat(frame.isAck()).isFalse();
        // eventtype detected before any business binding.
        assertThat(frame.getBody().path("event").path("eventtype").asText())
                .isEqualTo("disconnected_event");
    }

    @Test
    void parsesAckFrameWithNoCmdOrBody() throws Exception {
        String json = """
                {
                  "headers": { "req_id": "aibot_subscribe_1700000000_ab12" },
                  "errcode": 0,
                  "errmsg": "ok"
                }
                """;
        WecomWsFrame frame = mapper.readValue(json, WecomWsFrame.class);

        assertThat(frame.getCmd()).isNull();
        assertThat(frame.getBody()).isNull();
        assertThat(frame.isAck()).isTrue();
        assertThat(frame.isSuccess()).isTrue();
        assertThat(frame.reqId()).startsWith("aibot_subscribe_");
    }

    @Test
    void ackWithNonZeroErrcodeIsNotSuccess() throws Exception {
        String json = """
                { "headers": { "req_id": "ping_1_x" }, "errcode": 40001, "errmsg": "bad token" }
                """;
        WecomWsFrame frame = mapper.readValue(json, WecomWsFrame.class);

        assertThat(frame.isAck()).isTrue();
        assertThat(frame.isSuccess()).isFalse();
        assertThat(frame.getErrmsg()).isEqualTo("bad token");
    }

    @Test
    void unknownHeaderFieldsAreToleratedForForwardCompat() throws Exception {
        String json = """
                {
                  "cmd": "aibot_msg_callback",
                  "headers": { "req_id": "cb_x", "trace_id": "t-1", "future": 42 },
                  "body": { "msgtype": "text", "brand_new_field": true }
                }
                """;
        WecomWsFrame frame = mapper.readValue(json, WecomWsFrame.class);

        assertThat(frame.reqId()).isEqualTo("cb_x");
        assertThat(frame.getHeaders().getExtra()).containsKey("trace_id");
        // unknown body fields survive because body is a raw JsonNode.
        assertThat(frame.getBody().path("brand_new_field").asBoolean()).isTrue();
    }

    @Test
    void msgTypeAndChatTypeEnumsResolveFromCode() {
        assertThat(WecomMsgType.fromCode("text")).isEqualTo(WecomMsgType.TEXT);
        assertThat(WecomMsgType.fromCode("event")).isEqualTo(WecomMsgType.EVENT);
        assertThat(WecomMsgType.fromCode("nope")).isNull();
        assertThat(WecomChatType.fromCode("group")).isEqualTo(WecomChatType.GROUP);
        assertThat(WecomChatType.SINGLE.matches("single")).isTrue();
    }
}
