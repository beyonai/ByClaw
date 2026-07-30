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
}
