package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.List;
import java.util.Map;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

class TenantScopedSessionEventServiceTest {
    @Test
    void terminalWithoutScopeContinuesThroughTenantRootRouting() {
        var node = mock(TenantNodeClient.class);
        var redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn("{\"userId\":20,\"enterpriseId\":10,\"role\":\"MEMBER\"}");
        var broadcaster = mock(ScopedProjectionBroadcaster.class);
        var service = new TenantScopedSessionEventService(node, redis, new PythonSseService(),
            new GatewayStreamEventProcessor(), broadcaster);
        var terminal = new JSONObject();
        terminal.put("event_type", "appStreamResponse");
        terminal.put("metadata", new JSONObject());
        assertThat(service.handleIfNecessary(50L, terminal)).isFalse();
        when(values.get(anyString())).thenReturn(null);
        assertThat(service.handleIfNecessary(50L, terminal)).isNull();
        verifyNoInteractions(node, broadcaster);
    }

    @Test
    void childProjectionReachesOnlyTheOwningEnterpriseChannel() throws Exception {
        var node = mock(TenantNodeClient.class);
        var redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn("{\"userId\":20,\"enterpriseId\":10,\"role\":\"MEMBER\"}");
        var own = new io.netty.channel.embedded.EmbeddedChannel();
        var foreign = new io.netty.channel.embedded.EmbeddedChannel();
        var personal = new io.netty.channel.embedded.EmbeddedChannel();
        var enterprise = com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID;
        own.attr(enterprise).set("10");
        foreign.attr(enterprise).set("11");
        var channels = mock(com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager.class);
        when(channels.getChannels(20L)).thenReturn(java.util.Set.of(own, foreign, personal));
        var delivery = new java.util.concurrent.CountDownLatch(1);
        own.pipeline().addLast(new io.netty.channel.ChannelOutboundHandlerAdapter() {
            @Override
            public void write(io.netty.channel.ChannelHandlerContext context, Object message,
                              io.netty.channel.ChannelPromise promise) throws Exception {
                // Wait for the frame to reach the outbound queue before reading it.
                promise.addListener(future -> {
                    if (future.isSuccess()) delivery.countDown();
                });
                super.write(context, message, promise);
            }
        });
        var transport = new com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService(
            channels, redis, mock(org.springframework.data.redis.listener.RedisMessageListenerContainer.class),
            mock(ChatRuntimeInstance.class), "test");
        var broadcaster = new ScopedProjectionBroadcaster(transport, 0);
        var service = new TenantScopedSessionEventService(node, redis, new PythonSseService(),
            new GatewayStreamEventProcessor(), broadcaster);
        var binding = new ObjectMapper().readTree("{\"session\":{\"sessionId\":\"51\"},"
            + "\"message\":{\"messageId\":\"61\",\"sessionId\":\"51\",\"enterpriseId\":\"10\",\"metadata\":\"{}\"}}");
        when(node.command(any(), anyString(), anyString(), anyString(), eq("ENSURE_EXTERNAL_CHILD"), any()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "bind", "ENSURE_EXTERNAL_CHILD", null, null, null, null, binding));
        when(node.command(any(), anyString(), anyString(), anyString(), eq("SAVE_EXTERNAL_CHILD"), any(), anyString()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "save", "SAVE_EXTERNAL_CHILD", null, null, null, null, binding));
        try {
            service.handleChildBatch(50L, List.of(event("1-0", "1002", "hello")));
            assertThat(delivery.await(1, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
            own.runPendingTasks();
            io.netty.handler.codec.http.websocketx.TextWebSocketFrame frame = own.readOutbound();
            assertThat(frame).isNotNull();
            try {
                assertThat(JSONObject.parseObject(frame.text()).getString("enterpriseId")).isEqualTo("10");
            } finally { frame.release(); }
            assertThat((Object) foreign.readOutbound()).isNull();
            assertThat((Object) personal.readOutbound()).isNull();
        } finally {
            broadcaster.shutdown();
            own.finishAndReleaseAll(); foreign.finishAndReleaseAll(); personal.finishAndReleaseAll();
        }
    }

    @Test
    void laterStatusPreservesTheStoredExplicitFinalBody() throws Exception {
        var node = mock(TenantNodeClient.class);
        var redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn("{\"userId\":20,\"enterpriseId\":10,\"role\":\"MEMBER\"}");
        var service = new TenantScopedSessionEventService(node, redis, new PythonSseService(),
            new GatewayStreamEventProcessor(), mock(ScopedProjectionBroadcaster.class));
        JSONObject stored = new JSONObject();
        stored.put("messageId", "61"); stored.put("isComplete", true);
        stored.put("messageContent", "Delivered"); stored.put("finalContent", "Delivered");
        stored.put("metadata", "{\"event_stream_id\":\"2-0\"}");
        stored.put("messageStruct", "[{\"contentType\":\"1002\",\"eventType\":\"answerDelta\",\"seq\":1,"
            + "\"choices\":[{\"delta\":{\"content\":\"Draft\"}}]}]");
        var binding = new ObjectMapper().readTree(JSON.toJSONString(Map.of("session", Map.of("sessionId", "51"), "message", stored)));
        when(node.command(any(), anyString(), anyString(), anyString(), eq("ENSURE_EXTERNAL_CHILD"), any()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "bind", "ENSURE_EXTERNAL_CHILD", null, null, null, null, binding));
        when(node.command(any(), anyString(), anyString(), anyString(), eq("SAVE_EXTERNAL_CHILD"), any(), anyString()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "save", "SAVE_EXTERNAL_CHILD", null, null, null, null, binding));
        JSONObject status = event("3-0", "1002", "");
        status.put("event_type", "moduleStatus");
        status.getJSONObject("metadata").put("event_kind", "session.status");
        status.getJSONObject("metadata").put("session_status", "completed");
        service.handleChildBatch(50L, List.of(status));
        ArgumentCaptor<TenantNodeModels.Fields> payload = ArgumentCaptor.forClass(TenantNodeModels.Fields.class);
        verify(node).command(any(), anyString(), anyString(), anyString(), eq("SAVE_EXTERNAL_CHILD"), payload.capture(), anyString());
        assertThat(payload.getValue().values()).containsEntry("messageContent", "Delivered").containsEntry("finalContent", "Delivered");
    }

    @Test
    void childEventsCommitToTenantNodeBeforeBroadcastAndExcludeCardJson() throws Exception {
        var node = mock(TenantNodeClient.class);
        var redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn("{\"userId\":20,\"enterpriseId\":10,\"role\":\"MEMBER\"}");
        var broadcaster = mock(ScopedProjectionBroadcaster.class);
        var service = new TenantScopedSessionEventService(node, redis, new PythonSseService(),
            new GatewayStreamEventProcessor(), broadcaster);
        var binding = new ObjectMapper().readTree("{\"session\":{\"sessionId\":\"51\",\"parentSessionId\":\"50\"},"
            + "\"message\":{\"messageId\":\"61\",\"messageStruct\":\"[]\",\"inferLog\":\"[]\",\"metadata\":\"{}\"}}");
        when(node.command(any(), anyString(), anyString(), anyString(), eq("ENSURE_EXTERNAL_CHILD"), any()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "bind", "ENSURE_EXTERNAL_CHILD", null, null, null, null, binding));
        when(node.command(any(), anyString(), anyString(), anyString(), eq("SAVE_EXTERNAL_CHILD"), any(), anyString()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "save", "SAVE_EXTERNAL_CHILD", null, null, null, null, binding));

        assertThat(service.handleChildBatch(50L, List.of(event("1-0", "1002", "hello"),
            event("2-0", "2008", "{plan}")))).isTrue();

        ArgumentCaptor<TenantNodeModels.Fields> payload = ArgumentCaptor.forClass(TenantNodeModels.Fields.class);
        var order = inOrder(node, broadcaster);
        order.verify(node).command(any(), anyString(), anyString(), eq("50"), eq("ENSURE_EXTERNAL_CHILD"), any());
        order.verify(node).command(any(), anyString(), anyString(), eq("50"), eq("SAVE_EXTERNAL_CHILD"), payload.capture(), anyString());
        assertThat(payload.getValue().values()).containsEntry("messageContent", "hello");
        assertThat((List<?>) payload.getValue().values().get("messageStruct")).hasSize(2);
        assertThat((JSONObject) payload.getValue().values().get("metadata")).containsAllEntriesOf(
            Map.of("messageRenderVersion", "v2", "external_parent_session_id", "50", "event_source", "EXTERNAL_CHILD"));
        order.verify(broadcaster).enqueueTenant(anyString(), eq(20L), eq(10L), any(), eq(false));
    }

    @Test
    void replayedChildWatermarkDoesNotAppendOrBroadcastAgain() throws Exception {
        var node = mock(TenantNodeClient.class);
        var redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenReturn("{\"userId\":20,\"enterpriseId\":10,\"role\":\"MEMBER\"}");
        var broadcaster = mock(ScopedProjectionBroadcaster.class);
        var service = new TenantScopedSessionEventService(node, redis, new PythonSseService(),
            new GatewayStreamEventProcessor(), broadcaster);
        var binding = new ObjectMapper().readTree("{\"session\":{\"sessionId\":\"51\"},"
            + "\"message\":{\"messageId\":\"61\",\"metadata\":\"{\\\"event_stream_id\\\":\\\"2-0\\\"}\"}}");
        when(node.command(any(), anyString(), anyString(), anyString(), eq("ENSURE_EXTERNAL_CHILD"), any()))
            .thenReturn(new TenantNodeModels.CommandResult("50", "bind", "ENSURE_EXTERNAL_CHILD", null, null, null, null, binding));
        assertThat(service.handleChildBatch(50L, List.of(event("1-0", "1002", "hello")))).isTrue();
        verify(node, never()).command(any(), anyString(), anyString(), anyString(), eq("SAVE_EXTERNAL_CHILD"), any(), anyString());
        verifyNoInteractions(broadcaster);
    }

    private JSONObject event(String stream, String type, String content) {
        JSONObject event = new JSONObject();
        event.put("session_id", "50"); event.put("stream_id", stream); event.put("event_type", "answerDelta");
        event.put("metadata", new JSONObject(new java.util.LinkedHashMap<>(Map.of("session_scope", "child", "external_session_id", "child",
            "external_root_session_id", "root", "child_name", "成员"))));
        event.put("data", JSON.toJSONString(Map.of("contentType", type,
            "choices", List.of(Map.of("delta", Map.of("content", content))))));
        return event;
    }
}
