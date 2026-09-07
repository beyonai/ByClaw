package com.iwhalecloud.byai.state.domain.chat.service;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

import io.netty.channel.Channel;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class ScriptServiceBroadcastTest {

    @Test
    void broadcastInitialization_preservesTraceAndRequestIdentity() {
        MultiDeviceBroadcastService broadcastService = mock(MultiDeviceBroadcastService.class);
        ScriptService scriptService = new ScriptService();
        ReflectionTestUtils.setField(scriptService, "multiDeviceBroadcastService", broadcastService);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        context.userId = 7L;
        context.sessionId = 101L;
        context.userMessageId = 111L;
        context.modelAnswerMessageId = 201L;
        context.traceId = "trace-1";
        context.clientRequestId = "client-1";
        context.senderChannel = mock(Channel.class);

        ReflectionTestUtils.invokeMethod(scriptService, "broadcastInitEvent", context);

        ArgumentCaptor<String> payload = ArgumentCaptor.forClass(String.class);
        verify(broadcastService).broadcastToUserDevices(eq(7L), eq(101L), eq("initialization"),
            payload.capture(), same(context.senderChannel), eq("client-1"));
        JSONObject data = JSONObject.parseObject(payload.getValue());
        assertThat(data.getString("messageId")).isEqualTo("201");
        assertThat(data.getString("queryMessageId")).isEqualTo("111");
        assertThat(data.getString("traceId")).isEqualTo("trace-1");
    }

    @Test
    void broadcastUserMessage_usesNewMessageEnvelopeAndRequestIdentity() {
        MultiDeviceBroadcastService broadcastService = mock(MultiDeviceBroadcastService.class);
        ScriptService scriptService = new ScriptService();
        ReflectionTestUtils.setField(scriptService, "multiDeviceBroadcastService", broadcastService);

        Channel senderChannel = mock(Channel.class);
        AssistantChatDto chat = new AssistantChatDto();
        chat.setClientRequestId("request-1");
        chat.setAgentId(17L);

        ByaiMessageHotDtoDto askMessage = new ByaiMessageHotDtoDto();
        askMessage.setSessionId(11L);
        askMessage.setMessageId(13L);
        askMessage.setMessageContent("hello");
        askMessage.setUsage(ChatUseageEnum.USER_INPUT.getCode());
        askMessage.setCreatorId(7L);

        ChatProcessContext context = new ChatProcessContext(null, chat);
        context.setUserId(7L);
        context.setSessionId(11L);
        context.setAskMsg(askMessage);
        context.setSenderChannel(senderChannel);

        ReflectionTestUtils.invokeMethod(scriptService, "broadcastUserMessage", context);

        ArgumentCaptor<JSONObject> messageCaptor = ArgumentCaptor.forClass(JSONObject.class);
        verify(broadcastService).broadcastRawToUser(eq(7L), messageCaptor.capture(), same(senderChannel));
        JSONObject message = messageCaptor.getValue();
        assertThat(message.getString("type")).isEqualTo("NEW_MESSAGE");
        assertThat(message.getLong("sessionId")).isEqualTo(11L);
        assertThat(message.getString("clientRequestId")).isEqualTo("request-1");
        assertThat(message.getLong("agentId")).isEqualTo(17L);
        assertThat(message.getJSONObject("data").getLong("messageId")).isEqualTo(13L);
        assertThat(message.getJSONObject("data").getInteger("usage"))
            .isEqualTo(ChatUseageEnum.USER_INPUT.getCode());
        assertThat(message.getJSONObject("data").getLong("creatorId")).isEqualTo(7L);
    }
}
