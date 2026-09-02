package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStreamCommands;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 验证 PEL claim 的两个边界（#1）：
 * 1) PEL 超过单批上限时分页 claim，不漏后续页；
 * 2) idle 未满阈值的 pending 本轮不 claim，留待后续周期补捞。
 */
class SessionStreamRecoveryClaimTest {

    private static final long IDLE = 180_000L;
    private static final String GROUP = SessionStreamManager.CONSUMER_GROUP;

    private RedisTemplate<String, Object> redisTemplate;
    private StreamOperations<String, Object, Object> streamOps;
    private SessionStreamManager sessionStreamManager;
    private SessionStreamRecoveryService recoveryService;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        recoveryService = new SessionStreamRecoveryService();
        redisTemplate = mock(RedisTemplate.class);
        streamOps = mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOps);

        sessionStreamManager = mockField("sessionStreamManager", SessionStreamManager.class);
        mockField("streamRecordProcessor", StreamRecordProcessor.class);
        ReflectionTestUtils.setField(recoveryService, "redisTemplate", redisTemplate);
        mockField("chatRuntimeStateService", ChatRuntimeStateService.class);
        mockField("chatContextRecoveryService", ChatContextRecoveryService.class);
        mockField("runningOutputStreamRegistry", RunningOutputStreamRegistry.class);
        mockField("outputStreamManager", OutputStreamManager.class);
        mockField("chatRuntimeInstance", ChatRuntimeInstance.class);

        when(sessionStreamManager.buildStreamKey("10")).thenReturn("byai_gateway:session:10:data_stream");
        when(sessionStreamManager.buildConsumerName("10")).thenReturn("byai_conversation_consumer:instance-a:10");
        // claim 后返回空列表即可（dispatch 路径已在别处覆盖），这里只验证 claim 调用与分页行为。
        when(streamOps.claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class)))
            .thenReturn(Collections.emptyList());
    }

    private <T> T mockField(String name, Class<T> type) {
        T m = Mockito.mock(type);
        ReflectionTestUtils.setField(recoveryService, name, m);
        return m;
    }

    private PendingMessage pending(String id, long idleMillis) {
        return new PendingMessage(RecordId.of(id), Consumer.from(GROUP, "c"), Duration.ofMillis(idleMillis), 1L);
    }

    private void invokeClaim() {
        ReflectionTestUtils.invokeMethod(recoveryService, "claimPendingMessages", "10");
    }

    @Test
    void claimsAcrossMultiplePages() {
        // 第一页满 100 条（全部 idle 已满），第二页 1 条，第三页空 → 应分页 claim 两次。
        List<PendingMessage> page1 = new ArrayList<>();
        for (int i = 1; i <= 100; i++) {
            page1.add(pending(i + "-0", IDLE + 1000));
        }
        List<PendingMessage> page2 = Collections.singletonList(pending("200-0", IDLE + 1000));

        when(streamOps.pending(eq("byai_gateway:session:10:data_stream"), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, page1))
            .thenReturn(new PendingMessages(GROUP, page2));

        invokeClaim();

        // 两页各 claim 一次（第二页不足 100 条，循环结束）。
        verify(streamOps, times(2)).claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class));
    }

    @Test
    void skipsIdleNotYetMetButClaimsEligible() {
        // 单页：一条 idle 已满、一条 idle 未满 → 只 claim 已满的那条。
        List<PendingMessage> page = new ArrayList<>();
        page.add(pending("100-0", IDLE + 1000));
        page.add(pending("101-0", IDLE - 1000));

        when(streamOps.pending(eq("byai_gateway:session:10:data_stream"), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, page));

        invokeClaim();

        ArgumentCaptor<RedisStreamCommands.XClaimOptions> captor =
            ArgumentCaptor.forClass(RedisStreamCommands.XClaimOptions.class);
        verify(streamOps, times(1)).claim(any(), any(), any(), captor.capture());
        // 只有 idle 已满的 100-0 被纳入 claim，101-0 被过滤。
        List<RecordId> claimedIds = captor.getValue().getIds();
        org.junit.jupiter.api.Assertions.assertEquals(1, claimedIds.size());
        org.junit.jupiter.api.Assertions.assertEquals("100-0", claimedIds.get(0).getValue());
    }

    @Test
    void noClaimWhenPelEmpty() {
        when(streamOps.pending(any(), eq(GROUP), any(Range.class), anyLong()))
            .thenReturn(new PendingMessages(GROUP, Collections.emptyList()));

        invokeClaim();

        verify(streamOps, never()).claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class));
    }
}
