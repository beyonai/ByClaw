package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.BooleanSupplier;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;
import com.iwhalecloud.byai.state.domain.ws.handler.SessionStatusRedisMessageListener;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.InstantiationAwareBeanPostProcessor;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.data.redis.connection.RedisStreamCommands;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.HashOperations;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.test.util.ReflectionTestUtils;

class SessionStreamManagerConcurrencyTest {

    private final AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
    private final SessionStreamLeaseService leases = mock(SessionStreamLeaseService.class);
    private final OutputStreamManager outputs = new OutputStreamManager();
    private final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
    private final ReactiveSessionStreamReceiver reactiveReceiver = mock(ReactiveSessionStreamReceiver.class);
    private final List<ScheduledExecutorService> acceleratedSchedulers = new ArrayList<>();
    private final List<RedisStreamMessageListener> listeners = new CopyOnWriteArrayList<>();
    private SessionStreamManager manager;

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        context.getBeanFactory().addBeanPostProcessor(new InstantiationAwareBeanPostProcessor() {
            @Override
            public boolean postProcessAfterInstantiation(Object bean, String beanName) {
                // Dependencies are boundary doubles, so do not autowire their unrelated implementation fields.
                return !org.mockito.Mockito.mockingDetails(bean).isMock();
            }
        });
        RedisTemplate<String, Object> redis = mock(RedisTemplate.class);
        when(redis.hasKey(any())).thenReturn(true);
        when(redis.opsForStream()).thenReturn(mock(StreamOperations.class));
        when(redis.opsForHash()).thenReturn(mock(HashOperations.class));
        when(leases.tryAcquire(any())).thenAnswer(invocation -> Optional.of(
            new SessionStreamLeaseService.Lease(invocation.getArgument(0), "owner")));
        when(leases.renew(any())).thenReturn(true);
        when(leases.release(any())).thenReturn(true);
        when(reactiveReceiver.resume(any())).thenReturn(true);
        when(reactiveReceiver.isPaused(any())).thenReturn(true);
        ChatRuntimeInstance instance = mock(ChatRuntimeInstance.class);
        when(instance.getInstanceId()).thenReturn("test-instance");

