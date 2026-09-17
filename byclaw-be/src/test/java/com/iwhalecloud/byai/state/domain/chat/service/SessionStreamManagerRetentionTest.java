package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.assertj.core.api.Assertions.assertThat;
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

    /** 与 gateway SDK 的 RegistryKeys.DEFAULT_SESSION_TTL 一致：7 天。 */
    private static final long ACTIVE_TTL_SECONDS = 604800L;

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
        ReflectionTestUtils.setField(manager, "outputStreamManager", new OutputStreamManager());
        ReflectionTestUtils.setField(manager, "sessionStreamMaxLength", 10000L);
        ReflectionTestUtils.setField(manager, "completedStreamRetentionHours", 168L);
        ReflectionTestUtils.setField(manager, "activeStreamTtlSeconds", ACTIVE_TTL_SECONDS);
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
        verify(redisTemplate).expire(eq(streamKey), eq(168L), eq(TimeUnit.HOURS));
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
        Map<String, Object> listeners = (Map<String, Object>) ReflectionTestUtils.getField(manager, "listeners");
        listeners.put(SESSION_ID, Mockito.mock(
            com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener.class));

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

    /**
     * 保留窗口内重新使用同一 session 时，Stream Key 仍带着上一轮终结时设置的剩余 TTL。
     * 若不撑开到完整的 session 生命周期，从监听启动到事件写入方发出首条事件之间的空窗里，
     * Redis 会回收整个 key，消费者随即收到「NOGROUP No such key ... or consumer group ...」，
     * 而写入方的下一条事件又会把 key 重建成没有 Consumer Group 的新流，消费侧从此再也读不到任何事件。
     */
    @Test
    void refreshesLeftoverRetentionToTheFullSessionLifetimeWhenReusingAnExistingStream() {
        when(redisTemplate.hasKey(streamKey)).thenReturn(true);

        ReflectionTestUtils.invokeMethod(manager, "ensureStreamExists", streamKey);

        verify(redisTemplate).expire(streamKey, ACTIVE_TTL_SECONDS, TimeUnit.SECONDS);
        verify(streamOps, never()).add(anyString(), any(Map.class));
    }

    /**
     * XADD 创建新 key 时不带过期时间，若本轮始终没有事件写入，这个 key 会永久驻留。
     */
    @Test
    void boundsTheLifetimeOfANewlyInitializedStream() {
        when(redisTemplate.hasKey(streamKey)).thenReturn(false);

        ReflectionTestUtils.invokeMethod(manager, "ensureStreamExists", streamKey);

        verify(streamOps).add(eq(streamKey), any(Map.class));
        verify(redisTemplate).expire(streamKey, ACTIVE_TTL_SECONDS, TimeUnit.SECONDS);
    }

    /**
     * 活跃期的 TTL 绝不能短于终结后的保留期，否则会话进行中就会先于历史记录被回收。
     */
    @Test
    void activeTtlIsNotShorterThanTheCompletedRetention() {
        long completedRetentionSeconds = TimeUnit.HOURS.toSeconds(
            (Long) ReflectionTestUtils.getField(manager, "completedStreamRetentionHours"));

        assertThat(ACTIVE_TTL_SECONDS).isGreaterThanOrEqualTo(completedRetentionSeconds);
    }

    @Test
    void retentionRefreshFailureStillStartsConsumption() {
        when(redisTemplate.hasKey(streamKey)).thenReturn(true);
        when(redisTemplate.expire(streamKey, ACTIVE_TTL_SECONDS, TimeUnit.SECONDS))
            .thenThrow(new RuntimeException("redis down"));

        // 刷新失败只影响回收时机，不得阻断本轮监听启动。
        ReflectionTestUtils.invokeMethod(manager, "ensureStreamExists", streamKey);
    }
}
