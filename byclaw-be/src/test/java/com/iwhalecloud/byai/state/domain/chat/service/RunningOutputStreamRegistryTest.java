package com.iwhalecloud.byai.state.domain.chat.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RunningOutputStreamRegistryTest {

    private RedisTemplate<String, Object> redisTemplate;
    private ValueOperations<String, Object> valueOperations;
    private ChatRuntimeStateService chatRuntimeStateService;
    private RunningOutputStreamRegistry runningOutputStreamRegistry;

    @BeforeEach
    void setUp() {
        redisTemplate = mock(RedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        chatRuntimeStateService = mock(ChatRuntimeStateService.class);
        when(redisTemplate.opsForValue()).thenReturn(valueOperations);

        runningOutputStreamRegistry = new RunningOutputStreamRegistry();
        ReflectionTestUtils.setField(runningOutputStreamRegistry, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(runningOutputStreamRegistry, "chatRuntimeStateService", chatRuntimeStateService);
    }

    @Test
    void release_deletesMatchingRunningMessage() {
        when(valueOperations.get("byai:chat:running:10"))
            .thenReturn("{\"sessionId\":10,\"modelAnswerMessageId\":20}");

        runningOutputStreamRegistry.release(10L, 20L);

        verify(redisTemplate).delete("byai:chat:running:10");
        verify(chatRuntimeStateService).delete(10L);
    }

    @Test
    void release_keepsDifferentRunningMessage() {
        when(valueOperations.get("byai:chat:running:10"))
            .thenReturn("{\"sessionId\":10,\"modelAnswerMessageId\":21}");

        runningOutputStreamRegistry.release(10L, 20L);

        verify(redisTemplate, never()).delete(eq("byai:chat:running:10"));
        verify(chatRuntimeStateService, never()).delete(10L);
    }
}
