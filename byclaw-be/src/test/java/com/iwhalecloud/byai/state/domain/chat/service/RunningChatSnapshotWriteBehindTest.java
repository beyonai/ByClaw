package com.iwhalecloud.byai.state.domain.chat.service;

import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.concurrent.Executors;
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
}
