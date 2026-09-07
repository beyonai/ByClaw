package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.Collections;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.core.task.SyncTaskExecutor;
import com.iwhalecloud.byai.state.common.redis.RedisConfiguration;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeInstance;
import com.iwhalecloud.byai.state.domain.ws.manager.ChannelManager;

import io.netty.channel.embedded.EmbeddedChannel;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class MultiDeviceBroadcastServiceTest {

    @Test
    void broadcastSubscription_keepsCallbacksOrderedWithoutBlockingTheSubscriptionTask() {
        RedisMessageListenerContainer container = new RedisConfiguration()
            .webSocketBroadcastListenerContainer(mock(RedisConnectionFactory.class));
        Object callbackExecutor = org.springframework.test.util.ReflectionTestUtils.getField(container, "taskExecutor");
        Object subscriptionExecutor =
            org.springframework.test.util.ReflectionTestUtils.getField(container, "subscriptionExecutor");
        assertThat(callbackExecutor).isInstanceOf(SyncTaskExecutor.class);
        assertThat(subscriptionExecutor).isNotSameAs(callbackExecutor);
    }

    @Test
    void initialization_reachesOtherInstancesInTheFrontendChatStreamFormat() {
        EmbeddedChannel sender = new EmbeddedChannel();
        EmbeddedChannel localDevice = new EmbeddedChannel();
        EmbeddedChannel remoteDeviceA = new EmbeddedChannel();
        EmbeddedChannel remoteDeviceB = new EmbeddedChannel();
        ChannelManager channelManager = mock(ChannelManager.class);
        when(channelManager.getChannels(7L)).thenReturn(Set.of(sender, localDevice));
        StringRedisTemplate redisTemplate = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService origin = service("instance-a", channelManager, redisTemplate);
        ChannelManager remoteManager = mock(ChannelManager.class);
        when(remoteManager.getChannels(7L)).thenReturn(Set.of(remoteDeviceA, remoteDeviceB));
        StringRedisTemplate remoteRedis = mock(StringRedisTemplate.class);
        MultiDeviceBroadcastService remote = service("instance-b", remoteManager, remoteRedis);
        String data = "{\"messageId\":\"201\",\"queryMessageId\":\"111\",\"traceId\":\"trace-1\"}";

        origin.broadcastToUserDevices(7L, 101L, "initialization", data, sender, "client-1");

        ArgumentCaptor<String> envelopeCaptor = ArgumentCaptor.forClass(String.class);
        verify(redisTemplate).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), envelopeCaptor.capture());
        JSONObject envelope = JSONObject.parseObject(envelopeCaptor.getValue());
        JSONObject frame = JSONObject.parseObject(envelope.getString("frameText"));
        assertThat(frame.getString("type")).isEqualTo("CHAT_STREAM");
        assertThat(frame.getString("clientRequestId")).isEqualTo("client-1");
        assertThat(frame.getString("sessionId")).isEqualTo("101");
        assertThat(frame.getString("event")).isEqualTo("initialization");
        assertThat(frame.getString("data")).isEqualTo(data);
        assertThat((Object) sender.readOutbound()).isNull();
        assertFrame(localDevice, frame.toJSONString());
        assertThat(remote.handleRemoteBroadcast(envelopeCaptor.getValue())).isEqualTo(2);
        assertFrame(remoteDeviceA, frame.toJSONString());
        assertFrame(remoteDeviceB, frame.toJSONString());
        assertThat(origin.handleRemoteBroadcast(envelopeCaptor.getValue())).isZero();
        verify(remoteRedis, never()).convertAndSend(
            eq(MultiDeviceBroadcastService.DEFAULT_PUBSUB_TOPIC), org.mockito.ArgumentMatchers.anyString());
        sender.finishAndReleaseAll();
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
