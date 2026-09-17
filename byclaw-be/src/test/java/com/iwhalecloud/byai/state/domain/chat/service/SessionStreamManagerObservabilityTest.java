package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;

import java.lang.reflect.Field;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.common.redis.RedisConfiguration;

class SessionStreamManagerObservabilityTest {

    private SessionStreamManager manager;

    @BeforeEach
    void setUp() {
        manager = new SessionStreamManager();
    }

    @Test
    void redisReadTimeoutDefaultBoundsReactiveCommands() throws Exception {
        Field field = RedisConfiguration.class.getDeclaredField("readTimeout");
        Value value = field.getAnnotation(Value.class);

        assertThat(value.value()).isEqualTo("${spring.redis.read-timeout:5000}");
    }

    @Test
    @SuppressWarnings("unchecked")
    void exposesImmutableActiveSessionSnapshot() {
        Map<String, com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener> listeners =
            (Map<String, com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener>)
                ReflectionTestUtils.getField(manager, "listeners");
        listeners.put("10", mock(com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener.class));
        listeners.put("20", mock(com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener.class));

        Set<String> snapshot = manager.activeSessionIdsSnapshot();

        assertThat(snapshot).containsExactlyInAnyOrder("10", "20");
        assertThatThrownBy(() -> snapshot.add("30")).isInstanceOf(UnsupportedOperationException.class);
    }

}
