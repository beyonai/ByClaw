package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.concurrent.Executor;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhaleai.byai.framework.common.Constants;

class SandboxWakeupStreamListenerTest {

    @Test
    @SuppressWarnings("unchecked")
    void createConsumerGroup_usesFrameworkControlPlaneManagementStreamKey() {
        RedisTemplate<String, Object> redisTemplate = mock(RedisTemplate.class);
        StreamOperations<String, Object, Object> streamOperations = mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOperations);
        SandboxWakeupStreamListener listener = new SandboxWakeupStreamListener(
            mock(RedisConnectionFactory.class),
            redisTemplate,
            mock(SandboxWakeupMessageHandler.class),
            mock(Executor.class)
        );
        ReflectionTestUtils.setField(listener, "consumerGroup", SandboxWakeupStreamListener.DEFAULT_CONSUMER_GROUP);

        ReflectionTestUtils.invokeMethod(listener, "createConsumerGroupIfAbsent");

        verify(streamOperations).createGroup(
            Constants.QueueNames.controlPlaneManagementStream(),
            ReadOffset.latest(),
            SandboxWakeupStreamListener.DEFAULT_CONSUMER_GROUP
        );
    }
    @Test
    @SuppressWarnings("unchecked")
    void failedWakeupIsVisibleInRecoveryAuditAndRemainsPending() {
        var redisTemplate = mock(RedisTemplate.class);
        var handler = mock(SandboxWakeupMessageHandler.class);
        var audit = mock(com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryStore.class);
        var execution = mock(com.iwhalecloud.byai.gateway.sandbox.platform.PlatformBackgroundExecution.class);
        when(execution.isLegacyExecutor()).thenReturn(true);
        var listener = new SandboxWakeupStreamListener(mock(RedisConnectionFactory.class), redisTemplate,
            handler, mock(Executor.class));
        ReflectionTestUtils.setField(listener, "platformExecution", execution);
        ReflectionTestUtils.setField(listener, "recoveryStore", audit);
        ReflectionTestUtils.setField(listener, "accepting", true);
        ReflectionTestUtils.setField(listener, "consumerGroup", "group");
        var values = java.util.Map.of("policy", "WAKE_AND_WAIT");
        org.mockito.Mockito.doThrow(new IllegalStateException("private credential"))
            .when(handler).handle(values);
        var record = org.springframework.data.redis.connection.stream.MapRecord.create("stream", values)
            .withId(org.springframework.data.redis.connection.stream.RecordId.of("1-0"));
        listener.onMessage(record);
        verify(audit).audit(org.mockito.ArgumentMatchers.eq("stream"), org.mockito.ArgumentMatchers.eq("group"),
            org.mockito.ArgumentMatchers.eq("1-0"), org.mockito.ArgumentMatchers.argThat(value ->
                "FAILED".equals(value.get("outcome")) && !value.get("error").contains("private credential")));
        org.mockito.Mockito.verifyNoInteractions(redisTemplate);
    }

}
