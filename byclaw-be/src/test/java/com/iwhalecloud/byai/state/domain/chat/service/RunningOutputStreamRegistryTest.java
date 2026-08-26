package com.iwhalecloud.byai.state.domain.chat.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;

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

    /**
     * 归属未知的停止请求（stopChat 既无 messageId、traceId 也解析失败）不得销毁运行态：
     * 运行态是重启恢复扫描接管会话的唯一依据，一旦被抹掉，未落库的回答将永久丢失。
     */
    @Test
    void release_keepsRuntimeStateWhenAnswerMessageUnknown() {
        runningOutputStreamRegistry.release(10L, null);

        verify(redisTemplate, never()).delete(anyString());
        verify(chatRuntimeStateService, never()).delete(anyLong());
    }

    /**
     * running 标记先于运行态过期时，仍要按运行态自身记录的回答归属完成清理，
     * 避免归属校验引入永不回收的残留。
     */
    @Test
    void release_cleansRuntimeStateWhenRunningMarkerAlreadyGone() {
        when(valueOperations.get("byai:chat:running:10")).thenReturn(null);
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(10L);
        state.setModelAnswerMessageId(20L);
        when(chatRuntimeStateService.get(10L)).thenReturn(state);

        runningOutputStreamRegistry.release(10L, 20L);

        verify(chatRuntimeStateService).delete(10L);
    }

    @Test
    void release_keepsRuntimeStateOfAnotherAnswerWhenRunningMarkerGone() {
        when(valueOperations.get("byai:chat:running:10")).thenReturn(null);
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(10L);
        state.setModelAnswerMessageId(21L);
        when(chatRuntimeStateService.get(10L)).thenReturn(state);

        runningOutputStreamRegistry.release(10L, 20L);

        verify(chatRuntimeStateService, never()).delete(anyLong());
    }
}
