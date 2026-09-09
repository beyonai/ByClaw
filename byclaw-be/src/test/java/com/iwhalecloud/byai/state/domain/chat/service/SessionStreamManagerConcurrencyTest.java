package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.lang.reflect.Field;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
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
import org.springframework.data.redis.connection.RedisConnection;
import org.springframework.data.redis.connection.RedisConnectionFactory;
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
import org.springframework.test.context.support.TestPropertySourceUtils;
import org.springframework.test.util.ReflectionTestUtils;

class SessionStreamManagerConcurrencyTest {

    private final AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext();
    private final SessionStreamLeaseService leases = mock(SessionStreamLeaseService.class);
    private final OutputStreamManager outputs = new OutputStreamManager();
    private final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);
    private final BlockingQueue<CountDownLatch> blockedReads = new LinkedBlockingQueue<>();
    private final List<CountDownLatch> readGates = new CopyOnWriteArrayList<>();
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
        RedisConnectionFactory factory = mock(RedisConnectionFactory.class);
        RedisConnection connection = mock(RedisConnection.class);
        when(connection.streamCommands()).thenReturn(mock(RedisStreamCommands.class));
        when(factory.getConnection()).thenAnswer(invocation -> {
            CountDownLatch gate = new CountDownLatch(1);
            readGates.add(gate);
            blockedReads.add(gate);
            awaitUninterruptibly(gate);
            return connection;
        });
        RedisTemplate<String, Object> redis = mock(RedisTemplate.class);
        when(redis.hasKey(any())).thenReturn(true);
        when(redis.opsForStream()).thenReturn(mock(StreamOperations.class));
        when(redis.opsForHash()).thenReturn(mock(HashOperations.class));
        when(leases.tryAcquire(any())).thenAnswer(invocation -> Optional.of(
            new SessionStreamLeaseService.Lease(invocation.getArgument(0), "owner")));
        when(leases.renew(any())).thenReturn(true);
        when(leases.release(any())).thenReturn(true);
        ChatRuntimeInstance instance = mock(ChatRuntimeInstance.class);
        when(instance.getInstanceId()).thenReturn("test-instance");

        TestPropertySourceUtils.addInlinedPropertiesToEnvironment(context,
            "byclaw.session-stream.max-listeners=1");
        context.registerBean("redisConnectionFactory", RedisConnectionFactory.class, () -> factory,
            definition -> definition.setPrimary(true));
        context.registerBean("sessionStreamRedisConnectionFactory", RedisConnectionFactory.class, () -> factory);
        context.registerBean(RedisTemplate.class, () -> redis);
        context.registerBean(SessionStreamLeaseService.class, () -> leases);
        context.registerBean(OutputStreamManager.class, () -> outputs);
        context.registerBean(RunningOutputStreamRegistry.class, () -> running);
        context.registerBean(ChatRuntimeInstance.class, () -> instance);
        context.registerBean(ChatRuntimeStateService.class, () -> mock(ChatRuntimeStateService.class));
        context.registerBean(RunningChatSnapshotService.class, () -> mock(RunningChatSnapshotService.class));
        context.registerBean(StreamAckFailureRegistry.class, () -> mock(StreamAckFailureRegistry.class));
        context.registerBean(SessionStreamMetrics.class, () -> mock(SessionStreamMetrics.class));
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
        readGates.forEach(CountDownLatch::countDown);
        acceleratedSchedulers.forEach(ScheduledExecutorService::shutdownNow);
    }

    @Test
    void stoppingAContainerKeepsAdmissionUntilItsBlockingReadActuallyExits() throws Exception {
        assertTrue(manager.startSessionListener("first", null));
        CountDownLatch firstRead = blockedReads.poll(2, TimeUnit.SECONDS);
        assertTrue(firstRead != null);
        manager.stopSessionListener("first");

        assertThrows(RejectedExecutionException.class, () -> manager.startSessionListener("second", null));
        verify(leases, never()).tryAcquire("second");
        verify(listeners.getFirst()).close();

        firstRead.countDown();
        assertTrue(await(() -> {
            try {
                return manager.startSessionListener("second", null);
            }
            catch (RejectedExecutionException busy) {
                return false;
            }
        }));
        assertTrue(manager.isSessionListenerActive("second"));
    }

    @Test
    void listenerAdmissionIncludesStartsStillAcquiringTheirLease() throws Exception {
        CountDownLatch acquiring = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(leases.tryAcquire("first")).thenAnswer(invocation -> {
            acquiring.countDown();
            assertTrue(release.await(3, TimeUnit.SECONDS));
            return Optional.of(new SessionStreamLeaseService.Lease("first", "owner"));
        });
        try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                var first = executor.submit(() -> manager.startSessionListener("first", null));
                assertTrue(acquiring.await(1, TimeUnit.SECONDS));
                assertThrows(RejectedExecutionException.class, () -> manager.startSessionListener("second", null));
                verify(leases, never()).tryAcquire("second");
                release.countDown();
                assertTrue(first.get(2, TimeUnit.SECONDS));
            }
            finally {
                release.countDown();
            }
        }
    }

    @Test
    void failingLeaseAcquisitionReturnsItsUnusedAdmission() {
        when(leases.tryAcquire("first")).thenThrow(new IllegalStateException("Redis unavailable"));
        assertThrows(IllegalStateException.class, () -> manager.startSessionListener("first", null));
        assertTrue(manager.startSessionListener("second", null));
    }

    @Test
    void pausedRecoveryListenerHoldsAdmissionUntilStoppedWithoutStartingARead() throws Exception {
        startPaused("first");
        assertTrue(manager.isSessionListenerActive("first"));
        assertNull(blockedReads.poll(100, TimeUnit.MILLISECONDS), "Recovery must reserve ownership without polling unread");
        assertThrows(RejectedExecutionException.class, () -> manager.startSessionListener("second", null));

        manager.stopSessionListener("first");

        assertTrue(manager.startSessionListener("second", null), "Unused recovery admission must be returned on stop");
        assertNotNull(blockedReads.poll(2, TimeUnit.SECONDS));
    }

    @Test
    void pausedRecoveryListenerResumesExactlyOneOwnedRead() throws Exception {
        startPaused("first");
        assertNull(blockedReads.poll(100, TimeUnit.MILLISECONDS));
        ReflectionTestUtils.invokeMethod(manager, "resumeRecoveredSessionListener", "first");
        assertNotNull(blockedReads.poll(2, TimeUnit.SECONDS));
        ReflectionTestUtils.invokeMethod(manager, "resumeRecoveredSessionListener", "first");
        assertNull(blockedReads.poll(100, TimeUnit.MILLISECONDS));
        verify(leases).tryAcquire("first");
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
            assertNull(blockedReads.poll(100, TimeUnit.MILLISECONDS), "Unread terminal would overtake pending page two");

            assertNotNull(blockedReads.poll(3, TimeUnit.SECONDS), "Backlog continuation must run before the 30s global scan");
            assertEquals(101, checkpointed.get());
        }
        finally {
            recovery.shutdown();
        }
    }

    private void startPaused(String sessionId) {
        var method = org.springframework.util.ReflectionUtils.findMethod(SessionStreamManager.class,
            "startSessionListenerForRecovery", String.class, ChatProcessContext.class);
        assertNotNull(method, "Recovery needs an owned, admitted listener that defers unread polling");
        assertTrue((Boolean) ReflectionTestUtils.invokeMethod(manager, "startSessionListenerForRecovery", sessionId, null));
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
