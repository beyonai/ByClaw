package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;

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
    private SessionStreamRecoveryService recoveryService;

    private static final String LOCAL_INSTANCE = "host:local";

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
        mockField("sessionStreamEventRouter", SessionStreamEventRouter.class);
        mockField("runningOutputStreamRegistry", RunningOutputStreamRegistry.class);

        when(chatRuntimeInstance.getInstanceId()).thenReturn(LOCAL_INSTANCE);
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
        verify(redisTemplate.opsForStream(), atLeastOnce())
            .pending(anyString(), anyString(), any(org.springframework.data.domain.Range.class),
                org.mockito.ArgumentMatchers.anyLong());
        verify(sessionStreamManager, never()).startSessionListener(any(), any());
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
        verify(chatRuntimeStateService, atLeastOnce()).tryAcquireRecoveryLock(eq(10L));
    }
}