        context.registerBean(RedisTemplate.class, () -> redis);
        context.registerBean(SessionStreamLeaseService.class, () -> leases);
        context.registerBean(OutputStreamManager.class, () -> outputs);
        context.registerBean(RunningOutputStreamRegistry.class, () -> running);
        context.registerBean(ChatRuntimeInstance.class, () -> instance);
        context.registerBean(ChatRuntimeStateService.class, () -> mock(ChatRuntimeStateService.class));
        context.registerBean(RunningChatSnapshotService.class, () -> mock(RunningChatSnapshotService.class));
        context.registerBean(StreamAckFailureRegistry.class, () -> mock(StreamAckFailureRegistry.class));
        context.registerBean(SessionStreamMetrics.class, () -> mock(SessionStreamMetrics.class));
        context.registerBean(ReactiveSessionStreamReceiver.class, () -> reactiveReceiver);
        context.registerBean(RedisMessageListenerContainer.class, () -> mock(RedisMessageListenerContainer.class));
        context.registerBean(SessionStatusRedisMessageListener.class, () -> mock(SessionStatusRedisMessageListener.class));
        context.registerBean(RedisStreamMessageListener.class, () -> {
            RedisStreamMessageListener listener = mock(RedisStreamMessageListener.class);
            listeners.add(listener);
            return listener;
        }, definition -> definition.setScope("prototype"));
        context.registerBean(SessionStreamManager.class);
        context.refresh();
        manager = context.getBean(SessionStreamManager.class);
    }

    @AfterEach
    void tearDown() {
        context.close();
        acceleratedSchedulers.forEach(ScheduledExecutorService::shutdownNow);
    }

    @Test
    void reactiveNioReadsUseExistingKeysBeyondTheFormer128ReaderLimit() {
        for (int index = 0; index < 129; index++) {
            assertTrue(manager.startSessionListener("session-" + index, null));
        }

        verify(reactiveReceiver).register(org.mockito.ArgumentMatchers.eq("session-0"),
            org.mockito.ArgumentMatchers.eq("byai_gateway:session:session-0:data_stream"), any(), any(),
            org.mockito.ArgumentMatchers.eq(false));
        verify(reactiveReceiver).register(org.mockito.ArgumentMatchers.eq("session-128"),
            org.mockito.ArgumentMatchers.eq("byai_gateway:session:session-128:data_stream"), any(), any(),
            org.mockito.ArgumentMatchers.eq(false));
        assertEquals(129, manager.activeSessionIdsSnapshot().size());
    }

    @Test
    @SuppressWarnings({"unchecked", "rawtypes"})
    void unreadTerminalCannotBePolledUntilAllPendingPagesHaveBeenCheckpointed() throws Exception {
        SessionStreamRecoveryService recovery = new SessionStreamRecoveryService();
        ChatRuntimeState state = new ChatRuntimeState();
        state.setSessionId(10L);
        state.setTraceId("recovered-trace");
        ChatProcessContext recovered = new ChatProcessContext(null, null);
        recovered.sessionId = 10L;
        recovered.traceId = "recovered-trace";
        recovered.recoveryOnly = true;
        ChatRuntimeStateService runtime = context.getBean(ChatRuntimeStateService.class);
        when(runtime.tryAcquireRecoveryLock(10L)).thenReturn(true);
        when(runtime.get(10L)).thenReturn(state);
        ChatContextRecoveryService contexts = mock(ChatContextRecoveryService.class);
        when(contexts.recover(state)).thenAnswer(call -> {
            outputs.putContext("10", recovered);
            return recovered;
        });
        RedisTemplate<String, Object> redis = context.getBean(RedisTemplate.class);
        StreamOperations<String, Object, Object> streams = redis.opsForStream();
        List<PendingMessage> page = new ArrayList<>();
        for (int index = 1001; index <= 1101; index++) {
            page.add(new PendingMessage(RecordId.of(index + "-0"),
                Consumer.from(SessionStreamManager.CONSUMER_GROUP, "old-owner"), Duration.ofMillis(1), 1));
        }
        when(streams.pending(any(), org.mockito.ArgumentMatchers.anyString(), any(Range.class),
                org.mockito.ArgumentMatchers.anyLong()))
            .thenReturn(new PendingMessages(SessionStreamManager.CONSUMER_GROUP, page.subList(0, 100)))
            .thenReturn(new PendingMessages(SessionStreamManager.CONSUMER_GROUP, page.subList(100, 101)));
        when(streams.claim(any(), any(), any(), any(RedisStreamCommands.XClaimOptions.class)))
            .thenAnswer(call -> ((RedisStreamCommands.XClaimOptions) call.getArgument(3)).getIds().stream()
                .map(id -> MapRecord.create("stream-10", Map.<Object, Object>of("data", "{}" )).withId(id)).toList());
        AtomicInteger checkpointed = new AtomicInteger();
        StreamRecordProcessor processor = mock(StreamRecordProcessor.class);
        when(processor.process(any())).thenAnswer(call -> {
            checkpointed.incrementAndGet();
            return StreamDispatchResult.HANDLED;
        });
        ReflectionTestUtils.setField(recovery, "chatRuntimeStateService", runtime);
        ReflectionTestUtils.setField(recovery, "chatContextRecoveryService", contexts);
        ReflectionTestUtils.setField(recovery, "sessionStreamManager", manager);
        ReflectionTestUtils.setField(recovery, "outputStreamManager", outputs);
        ReflectionTestUtils.setField(recovery, "runningOutputStreamRegistry", running);
        ReflectionTestUtils.setField(recovery, "redisTemplate", redis);
        ReflectionTestUtils.setField(recovery, "streamRecordProcessor", processor);
        ReflectionTestUtils.setField(recovery, "streamAckFailureRegistry", new StreamAckFailureRegistry());
        try {
            ReflectionTestUtils.invokeMethod(recovery, "recoverState", state, true);
            assertEquals(100, checkpointed.get(), "One pass must remain bounded to one PEL page");
            verify(reactiveReceiver, never()).resume("10");

            verify(reactiveReceiver, timeout(3000)).resume("10");
            assertEquals(101, checkpointed.get());
        }
        finally {
            recovery.shutdown();
        }
    }

    @Test
    void renewalExceptionStopsTheListenerInsteadOfSilentlyLosingFutureRenewals() throws Exception {
        accelerateSchedulers();
        when(leases.renew(any())).thenThrow(new IllegalStateException("Redis unavailable"));

        manager.startSessionListener("first", null);

        assertTrue(await(() -> !manager.isSessionListenerActive("first")),
            "An owner whose lease cannot be renewed must stop consumption");
        verify(listeners.getFirst()).close();
        verify(leases).release(new SessionStreamLeaseService.Lease("first", "owner"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void saturatedKeepAliveWorkDoesNotStarveLeaseRenewals() throws Exception {
        accelerateSchedulers();
        CountDownLatch keepAlivesBlocked = new CountDownLatch(4);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch renewed = new CountDownLatch(1);
        doAnswer(invocation -> {
            keepAlivesBlocked.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return null;
        }).when(running).touchRunning(any());
        try {
            for (int index = 0; index < 4; index++) {
                ChatProcessContext chat = new ChatProcessContext(null, null);
                chat.sessionId = (long) index;
                outputs.putContext(String.valueOf(index), chat);
                ReflectionTestUtils.invokeMethod(manager, "startKeepAlive", String.valueOf(index), chat);
            }
            assertTrue(keepAlivesBlocked.await(1, TimeUnit.SECONDS));
            SessionStreamLeaseService.Lease probe = new SessionStreamLeaseService.Lease("probe", "owner");
            ((Map<String, SessionStreamLeaseService.Lease>) ReflectionTestUtils.getField(manager, "streamLeases"))
                .put("probe", probe);
            when(leases.renew(probe)).thenAnswer(invocation -> {
                renewed.countDown();
                return true;
            });
            ReflectionTestUtils.invokeMethod(manager, "startStreamLeaseRenewal", "probe", probe);

            assertTrue(renewed.await(1, TimeUnit.SECONDS), "Lease renewal must have independent bounded capacity");
        }
        finally {
            release.countDown();
        }
    }

    @Test
    void simultaneousStartsForOneSessionShareOneLeaseAndReader() throws Exception {
        CountDownLatch acquiring = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        AtomicInteger attempts = new AtomicInteger();
        when(leases.tryAcquire("first")).thenAnswer(invocation -> {
            if (attempts.incrementAndGet() == 1) {
                acquiring.countDown();
                assertTrue(release.await(3, TimeUnit.SECONDS));
            }
            return Optional.of(new SessionStreamLeaseService.Lease("first", "owner"));
        });
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var first = executor.submit(() -> manager.startSessionListener("first", null));
                assertTrue(acquiring.await(1, TimeUnit.SECONDS));
                var second = executor.submit(() -> manager.startSessionListener("first", null));
                assertThrows(TimeoutException.class, () -> second.get(100, TimeUnit.MILLISECONDS));
                release.countDown();
                assertTrue(first.get(2, TimeUnit.SECONDS));
                assertTrue(second.get(2, TimeUnit.SECONDS));
                verify(leases).tryAcquire("first");
            }
            finally {
                release.countDown();
            }
        }
    }

    /**
     * 重新使用保留窗口内的 session 时，必须把上一轮终结留下的剩余 TTL 撑开到完整的 session 生命周期，
     * 否则 Redis 会在会话活跃期间回收整个 Stream Key，消费者随即收到 NOGROUP。
     */
    @Test
    void restartingASessionRefreshesTheRetentionLeftBehindByItsPreviousCompletion() {
        RedisTemplate<String, Object> redis = context.getBean(RedisTemplate.class);

        assertTrue(manager.startSessionListener("first", null));

        verify(redis).expire(eq(manager.buildStreamKey("first")), anyLong(), eq(TimeUnit.SECONDS));
    }

    /**
     * 终结清理与新一轮对话启动竞争同一个 Stream Key 的 TTL：启动侧撑开 TTL，清理侧收紧 TTL。
     * 清理必须在 session 锁内判定并设置，否则「判定无 listener」之后启动的会话，
     * 其刷新结果会被清理覆盖，活跃 Stream 重新带上已终结的保留期并可能在会话中途被回收。
     */
    @Test
    void completedTrimSerializesWithSessionRestartOnTheSameStream() throws Exception {
        CountDownLatch trimEntered = new CountDownLatch(1);
        CountDownLatch releaseLock = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var holder = executor.submit(() -> outputs.withSessionLock("first", () -> {
                    trimEntered.countDown();
                    awaitUninterruptibly(releaseLock);
                    return null;
                }));
                assertTrue(trimEntered.await(1, TimeUnit.SECONDS));

                var trim = executor.submit(() -> manager.trimCompletedStream("first"));
                assertThrows(TimeoutException.class, () -> trim.get(200, TimeUnit.MILLISECONDS),
                    "Trim must not decide on retention while a restart holds the session lock");

                releaseLock.countDown();
                trim.get(2, TimeUnit.SECONDS);
                holder.get(2, TimeUnit.SECONDS);
            }
            finally {
                releaseLock.countDown();
            }
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void slowStatusStartupDoesNotHoldOtherSessionsLifecycleLocks() throws Exception {
        RedisTemplate<String, Object> redis = context.getBean(RedisTemplate.class);
        CountDownLatch reading = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(redis.opsForHash().get(manager.buildSessionStatusKey("first"), "main")).thenAnswer(invocation -> {
            reading.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return null;
        });
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var first = executor.submit(() -> ReflectionTestUtils.invokeMethod(
                    manager, "startSessionStatusListener", "first", (Long) null));
                assertTrue(reading.await(1, TimeUnit.SECONDS));
                executor.submit(() -> ReflectionTestUtils.invokeMethod(
                    manager, "startSessionStatusListener", "second", (Long) null)).get(1, TimeUnit.SECONDS);
                release.countDown();
                first.get(2, TimeUnit.SECONDS);
            }
            finally {
                release.countDown();
            }
        }
    }

    private void accelerateSchedulers() throws Exception {
        for (Field field : SessionStreamManager.class.getDeclaredFields()) {
            if (field.getType() == ScheduledExecutorService.class) {
                field.setAccessible(true);
                ((ScheduledExecutorService) field.get(manager)).shutdownNow();
                ScheduledThreadPoolExecutor accelerated = new ScheduledThreadPoolExecutor(4) {
                    @Override
                    public ScheduledFuture<?> scheduleAtFixedRate(Runnable task, long initialDelay, long period,
                            TimeUnit unit) {
                        return super.scheduleAtFixedRate(task, 0, 100, TimeUnit.MILLISECONDS);
                    }
                };
                acceleratedSchedulers.add(accelerated);
                field.set(manager, accelerated);
            }
        }
    }

    private static boolean await(BooleanSupplier predicate) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (!predicate.getAsBoolean()) {
            if (System.nanoTime() >= deadline) {
                return false;
            }
            Thread.sleep(10);
        }
        return true;
    }

    private static void awaitUninterruptibly(CountDownLatch gate) {
        boolean interrupted = false;
        while (true) {
            try {
                gate.await();
                break;
            }
            catch (InterruptedException ignored) {
                interrupted = true;
            }
        }
        if (interrupted) {
            Thread.currentThread().interrupt();
        }
    }

}
