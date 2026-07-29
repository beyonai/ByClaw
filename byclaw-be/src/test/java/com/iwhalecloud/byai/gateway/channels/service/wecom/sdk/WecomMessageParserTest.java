package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Callback body binding checks for {@link WecomMessageParser}, including the
 * {@code response_url} field (the temporary proactive-reply URL WeCom puts on
 * message callbacks) which was previously dropped during parsing.
 */
class WecomMessageParserTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final WecomMessageParser parser = new WecomMessageParser();

    private WecomWsFrame frameOf(String bodyJson) throws Exception {
        JsonNode body = mapper.readTree(bodyJson);
        WecomWsFrame frame = new WecomWsFrame();
        WecomWsFrame.Headers headers = new WecomWsFrame.Headers();
        headers.setReqId("req-1");
        frame.setHeaders(headers);
        frame.setBody(body);
        return frame;
    }

    @Test
    void bindsResponseUrlAndCoreFields() throws Exception {
        WecomWsFrame frame = frameOf("""
                {
                  "msgid": "m1",
                  "aibotid": "bot1",
                  "chatid": "c1",
                  "chattype": "single",
                  "from": {"userid": "u1"},
                  "response_url": "https://qyapi.weixin.qq.com/cgi-bin/aibot/reply?code=abc",
                  "msgtype": "text",
                  "text": {"content": "hi"}
                }
                """);

        WecomCallbackMessage msg = parser.parseCallback(frame);

        assertThat(msg.getResponseUrl())
                .isEqualTo("https://qyapi.weixin.qq.com/cgi-bin/aibot/reply?code=abc");
        assertThat(msg.getMsgId()).isEqualTo("m1");
        assertThat(msg.getFromUserId()).isEqualTo("u1");
        assertThat(msg.getTextContent()).isEqualTo("hi");
    }

    @Test
    void responseUrlIsNullWhenAbsent() throws Exception {
        WecomWsFrame frame = frameOf("""
                {"msgid": "m2", "msgtype": "text", "text": {"content": "hey"}}
                """);

        WecomCallbackMessage msg = parser.parseCallback(frame);

        assertThat(msg.getResponseUrl()).isNull();
        assertThat(msg.getTextContent()).isEqualTo("hey");
    }
}
