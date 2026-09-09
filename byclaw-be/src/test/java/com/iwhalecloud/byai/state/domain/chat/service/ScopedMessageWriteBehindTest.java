package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CompletableFuture;
import java.util.List;
import java.util.ArrayList;
import java.util.function.Consumer;
import java.util.concurrent.atomic.AtomicInteger;

import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

class ScopedMessageWriteBehindTest {

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @Test
    void startupRecoveryDoesNotBlockTheApplicationReadyListener() throws Exception {
        RunningChatSnapshotService snapshots = Mockito.mock(RunningChatSnapshotService.class);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            entered.countDown();
            release.await(5, TimeUnit.SECONDS);
            return null;
        }).when(snapshots).findExternalChildSnapshots(Mockito.any(Consumer.class));
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(Mockito.mock(ByaiMessageHotService.class),
            Mockito.mock(SessionService.class), 0, 20, scheduler);
        ReflectionTestUtils.setField(queue, "runningChatSnapshotService", snapshots);
        try {
            CompletableFuture.runAsync(queue::recoverDurableSnapshots).get(1, TimeUnit.SECONDS);
            assertThat(entered.await(1, TimeUnit.SECONDS)).isTrue();
        }
        finally {
            release.countDown();
            queue.shutdown();
        }
    }

    @Test
    void recoveryDoesNotReplaceALiveMessageAlreadyQueued() throws Exception {
        ByaiMessageHotService messages = Mockito.mock(ByaiMessageHotService.class);
        RunningChatSnapshotService snapshots = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotResponse old = new RunningChatSnapshotResponse();
        old.setSessionId(20L);
        old.setMessageId(21L);
        old.setMessageContent("old recovered output");
        old.setRunning(false);
        CountDownLatch delivered = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            invocation.getArgument(0, Consumer.class).accept(List.of(old));
            delivered.countDown();
            return null;
        }).when(snapshots).findExternalChildSnapshots(Mockito.any(Consumer.class));
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messages,
            Mockito.mock(SessionService.class), TimeUnit.MINUTES.toMillis(1), 20, scheduler);
        ReflectionTestUtils.setField(queue, "runningChatSnapshotService", snapshots);
        queue.enqueue("child:20:21", 20L, message(21L, "new live output"), false);
        try {
            queue.recoverDurableSnapshots();
            assertThat(delivered.await(2, TimeUnit.SECONDS)).isTrue();
        }
        finally {
            queue.shutdown();
        }
        verify(messages).updateSelective(Mockito.argThat(message -> "new live output".equals(message.getMessageContent())));
        verify(messages, Mockito.never()).updateSelective(Mockito.argThat(message ->
            "old recovered output".equals(message.getMessageContent())));
    }

    @Test
    void recoveryRechecksTheWatermarkBeforeWritingToTheDatabase() throws Exception {
        ByaiMessageHotService messages = Mockito.mock(ByaiMessageHotService.class);
        RunningChatSnapshotService snapshots = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotResponse old = new RunningChatSnapshotResponse();
        old.setSessionId(20L);
        old.setMessageId(21L);
        old.setRunning(false);
        CountDownLatch rechecked = new CountDownLatch(1);
        Mockito.when(snapshots.isExternalChildPersisted(Mockito.any())).thenAnswer(invocation -> {
            rechecked.countDown();
            return true;
        });
        Mockito.doAnswer(invocation -> {
            invocation.getArgument(0, Consumer.class).accept(List.of(old));
            return null;
        }).when(snapshots).findExternalChildSnapshots(Mockito.any(Consumer.class));
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messages,
            Mockito.mock(SessionService.class), 0, 20, scheduler);
        ReflectionTestUtils.setField(queue, "runningChatSnapshotService", snapshots);
        try {
            queue.recoverDurableSnapshots();
            assertThat(rechecked.await(2, TimeUnit.SECONDS)).isTrue();
        }
        finally {
            queue.shutdown();
        }
        verify(messages, Mockito.never()).updateSelective(Mockito.any());
        verify(snapshots, Mockito.never()).markExternalChildPersisted(Mockito.any());
    }

    @Test
    void recoveryBackpressureDoesNotBlockLiveEnqueues() throws Exception {
        ByaiMessageHotService messages = Mockito.mock(ByaiMessageHotService.class);
        RunningChatSnapshotService snapshots = Mockito.mock(RunningChatSnapshotService.class);
        CountDownLatch releaseDatabase = new CountDownLatch(1);
        CountDownLatch firstBatchQueued = new CountDownLatch(1);
        CountDownLatch secondBatchQueued = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            releaseDatabase.await(5, TimeUnit.SECONDS);
            return null;
        }).when(messages).updateSelective(Mockito.any());
        List<RunningChatSnapshotResponse> batch = new ArrayList<>();
        for (long id = 1; id <= 100; id++) {
            RunningChatSnapshotResponse snapshot = new RunningChatSnapshotResponse();
            snapshot.setSessionId(id);
            snapshot.setMessageId(id);
            snapshot.setRunning(false);
            batch.add(snapshot);
        }
        Mockito.doAnswer(invocation -> {
            Consumer<List<RunningChatSnapshotResponse>> consumer = invocation.getArgument(0);
            consumer.accept(batch);
            firstBatchQueued.countDown();
            consumer.accept(List.of(batch.getFirst()));
            secondBatchQueued.countDown();
            return null;
        }).when(snapshots).findExternalChildSnapshots(Mockito.any(Consumer.class));
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messages,
            Mockito.mock(SessionService.class), 0, 20, scheduler);
        ReflectionTestUtils.setField(queue, "runningChatSnapshotService", snapshots);
        try {
            queue.recoverDurableSnapshots();
            assertThat(firstBatchQueued.await(2, TimeUnit.SECONDS)).isTrue();
            CompletableFuture.runAsync(() -> queue.enqueue("live:201", 201L, message(201L, "live"), false))
                .get(1, TimeUnit.SECONDS);
            assertThat(secondBatchQueued.await(250, TimeUnit.MILLISECONDS)).isFalse();
        }
        finally {
            releaseDatabase.countDown();
            queue.shutdown();
        }
    }

    @AfterEach
    void tearDown() {
        scheduler.shutdownNow();
    }

    @Test
    void coalescesIntermediateSnapshotsAndPersistsOnlyTheNewestRevision() {
        ByaiMessageHotService messageService = Mockito.mock(ByaiMessageHotService.class);
        SessionService sessionService = Mockito.mock(SessionService.class);
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messageService, sessionService,
            40L, 20L, scheduler);

        queue.enqueue("root:child", 20L, message(1L, "a"), false);
        queue.enqueue("root:child", 20L, message(1L, "ab"), false);
        queue.enqueue("root:child", 20L, message(1L, "abc"), false);

        ArgumentCaptor<ByaiMessageHotDtoDto> captor = ArgumentCaptor.forClass(ByaiMessageHotDtoDto.class);
        verify(messageService, timeout(1000).times(1)).updateSelective(captor.capture());
        assertThat(captor.getValue().getMessageContent()).isEqualTo("abc");
        verify(sessionService, timeout(1000).times(1)).touchUpdateTime(20L);
    }

    @Test
    void terminalEnqueueReturnsBeforeBlockingDatabaseWriteCompletes() throws Exception {
        ByaiMessageHotService messageService = Mockito.mock(ByaiMessageHotService.class);
        SessionService sessionService = Mockito.mock(SessionService.class);
        CountDownLatch writeStarted = new CountDownLatch(1);
        CountDownLatch releaseWrite = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            writeStarted.countDown();
            releaseWrite.await(1, TimeUnit.SECONDS);
            return null;
        }).when(messageService).updateSelective(Mockito.any());
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messageService, sessionService,
            500L, 20L, scheduler);

        long startedAt = System.nanoTime();
        queue.enqueue("root:child", 20L, message(1L, "done"), true);
        long enqueueMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - startedAt);

        assertThat(enqueueMillis).isLessThan(50L);
        assertThat(writeStarted.await(1, TimeUnit.SECONDS)).isTrue();
        releaseWrite.countDown();
        verify(sessionService, timeout(1000)).touchUpdateTime(20L);
    }

    @Test
    void retainsTheLatestSnapshotAndRetriesAfterDatabaseFailure() {
        ByaiMessageHotService messageService = Mockito.mock(ByaiMessageHotService.class);
        SessionService sessionService = Mockito.mock(SessionService.class);
        AtomicInteger attempts = new AtomicInteger();
        Mockito.doAnswer(invocation -> {
            if (attempts.getAndIncrement() == 0) {
                throw new IllegalStateException("temporary database failure");
            }
            return null;
        }).when(messageService).updateSelective(Mockito.any());
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messageService, sessionService,
            0L, 20L, scheduler);

        queue.enqueue("root:child", 20L, message(1L, "latest"), true);

        verify(messageService, timeout(1000).times(2)).updateSelective(Mockito.argThat(message ->
            "latest".equals(message.getMessageContent())));
        verify(sessionService, timeout(1000).times(1)).touchUpdateTime(20L);
    }

    @Test
    void flushesDelayedSnapshotBeforeShutdownCompletes() {
        ByaiMessageHotService messageService = Mockito.mock(ByaiMessageHotService.class);
        SessionService sessionService = Mockito.mock(SessionService.class);
        ScopedMessageWriteBehind queue = new ScopedMessageWriteBehind(messageService, sessionService,
            TimeUnit.MINUTES.toMillis(1), 20L, scheduler);

        queue.enqueue("root:child", 20L, message(1L, "shutdown-latest"), false);
        queue.shutdown();

        verify(messageService).updateSelective(Mockito.argThat(message ->
            "shutdown-latest".equals(message.getMessageContent())));
        verify(sessionService).touchUpdateTime(20L);
    }

    private ByaiMessageHotDtoDto message(Long messageId, String content) {
        ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
        message.setMessageId(messageId);
        message.setMessageContent(content);
        return message;
    }
}
