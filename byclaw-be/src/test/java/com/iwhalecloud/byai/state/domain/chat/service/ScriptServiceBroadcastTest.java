package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

import io.netty.channel.Channel;

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
}
