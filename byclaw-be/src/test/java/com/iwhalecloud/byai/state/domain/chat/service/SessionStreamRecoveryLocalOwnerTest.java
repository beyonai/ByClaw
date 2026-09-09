package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;

/**
 * 验证本机已接管、正在恢复消费的 session：扫描线程只做周期补捞（claim PEL），
 * 既不重复接管（startSessionListener），也不做超时强制收尾。
 * 会话何时结束由 worker 推送的终止事件驱动，避免把仍在进行的慢回答误判为停止而提前截断。
 */
class SessionStreamRecoveryLocalOwnerTest {

    private ChatRuntimeStateService chatRuntimeStateService;
    private OutputStreamManager outputStreamManager;
    private ChatRuntimeInstance chatRuntimeInstance;
    private SessionStreamManager sessionStreamManager;
    private RedisTemplate<String, Object> redisTemplate;
    private StreamAckFailureRegistry streamAckFailureRegistry;
    private SessionStreamRecoveryService recoveryService;

    private static final String LOCAL_INSTANCE = "host:local";

    @AfterEach
    void tearDown() {
        recoveryService.shutdown();
    }

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        recoveryService = new SessionStreamRecoveryService();
        chatRuntimeStateService = mockField("chatRuntimeStateService", ChatRuntimeStateService.class);
        outputStreamManager = mockField("outputStreamManager", OutputStreamManager.class);
        chatRuntimeInstance = mockField("chatRuntimeInstance", ChatRuntimeInstance.class);
        sessionStreamManager = mockField("sessionStreamManager", SessionStreamManager.class);
        redisTemplate = mockField("redisTemplate", RedisTemplate.class);
        mockField("chatContextRecoveryService", ChatContextRecoveryService.class);
        mockField("streamRecordProcessor", StreamRecordProcessor.class);
        mockField("runningOutputStreamRegistry", RunningOutputStreamRegistry.class);
        // 用真实注册表，便于直接登记 ACK 失败并验证定向 claim 行为。
        streamAckFailureRegistry = new StreamAckFailureRegistry();
        ReflectionTestUtils.setField(recoveryService, "streamAckFailureRegistry", streamAckFailureRegistry);

