package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.redis.connection.stream.PendingMessagesSummary;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 验证已终结 Session Stream 的清理策略：
 * 存在 pending 时不得清理（MAXLEN trim 不遵守 PEL，会删除仍需 claim 的记录）；
 * 无 pending 且 listener 已停止时，除按长度裁剪外还要设置过期，否则单 session 事件量
 * 远低于长度上限，MAXLEN 实际不释放任何内存。
 */
class SessionStreamManagerRetentionTest {

    private static final String SESSION_ID = "10";

    private RedisTemplate<String, Object> redisTemplate;
    private StreamOperations<String, Object, Object> streamOps;
    private SessionStreamManager manager;
    private String streamKey;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        manager = new SessionStreamManager();
        redisTemplate = Mockito.mock(RedisTemplate.class);
        streamOps = Mockito.mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOps);

        ReflectionTestUtils.setField(manager, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(manager, "sessionStreamMaxLength", 10000L);
        ReflectionTestUtils.setField(manager, "completedStreamRetentionHours", 24L);
        streamKey = manager.buildStreamKey(SESSION_ID);
    }

    private void stubPending(long totalPending) {
        PendingMessagesSummary summary = Mockito.mock(PendingMessagesSummary.class);
        when(summary.getTotalPendingMessages()).thenReturn(totalPending);
        when(streamOps.pending(anyString(), anyString())).thenReturn(summary);
    }

    @Test
    void trimsAndExpiresWhenNoPending() {
        stubPending(0L);

        manager.trimCompletedStream(SESSION_ID);

        verify(streamOps).trim(eq(streamKey), eq(10000L), anyBoolean());
        // 关键：仅 MAXLEN 不会释放内存，必须让 Redis 回收整个 key。
        verify(redisTemplate).expire(eq(streamKey), eq(24L), eq(TimeUnit.HOURS));
    }

    @Test
    void skipsTrimWhenPendingExists() {
        stubPending(3L);

        manager.trimCompletedStream(SESSION_ID);

        verify(streamOps, never()).trim(anyString(), anyLong(), anyBoolean());
        verify(redisTemplate, never()).expire(anyString(), anyLong(), any(TimeUnit.class));
    }

    @Test
    void skipsTrimWhileListenerStillActive() {
        Map<String, Object> containers = (Map<String, Object>) ReflectionTestUtils.getField(manager, "containers");
        containers.put(SESSION_ID, Mockito.mock(
            org.springframework.data.redis.stream.StreamMessageListenerContainer.class));

        manager.trimCompletedStream(SESSION_ID);

        verify(streamOps, never()).pending(anyString(), anyString());
        verify(streamOps, never()).trim(anyString(), anyLong(), anyBoolean());
    }

    @Test
    void trimFailureDoesNotPropagate() {
        stubPending(0L);
        when(streamOps.trim(anyString(), anyLong(), anyBoolean())).thenThrow(new RuntimeException("redis down"));

        // 清理失败不得阻断正常消费，异常必须被吞掉并记录日志。
        manager.trimCompletedStream(SESSION_ID);
    }
}
