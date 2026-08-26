package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

class SessionStreamLeaseServiceTest {

    private SessionStreamLeaseService leaseService;
    private RedisTemplate<String, Object> redisTemplate;
    private ValueOperations<String, Object> valueOperations;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        leaseService = new SessionStreamLeaseService();
        redisTemplate = mock(RedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.setIfAbsent(anyString(), anyString(), anyLong(), any(TimeUnit.class)))
            .thenReturn(Boolean.TRUE);
        ReflectionTestUtils.setField(leaseService, "redisTemplate", redisTemplate);
        ChatRuntimeInstance runtimeInstance = mock(ChatRuntimeInstance.class);
        when(runtimeInstance.getInstanceId()).thenReturn("instance-a");
        ReflectionTestUtils.setField(leaseService, "chatRuntimeInstance", runtimeInstance);
    }

    @Test
    void acquiresLeaseWithInstanceScopedToken() {
        assertTrue(leaseService.tryAcquire("10").isPresent());
    }
}
