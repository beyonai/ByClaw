package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.ScheduledExecutorService;

import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class RunningChatSnapshotWriteBehindTest {

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

    @AfterEach
    void tearDown() {
        scheduler.shutdownNow();
    }

    @Test
    void coalescesBurstSnapshotsWithoutBlockingTheStreamConsumer() {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind =
            new RunningChatSnapshotWriteBehind(snapshotService, 30L, scheduler);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext first = Mockito.mock(MessageContext.class);
        MessageContext latest = Mockito.mock(MessageContext.class);

        writeBehind.enqueue("session:20:trace", context, "trace", first);
        writeBehind.enqueue("session:20:trace", context, "trace", latest);

        verify(snapshotService, timeout(1000).times(1)).save(context, "trace", latest);
    }

    @Test
    void terminalFlushSupersedesPendingSnapshotSynchronously() {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind =
            new RunningChatSnapshotWriteBehind(snapshotService, 60_000L, scheduler);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext pending = Mockito.mock(MessageContext.class);
        MessageContext terminal = Mockito.mock(MessageContext.class);

        writeBehind.enqueue("session:20:trace", context, "trace", pending);
        writeBehind.flushNow("session:20:trace", context, "trace", terminal);

        verify(snapshotService).save(context, "trace", terminal);
        verify(snapshotService, Mockito.never()).save(context, "trace", pending);
    }

    @Test
    void enqueueReturnsWhileAnOlderSnapshotIsBlockedInRedis() throws Exception {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind =
            new RunningChatSnapshotWriteBehind(snapshotService, 0L, scheduler);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext first = Mockito.mock(MessageContext.class);
        MessageContext latest = Mockito.mock(MessageContext.class);
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            writing.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return null;
        }).when(snapshotService).save(context, "trace", first);

        try (ExecutorService consumers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                writeBehind.enqueue("key", context, "trace", first);
                assertTrue(writing.await(2, TimeUnit.SECONDS));
                consumers.submit(() -> writeBehind.enqueue("key", context, "trace", latest))
                    .get(1, TimeUnit.SECONDS);
            }
            finally {
                release.countDown();
            }
            verify(snapshotService, timeout(2000)).save(context, "trace", latest);
        }
    }

    @Test
    void aBlockedKeyDoesNotStopAnotherKeysScheduledWrite() throws Exception {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind = new RunningChatSnapshotWriteBehind(snapshotService, 0L);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext slow = Mockito.mock(MessageContext.class);
        MessageContext independent = Mockito.mock(MessageContext.class);
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch independentSaved = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            writing.countDown();
            assertTrue(release.await(5, TimeUnit.SECONDS));
            return null;
        }).when(snapshotService).save(context, "slow", slow);
        Mockito.doAnswer(invocation -> {
            independentSaved.countDown();
            return null;
        }).when(snapshotService).save(context, "independent", independent);

        try {
            writeBehind.enqueue("slow", context, "slow", slow);
            assertTrue(writing.await(2, TimeUnit.SECONDS));
            writeBehind.enqueue("independent", context, "independent", independent);
            assertTrue(independentSaved.await(1, TimeUnit.SECONDS), "Unrelated Redis writes must make progress");
        }
        finally {
            release.countDown();
            writeBehind.shutdown();
        }
    }

    @Test
    void terminalFlushWaitsForInflightWriteAndDiscardsOlderPendingSnapshots() throws Exception {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind =
            new RunningChatSnapshotWriteBehind(snapshotService, 0L, scheduler);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext first = Mockito.mock(MessageContext.class);
        MessageContext pending = Mockito.mock(MessageContext.class);
        MessageContext terminal = Mockito.mock(MessageContext.class);
        List<MessageContext> saved = new CopyOnWriteArrayList<>();
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            MessageContext message = invocation.getArgument(2);
            if (message == first) {
                writing.countDown();
                assertTrue(release.await(5, TimeUnit.SECONDS));
            }
            saved.add(message);
            return null;
        }).when(snapshotService).save(Mockito.eq(context), Mockito.eq("trace"), Mockito.any());

        try (ExecutorService consumers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                writeBehind.enqueue("key", context, "trace", first);
                assertTrue(writing.await(2, TimeUnit.SECONDS));
                consumers.submit(() -> writeBehind.enqueue("key", context, "trace", pending))
                    .get(1, TimeUnit.SECONDS);
                Future<?> flush = consumers.submit(() -> writeBehind.flushNow("key", context, "trace", terminal));
                assertThrows(TimeoutException.class, () -> flush.get(100, TimeUnit.MILLISECONDS));
                release.countDown();
                flush.get(2, TimeUnit.SECONDS);
                writeBehind.shutdown();
                assertEquals(List.of(first, terminal), saved);
            }
            finally {
                release.countDown();
            }
        }
    }

    @Test
    void shutdownPersistsLatestSnapshotAfterAnInflightWrite() throws Exception {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind =
            new RunningChatSnapshotWriteBehind(snapshotService, 0L, scheduler);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext first = Mockito.mock(MessageContext.class);
        MessageContext latest = Mockito.mock(MessageContext.class);
        List<MessageContext> saved = new CopyOnWriteArrayList<>();
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            MessageContext message = invocation.getArgument(2);
            if (message == first) {
                writing.countDown();
                assertTrue(release.await(5, TimeUnit.SECONDS));
            }
            saved.add(message);
            return null;
        }).when(snapshotService).save(Mockito.eq(context), Mockito.eq("trace"), Mockito.any());

        try (ExecutorService consumers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                writeBehind.enqueue("key", context, "trace", first);
                assertTrue(writing.await(2, TimeUnit.SECONDS));
                consumers.submit(() -> writeBehind.enqueue("key", context, "trace", latest))
                    .get(1, TimeUnit.SECONDS);
                Future<?> shutdown = consumers.submit(writeBehind::shutdown);
                assertThrows(TimeoutException.class, () -> shutdown.get(100, TimeUnit.MILLISECONDS));
                release.countDown();
                shutdown.get(2, TimeUnit.SECONDS);
                assertEquals(List.of(first, latest), saved);
            }
            finally {
                release.countDown();
            }
        }
    }


    @Test
    void enqueueDuringTerminalRedisWriteCannotReplaceTheTerminalSnapshot() throws Exception {
        RunningChatSnapshotService snapshotService = Mockito.mock(RunningChatSnapshotService.class);
        RunningChatSnapshotWriteBehind writeBehind =
            new RunningChatSnapshotWriteBehind(snapshotService, 60_000L, scheduler);
        ChatProcessContext context = new ChatProcessContext(null, new AssistantChatDto());
        MessageContext pending = Mockito.mock(MessageContext.class);
        MessageContext stale = Mockito.mock(MessageContext.class);
        MessageContext terminal = Mockito.mock(MessageContext.class);
        List<MessageContext> saved = new CopyOnWriteArrayList<>();
        CountDownLatch writing = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Mockito.doAnswer(invocation -> {
            MessageContext message = invocation.getArgument(2);
            if (message == terminal) {
                writing.countDown();
                assertTrue(release.await(5, TimeUnit.SECONDS));
            }
            saved.add(message);
            return null;
        }).when(snapshotService).save(Mockito.eq(context), Mockito.eq("trace"), Mockito.any());

        try (ExecutorService consumers = Executors.newVirtualThreadPerTaskExecutor()) {
            try {
                writeBehind.enqueue("key", context, "trace", pending);
                Future<?> flush = consumers.submit(() -> writeBehind.flushNow("key", context, "trace", terminal));
                assertTrue(writing.await(2, TimeUnit.SECONDS));
                consumers.submit(() -> writeBehind.enqueue("key", context, "trace", stale))
                    .get(1, TimeUnit.SECONDS);
                release.countDown();
                flush.get(2, TimeUnit.SECONDS);
                writeBehind.shutdown();
                assertEquals(List.of(terminal), saved);
            }
            finally {
                release.countDown();
            }
        }
    }

}