        when(chatRuntimeInstance.getInstanceId()).thenReturn(LOCAL_INSTANCE);
        when(chatRuntimeInstance.isDevelopment()).thenReturn(false);
        when(sessionStreamManager.buildStreamKey(anyString())).thenReturn("stream:10");
        when(sessionStreamManager.buildConsumerName(anyString())).thenReturn("consumer:10");
        // PEL 查询返回空，claim 逻辑走空转即可，本用例只关心是否被调用与是否重复接管。
        StreamOperations<String, Object, Object> streamOps = Mockito.mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(streamOps);
        when(streamOps.pending(anyString(), anyString(), any(org.springframework.data.domain.Range.class),
            org.mockito.ArgumentMatchers.anyLong())).thenReturn(null);
    }

    private <T> T mockField(String name, Class<T> type) {
        T mock = Mockito.mock(type);
        ReflectionTestUtils.setField(recoveryService, name, mock);
        return mock;
    }

    private ChatRuntimeState localState(long now) {
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(10L);
        state.setTraceId("trace-1");
        state.setOwnerInstanceId(LOCAL_INSTANCE);
        state.setStartedAt(now);
        // 心跳设为很久以前：若无本机 owner 短路，会误命中 stale 抢占，用来验证短路确实生效。
        state.setLastHeartbeatAt(now - 10 * 60_000L);
        state.setStatus(ChatRuntimeState.STATUS_RUNNING);
        return state;
    }

    private ChatProcessContext recoveryCtx() {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.traceId = "trace-1";
        ctx.recoveryOnly = true;
        return ctx;
    }

    private void scan() {
        ReflectionTestUtils.invokeMethod(recoveryService, "scanAndRecover");
    }

    @Test
    void periodicallyClaimsPendingWithoutReTakeover() {
        long now = System.currentTimeMillis();
        ChatRuntimeState state = localState(now);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(state));
        when(outputStreamManager.getContext("10")).thenReturn(recoveryCtx());

        scan();

        // 本机 owner 的 recovery ctx：周期补捞 pending（即使心跳早已 stale），且不重复接管。
        verify(redisTemplate.opsForStream(), timeout(1000).atLeastOnce())
            .pending(anyString(), anyString(), any(org.springframework.data.domain.Range.class),
                org.mockito.ArgumentMatchers.anyLong());
        verify(sessionStreamManager, never()).startSessionListener(any(), any());
    }

    private ChatProcessContext liveCtx() {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.traceId = "trace-1";
        ctx.recoveryOnly = false;
        return ctx;
    }

    /**
     * live listener 活跃且无 ACK 失败：不与其并发 claim，扫描直接跳过。
     */
    @Test
    void skipsClaimForHealthyLiveListener() {
        long now = System.currentTimeMillis();
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(localState(now)));
        when(outputStreamManager.getContext("10")).thenReturn(liveCtx());
        when(sessionStreamManager.isSessionListenerActive("10")).thenReturn(true);

        scan();

        verify(outputStreamManager, timeout(1000)).getContext("10");
        verify(redisTemplate.opsForStream(), never())
            .pending(anyString(), anyString(), any(org.springframework.data.domain.Range.class),
                org.mockito.ArgumentMatchers.anyLong());
        verify(sessionStreamManager, never()).startSessionListener(any(), any());
    }

    /**
     * live listener 活跃但 ACK 重试已耗尽：必须对登记的消息执行定向 claim，
     * 否则 keepAlive 会持续刷新心跳，该 session 永远等不到 stale 接管，pending 永久滞留。
     */
    @Test
    void claimsAckFailedMessagesForLiveListener() {
        long now = System.currentTimeMillis();
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(localState(now)));
        when(outputStreamManager.getContext("10")).thenReturn(liveCtx());
        when(sessionStreamManager.isSessionListenerActive("10")).thenReturn(true);
        streamAckFailureRegistry.record("stream:10", "100-0");

        scan();

        // 定向 claim 走 claim() 而非 pending() 扫描，且 minIdle 为 0。
        verify(redisTemplate.opsForStream(), timeout(1000)).claim(eq("stream:10"), anyString(), anyString(),
            any(org.springframework.data.redis.connection.RedisStreamCommands.XClaimOptions.class));
        // 登记项处理后清除，避免下一轮重复 claim 同一批消息。
        org.assertj.core.api.Assertions.assertThat(streamAckFailureRegistry.hasFailures("stream:10")).isFalse();
    }

    @Test
    void takesOverWhenLocalContextMissing() {
        long now = System.currentTimeMillis();
        ChatRuntimeState state = localState(now);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(state));
        // 本机内存无该 ctx（例如进程刚重启）：不再短路，走 stale 抢占恢复。
        when(outputStreamManager.getContext("10")).thenReturn(null);
        when(chatRuntimeStateService.tryAcquireRecoveryLock(eq(10L))).thenReturn(false);

        scan();

        // tryAcquireRecoveryLock 返回 false，recoverState 提前退出，不启动 listener，但确实尝试了抢占。
        verify(chatRuntimeStateService, timeout(1000).atLeastOnce()).tryAcquireRecoveryLock(eq(10L));
    }

    @Test
    void takesOverGracefulHandoffWithoutWaitingForHeartbeatToBecomeStale() {
        long now = System.currentTimeMillis();
        ChatRuntimeState state = localState(now);
        state.setStatus(ChatRuntimeState.STATUS_HANDOFF_REQUESTED);
        state.setLastHeartbeatAt(now);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(state));
        when(chatRuntimeStateService.tryAcquireRecoveryLock(eq(10L))).thenReturn(false);

        scan();

        verify(chatRuntimeStateService, timeout(1000)).tryAcquireRecoveryLock(10L);
    }

    @Test
    void slowSessionDoesNotBlockAnotherSessionInTheSameRecoveryPass() throws Exception {
        long now = System.currentTimeMillis();
        ChatRuntimeState first = localState(now);
        ChatRuntimeState second = localState(now);
        second.setSessionId(11L);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(List.of(first, second));
        when(outputStreamManager.getContext(anyString())).thenAnswer(call -> recoveryCtx(
            Long.parseLong(call.getArgument(0))));
        when(sessionStreamManager.buildStreamKey(anyString())).thenAnswer(call -> "stream:" + call.getArgument(0));
        CountDownLatch slowEntered = new CountDownLatch(1);
        CountDownLatch releaseSlow = new CountDownLatch(1);
        CountDownLatch secondEntered = new CountDownLatch(1);
        StreamOperations<String, Object, Object> streamOps = redisTemplate.opsForStream();
        when(streamOps.pending(eq("stream:10"), anyString(), any(org.springframework.data.domain.Range.class),
            org.mockito.ArgumentMatchers.anyLong())).thenAnswer(call -> {
                slowEntered.countDown();
                releaseSlow.await(2, TimeUnit.SECONDS);
                return null;
            });
        when(streamOps.pending(eq("stream:11"), anyString(), any(org.springframework.data.domain.Range.class),
            org.mockito.ArgumentMatchers.anyLong())).thenAnswer(call -> {
                secondEntered.countDown();
                return null;
            });

        CompletableFuture<Void> scan = CompletableFuture.runAsync(this::scan);
        try {
            org.junit.jupiter.api.Assertions.assertTrue(slowEntered.await(1, TimeUnit.SECONDS));
            org.junit.jupiter.api.Assertions.assertTrue(secondEntered.await(1, TimeUnit.SECONDS));
        }
        finally {
            releaseSlow.countDown();
            scan.get(2, TimeUnit.SECONDS);
        }
    }

    @Test
    void doesNotStartDuplicateJobForSessionAlreadyBeingRecovered() throws Exception {
        long now = System.currentTimeMillis();
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(localState(now)));
        when(outputStreamManager.getContext("10")).thenReturn(recoveryCtx());
        CountDownLatch firstEntered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch duplicateEntered = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        when(redisTemplate.opsForStream().pending(anyString(), anyString(),
            any(org.springframework.data.domain.Range.class), org.mockito.ArgumentMatchers.anyLong()))
            .thenAnswer(call -> {
                if (calls.incrementAndGet() == 1) {
                    firstEntered.countDown();
                    release.await(2, TimeUnit.SECONDS);
                }
                else {
                    duplicateEntered.countDown();
                }
                return null;
            });

        CompletableFuture<Void> firstScan = CompletableFuture.runAsync(this::scan);
        try {
            org.junit.jupiter.api.Assertions.assertTrue(firstEntered.await(1, TimeUnit.SECONDS));
            CompletableFuture<Void> secondScan = CompletableFuture.runAsync(this::scan);
            secondScan.get(1, TimeUnit.SECONDS);
            org.junit.jupiter.api.Assertions.assertFalse(duplicateEntered.await(200, TimeUnit.MILLISECONDS));
        }
        finally {
            release.countDown();
            firstScan.get(2, TimeUnit.SECONDS);
        }
    }

    @Test
    void failedRecoveryAdmissionRemovesTheContextsItPublished() {
        ChatRuntimeState state = localState(System.currentTimeMillis());
        ChatProcessContext ctx = recoveryCtx();
        when(chatRuntimeStateService.tryAcquireRecoveryLock(10L)).thenReturn(true);
        ChatContextRecoveryService contexts = (ChatContextRecoveryService)
            ReflectionTestUtils.getField(recoveryService, "chatContextRecoveryService");
        when(contexts.recover(state)).thenReturn(ctx);
        when(sessionStreamManager.startSessionListenerForRecovery("10", ctx))
            .thenThrow(new java.util.concurrent.RejectedExecutionException("reader capacity full"));

        org.junit.jupiter.api.Assertions.assertThrows(java.util.concurrent.RejectedExecutionException.class,
            () -> ReflectionTestUtils.invokeMethod(recoveryService, "recoverState", state, true));

        verify(outputStreamManager).removeContext("10", ctx);
    }

    @Test
    void failedRecoveryRegistrationStopsThePausedListener() {
        ChatRuntimeState state = localState(System.currentTimeMillis());
        ChatProcessContext ctx = recoveryCtx();
        when(chatRuntimeStateService.tryAcquireRecoveryLock(10L)).thenReturn(true);
        ChatContextRecoveryService contexts = (ChatContextRecoveryService)
            ReflectionTestUtils.getField(recoveryService, "chatContextRecoveryService");
        when(contexts.recover(state)).thenReturn(ctx);
        when(sessionStreamManager.startSessionListenerForRecovery("10", ctx)).thenReturn(true);
        when(sessionStreamManager.isSessionListenerPaused("10")).thenReturn(true);
        RunningOutputStreamRegistry running = (RunningOutputStreamRegistry)
            ReflectionTestUtils.getField(recoveryService, "runningOutputStreamRegistry");
        Mockito.doThrow(new IllegalStateException("running state unavailable")).when(running).markRunning(ctx);

        org.junit.jupiter.api.Assertions.assertThrows(IllegalStateException.class,
            () -> ReflectionTestUtils.invokeMethod(recoveryService, "recoverState", state, true));

        verify(sessionStreamManager).stopSessionListener("10");
    }

    private ChatProcessContext recoveryCtx(long sessionId) {
        ChatProcessContext ctx = recoveryCtx();
        ctx.sessionId = sessionId;
        return ctx;
    }

    @Test
    void developmentSkipsStaleSessionOwnedByOtherInstance() {
        long now = System.currentTimeMillis();
        ChatRuntimeState state = localState(now);
        state.setOwnerInstanceId("host:other");
        when(chatRuntimeInstance.isDevelopment()).thenReturn(true);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(state));

        scan();

        java.util.concurrent.ThreadPoolExecutor workers = (java.util.concurrent.ThreadPoolExecutor)
            ReflectionTestUtils.getField(recoveryService, "recoveryWorkers");
        org.junit.jupiter.api.Assertions.assertEquals(0L, workers.getTaskCount());
        verify(chatRuntimeStateService, never()).tryAcquireRecoveryLock(any());
        verify(sessionStreamManager, never()).startSessionListener(any(), any());
    }

    @Test
    void developmentSkipsHandoffRequestedByOtherInstance() {
        long now = System.currentTimeMillis();
        ChatRuntimeState state = localState(now);
        state.setOwnerInstanceId("host:other");
        state.setStatus(ChatRuntimeState.STATUS_HANDOFF_REQUESTED);
        when(chatRuntimeInstance.isDevelopment()).thenReturn(true);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(state));

        scan();

        java.util.concurrent.ThreadPoolExecutor workers = (java.util.concurrent.ThreadPoolExecutor)
            ReflectionTestUtils.getField(recoveryService, "recoveryWorkers");
        org.junit.jupiter.api.Assertions.assertEquals(0L, workers.getTaskCount());
        verify(chatRuntimeStateService, never()).tryAcquireRecoveryLock(any());
        verify(sessionStreamManager, never()).startSessionListener(any(), any());
    }

    @Test
    void developmentRecoversSessionOwnedBySameStableInstance() {
        long now = System.currentTimeMillis();
        ChatRuntimeState state = localState(now);
        when(chatRuntimeInstance.isDevelopment()).thenReturn(true);
        when(chatRuntimeStateService.listRunningStates()).thenReturn(Collections.singletonList(state));
        when(outputStreamManager.getContext("10")).thenReturn(null);
        when(chatRuntimeStateService.tryAcquireRecoveryLock(10L)).thenReturn(false);

        scan();

        verify(chatRuntimeStateService, timeout(1000)).tryAcquireRecoveryLock(10L);
    }
}
