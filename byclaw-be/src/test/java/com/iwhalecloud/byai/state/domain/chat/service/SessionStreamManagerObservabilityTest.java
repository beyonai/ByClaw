package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.ConsumerStreamReadRequest;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.common.redis.RedisConfiguration;

class SessionStreamManagerObservabilityTest {

    private SessionStreamManager manager;
    private SessionStreamMetrics metrics;

    @BeforeEach
    void setUp() {
        manager = new SessionStreamManager();
        metrics = mock(SessionStreamMetrics.class);
        ReflectionTestUtils.setField(manager, "sessionStreamMetrics", metrics);
    }

    @Test
    void createsManualAckRequestThatContinuesAfterRuntimeError() {
        ConsumerStreamReadRequest<String> request = manager.createReadRequest(
            "10", "stream-10", "consumer-10");

        assertThat(request.isAutoAcknowledge()).isFalse();
        assertThat(request.getConsumer().getGroup()).isEqualTo(SessionStreamManager.CONSUMER_GROUP);
        assertThat(request.getConsumer().getName()).isEqualTo("consumer-10");
        assertThat(request.getCancelSubscriptionOnError()
            .test(new RedisConnectionFailureException("down"))).isFalse();
    }

    @Test
    void requestErrorHandlerRecordsReadError() {
        ConsumerStreamReadRequest<String> request = manager.createReadRequest(
            "10", "stream-10", "consumer-10");

        request.getErrorHandler().handleError(new RedisConnectionFailureException("down"));

        verify(metrics).recordReadError(any(RedisConnectionFailureException.class));
    }

    @Test
    void invalidTimeoutHeadroomIsObservable() {
        ReflectionTestUtils.setField(manager, "pollTimeoutMillis", 2000L);
        ReflectionTestUtils.setField(manager, "redisReadTimeoutMillis", 2000L);

        manager.validateTimeoutConfiguration();

        verify(metrics).recordInvalidConfiguration();
    }

    @Test
    void redisReadTimeoutDefaultLeavesHeadroomForBlockingRead() throws Exception {
        Field field = RedisConfiguration.class.getDeclaredField("readTimeout");
        Value value = field.getAnnotation(Value.class);

        assertThat(value.value()).isEqualTo("${spring.redis.read-timeout:5000}");
    }

    @Test
    @SuppressWarnings("unchecked")
    void exposesImmutableActiveSessionSnapshot() {
        Map<String, StreamMessageListenerContainer<?, ?>> containers =
            (Map<String, StreamMessageListenerContainer<?, ?>>) ReflectionTestUtils.getField(manager, "containers");
        containers.put("10", mock(StreamMessageListenerContainer.class));
        containers.put("20", mock(StreamMessageListenerContainer.class));

        Set<String> snapshot = manager.activeSessionIdsSnapshot();

        assertThat(snapshot).containsExactlyInAnyOrder("10", "20");
        assertThatThrownBy(() -> snapshot.add("30")).isInstanceOf(UnsupportedOperationException.class);
    }
}
