package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.Collections;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeInstance;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MultiDeviceBroadcastServiceTest {

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void tenantChildProjectionReachesRemoteInstanceWithNoLocalChannel(boolean selected) {
        var originChannels = mock(ChannelManager.class);
        when(originChannels.getChannels(7L)).thenReturn(Collections.emptySet());
        var redis = mock(StringRedisTemplate.class);
        var source = service("instance-a", originChannels, redis);
        var own = new EmbeddedChannel();
        var foreign = new EmbeddedChannel();
        var personal = new EmbeddedChannel();
        var enterprise = com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID;
        own.attr(enterprise).set("10"); foreign.attr(enterprise).set("11");
        own.attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_HEADER).set(java.util.Map.of("scoped-delta-version", "1"));
        if (selected) own.attr(com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_SCOPED_SESSION_ID).set("51");
        var remoteChannels = mock(ChannelManager.class);
        when(remoteChannels.getChannels(7L)).thenReturn(Set.of(own, foreign, personal));
        var remoteRedis = mock(StringRedisTemplate.class);
        var remote = service("instance-b", remoteChannels, remoteRedis);
        var projection = JSONObject.parseObject("{\"type\":\"NEW_MESSAGE\",\"sessionId\":\"51\",\"streamId\":\"1-0\","
            + "\"data\":{\"sessionId\":\"51\",\"messageId\":\"61\",\"messageContent\":\"hello\",\"metadata\":\"{\\\"session_scope\\\":\\\"child\\\",\\\"external_session_id\\\":\\\"member\\\",\\\"external_parent_session_id\\\":\\\"50\\\"}\"}}");
        try {
            source.broadcastTenantScopedProjection(7L, 10L, "tenant:10:51", projection, false);
            ArgumentCaptor<String> envelope = ArgumentCaptor.forClass(String.class);
            verify(redis).convertAndSend(eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), envelope.capture());
            remote.handleRemoteBroadcast(envelope.getValue());
            own.runPendingTasks();
            TextWebSocketFrame frame = own.readOutbound();
            assertThat(frame).isNotNull();
            try {
                var event = JSONObject.parseObject(frame.text());
                assertThat(event.getString("type")).isEqualTo(selected ? "NEW_MESSAGE" : "SCOPED_SESSION_STATUS");
                assertThat(event.getString("enterpriseId")).isEqualTo("10");
            } finally { frame.release(); }
            assertThat((Object) foreign.readOutbound()).isNull();
            assertThat((Object) personal.readOutbound()).isNull();
            verify(remoteRedis, never()).convertAndSend(anyString(), anyString());
        } finally { own.finishAndReleaseAll(); foreign.finishAndReleaseAll(); personal.finishAndReleaseAll(); }
    }

    @Test
    void tenantBroadcastKeepsTheEnterpriseBoundaryAcrossInstances() {
        EmbeddedChannel own = new EmbeddedChannel();
        EmbeddedChannel foreign = new EmbeddedChannel();
        EmbeddedChannel personal = new EmbeddedChannel();
        var enterprise = com.iwhalecloud.byai.state.domain.ws.constant.Constant.ATT_ENTERPRISE_ID;
        own.attr(enterprise).set("10"); foreign.attr(enterprise).set("11");
        ChannelManager manager = mock(ChannelManager.class);
        when(manager.getChannels(7L)).thenReturn(Set.of(own, foreign, personal));
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        var source = service("instance-a", manager, redis);
        JSONObject event = new JSONObject();
        event.put("type", "SESSION_RUNTIME_STATUS"); event.put("sessionId", "50");
        try {
            assertThat(source.broadcastTenantRawToUser(
                new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(7L, 10L, "MEMBER"), event, null)).isEqualTo(1);
            TextWebSocketFrame local = own.readOutbound();
            assertThat(JSONObject.parseObject(local.text()).getString("enterpriseId")).isEqualTo("10");
            local.release();
            ArgumentCaptor<String> envelope = ArgumentCaptor.forClass(String.class);
            verify(redis).convertAndSend(eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), envelope.capture());
            var remote = service("instance-b", manager, mock(StringRedisTemplate.class));
            assertThat(remote.handleRemoteBroadcast(envelope.getValue())).isEqualTo(1);
            TextWebSocketFrame frame = own.readOutbound();
            assertThat(JSONObject.parseObject(frame.text()).getString("enterpriseId")).isEqualTo("10");
            frame.release();
            assertThat((Object) foreign.readOutbound()).isNull();
            assertThat((Object) personal.readOutbound()).isNull();
        } finally { own.finishAndReleaseAll(); foreign.finishAndReleaseAll(); personal.finishAndReleaseAll(); }
    }

    @Test
    void broadcastRawToUser_sendsLocallyThenPublishesForOtherInstances() {
        EmbeddedChannel localChannel = new EmbeddedChannel();
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Set.of(localChannel));
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService service = service("instance-a", channelManager, redisTemplate);

        JSONObject message = new JSONObject();
        message.put("type", "TASK_PLAN_SNAPSHOT");
        message.put("sessionId", "session-1");

        int sentCount = service.broadcastRawToUser(7L, message, null);

        assertThat(sentCount).isEqualTo(1);
        assertFrame(localChannel, message.toJSONString());

        ArgumentCaptor<String> envelopeCaptor = ArgumentCaptor.forClass(String.class);
        verify(redisTemplate).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), envelopeCaptor.capture());
        JSONObject envelope = JSONObject.parseObject(envelopeCaptor.getValue());
        assertThat(envelope.getInteger("schemaVersion"))
            .isEqualTo(MultiDeviceBroadcastService.ENVELOPE_SCHEMA_VERSION);
        assertThat(envelope.getString("sourceInstanceId")).isEqualTo("instance-a");
        assertThat(envelope.getLong("userId")).isEqualTo(7L);
        assertThat(envelope.getString("messageType")).isEqualTo("TASK_PLAN_SNAPSHOT");
        assertThat(envelope.getString("frameText")).isEqualTo(message.toJSONString());
    }

    @Test
    void broadcastRawToUser_publishesEvenWhenOriginInstanceHasNoLocalChannel() {
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Collections.emptySet());
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService service = service("instance-a", channelManager, redisTemplate);

        JSONObject message = new JSONObject();
        message.put("type", "TASK_PLAN_SNAPSHOT");

        int sentCount = service.broadcastRawToUser(7L, message, null);

        assertThat(sentCount).isZero();
        verify(redisTemplate).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void broadcastRawToUser_excludesSenderButSendsToOtherLocalChannels() {
        EmbeddedChannel senderChannel = new EmbeddedChannel();
        EmbeddedChannel otherChannel = new EmbeddedChannel();
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Set.of(senderChannel, otherChannel));
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService service = service("instance-a", channelManager, redisTemplate);
        JSONObject message = new JSONObject();
        message.put("type", "NEW_MESSAGE");

        int sentCount = service.broadcastRawToUser(7L, message, senderChannel);

        assertThat(sentCount).isEqualTo(1);
        assertThat((Object) senderChannel.readOutbound()).isNull();
        assertFrame(otherChannel, message.toJSONString());
        senderChannel.finishAndReleaseAll();
        verify(redisTemplate).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void broadcastRawEvent_publishesChatStreamFrameThroughSharedClusterPath() {
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Collections.emptySet());
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService service = service("instance-a", channelManager, redisTemplate);
        JSONObject streamEvent = new JSONObject();
        streamEvent.put("event_type", "answerDelta");
        streamEvent.put("data", "delta");
        streamEvent.put("trace_id", "trace-1");
        streamEvent.put("stream_id", "1-0");

        service.broadcastRawEvent(7L, 11L, streamEvent, null, "request-1");

        ArgumentCaptor<String> envelopeCaptor = ArgumentCaptor.forClass(String.class);
        verify(redisTemplate).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), envelopeCaptor.capture());
        JSONObject envelope = JSONObject.parseObject(envelopeCaptor.getValue());
        JSONObject frame = JSONObject.parseObject(envelope.getString("frameText"));
        assertThat(frame.getString("type")).isEqualTo("CHAT_STREAM");
        assertThat(frame.getString("sessionId")).isEqualTo("11");
        assertThat(frame.getString("event")).isEqualTo("answerDelta");
        assertThat(frame.getString("clientRequestId")).isEqualTo("request-1");
    }

    @Test
    void remoteBroadcast_sendsToEveryLocalChannelWithoutRepublishing() {
        EmbeddedChannel firstChannel = new EmbeddedChannel();
        EmbeddedChannel secondChannel = new EmbeddedChannel();
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Set.of(firstChannel, secondChannel));
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService service = service("instance-b", channelManager, redisTemplate);
        JSONObject frame = new JSONObject();
        frame.put("type", "TASK_PLAN_SNAPSHOT");
        frame.put("sessionId", "session-1");

        int sentCount = service.handleRemoteBroadcast(envelope("instance-a", 7L, frame));

        assertThat(sentCount).isEqualTo(2);
        assertFrame(firstChannel, frame.toJSONString());
        assertFrame(secondChannel, frame.toJSONString());
        verify(redisTemplate, never()).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void remoteBroadcast_ignoresEnvelopePublishedByCurrentInstance() {
        EmbeddedChannel localChannel = new EmbeddedChannel();
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Set.of(localChannel));
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService service = service("instance-a", channelManager, redisTemplate);
        JSONObject frame = new JSONObject();
        frame.put("type", "TASK_PLAN_SNAPSHOT");

        int sentCount = service.handleRemoteBroadcast(envelope("instance-a", 7L, frame));

        assertThat(sentCount).isZero();
        assertThat((Object) localChannel.readOutbound()).isNull();
        verify(redisTemplate, never()).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void broadcastRawToUser_keepsLocalDeliveryWhenRedisPublishFails() {
        EmbeddedChannel localChannel = new EmbeddedChannel();
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Set.of(localChannel));
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        when(redisTemplate.convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), org.mockito.ArgumentMatchers.anyString()))
            .thenThrow(new IllegalStateException("redis unavailable"));
        MultiDeviceBroadcastService service = service("instance-a", channelManager, redisTemplate);
        JSONObject message = new JSONObject();
        message.put("type", "TASK_PLAN_SNAPSHOT");

        int sentCount = service.broadcastRawToUser(7L, message, null);

        assertThat(sentCount).isEqualTo(1);
        assertFrame(localChannel, message.toJSONString());
    }

    private MultiDeviceBroadcastService service(String instanceId, ChannelManager channelManager,
                                                StringRedisTemplate redisTemplate) {
        ChatRuntimeInstance runtimeInstance = mock(ChatRuntimeInstance.class);
        when(runtimeInstance.getInstanceId()).thenReturn(instanceId);
        return new MultiDeviceBroadcastService(
            channelManager,
            redisTemplate,
            mock(RedisMessageListenerContainer.class),
            runtimeInstance,
            MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC);
    }

    private String envelope(String sourceInstanceId, Long userId, JSONObject frame) {
        JSONObject envelope = new JSONObject();
        envelope.put("schemaVersion", MultiDeviceBroadcastService.ENVELOPE_SCHEMA_VERSION);
        envelope.put("sourceInstanceId", sourceInstanceId);
        envelope.put("userId", userId);
        envelope.put("messageType", frame.getString("type"));
        envelope.put("frameText", frame.toJSONString());
        return envelope.toJSONString();
    }

    private void assertFrame(EmbeddedChannel channel, String expectedText) {
        TextWebSocketFrame frame = channel.readOutbound();
        assertThat(frame).isNotNull();
        try {
            assertThat(frame.text()).isEqualTo(expectedText);
        }
        finally {
            frame.release();
            channel.finishAndReleaseAll();
        }
    }
}
