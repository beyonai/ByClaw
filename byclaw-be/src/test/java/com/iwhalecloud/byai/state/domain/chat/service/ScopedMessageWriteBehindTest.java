package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class ScopedMessageWriteBehindTest {

    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();

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
