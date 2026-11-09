package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryService;
import com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryService.OrphanedCommand;
import com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryStore;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class OrphanedChatTurnServiceTest {

    final SandboxRecoveryService recovery = mock(SandboxRecoveryService.class);

    final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);

    final SandboxUserContextRunner users = mock(SandboxUserContextRunner.class);

    final AssistantChatApplicationService chats = mock(AssistantChatApplicationService.class);

    final OrphanedChatTurnService service = new OrphanedChatTurnService(recovery, running, users, chats);

    final long queuedAt = 1_792_367_536_149L;

    final OrphanedCommand command = new OrphanedCommand("stream", "group",
        new SandboxRecoveryStore.Message(queuedAt + "-0", "old-worker", 120_000, 1, "PENDING", Map.of()),
        "101", "test-user", queuedAt, false);

    @BeforeEach
    void setup() {
        doAnswer(call -> {
            ((Runnable) call.getArgument(1)).run();
            return null;
        }).when(users).runAsUser(anyString(), any());
    }

    RunningChatInfo runningSince(long startedAt) {
        RunningChatInfo info = new RunningChatInfo();
        info.setSessionId(101L);
        info.setRunning(true);
        info.setStartedAt(startedAt);
        return info;
    }

    @Test
    void aNewMessageStopsTheTurnOfADeadWorkerAndIsTaken() {
        when(recovery.orphanedCommands("test-user", "101", OrphanedChatTurnService.ADMISSION_IDLE_MS))
            .thenReturn(List.of(command));
        when(running.getRunning(101L)).thenReturn(runningSince(queuedAt - 2_000));
        when(recovery.dismissOrphaned(command, OrphanedChatTurnService.REASON)).thenReturn(true);

        assertThat(service.releaseIfOrphaned("test-user", 101L)).isTrue();
        verify(chats).stopOrphanedChat(101L);
    }

    @Test
    void aSessionWhoseCommandsMayStillRunStaysRunning() {
        when(recovery.orphanedCommands("test-user", "101", OrphanedChatTurnService.ADMISSION_IDLE_MS))
            .thenReturn(List.of());

        assertThat(service.releaseIfOrphaned("test-user", 101L)).isFalse();
        verify(chats, never()).stopOrphanedChat(anyLong());
    }

    @Test
    void aNewerRunningTurnIsNotStoppedForAnOldCommand() {
        when(recovery.orphanedCommands("test-user", "101", OrphanedChatTurnService.ADMISSION_IDLE_MS))
            .thenReturn(List.of(command));
        when(running.getRunning(101L)).thenReturn(runningSince(queuedAt + 30 * 60_000L));

        assertThat(service.releaseIfOrphaned("test-user", 101L)).isFalse();
        verify(recovery, never()).dismissOrphaned(any(), anyString());
        verify(chats, never()).stopOrphanedChat(anyLong());
    }

    @Test
    void aCommandReclaimedMeanwhileKeepsTheTurn() {
        when(recovery.orphanedCommands("test-user", "101", OrphanedChatTurnService.ADMISSION_IDLE_MS))
            .thenReturn(List.of(command));
        when(running.getRunning(101L)).thenReturn(runningSince(queuedAt));
        when(recovery.dismissOrphaned(command, OrphanedChatTurnService.REASON)).thenReturn(false);

        assertThat(service.releaseIfOrphaned("test-user", 101L)).isFalse();
        verify(chats, never()).stopOrphanedChat(anyLong());
    }

    @Test
    void theSweepStopsOrphanedTurnsAsTheirUserAndOnlyDismissesTheRest() {
        OrphanedCommand idle = new OrphanedCommand("stream", "group",
            new SandboxRecoveryStore.Message("1-0", "old-worker", 900_000, 1, "PENDING", Map.of()), "202", "other-user", 1L, false);
        OrphanedCommand old = new OrphanedCommand("stream", "group",
            new SandboxRecoveryStore.Message(queuedAt + "-0", "old-worker", 700_000, 1, "PENDING", Map.of()),
            "101", "test-user", queuedAt, false);
        when(recovery.orphanedCommands(120_000L)).thenReturn(List.of(old, idle));
        when(recovery.dismissOrphaned(any(), eq(OrphanedChatTurnService.REASON))).thenReturn(true);
        when(running.getRunning(101L)).thenReturn(runningSince(queuedAt));
        when(running.getRunning(202L)).thenReturn(new RunningChatInfo());

        service.sweep();

        verify(users).runAsUser(eq("test-user"), any());
        verify(chats).stopOrphanedChat(101L);
        verify(recovery).dismissOrphaned(idle, OrphanedChatTurnService.REASON);
        verify(chats, never()).stopOrphanedChat(202L);
    }
    @Test
    void theSweepEndsAManagedPlacementsTurnAfterTwoMinutesAndOthersAfterTen() {
        OrphanedCommand managed = new OrphanedCommand("managed", "group",
            new SandboxRecoveryStore.Message("2-0", "old-worker", 150_000, 1, "PENDING", Map.of()), "303", "test-user", queuedAt, true);
        OrphanedCommand recent = new OrphanedCommand("stream", "group",
            new SandboxRecoveryStore.Message("3-0", "old-worker", 150_000, 1, "PENDING", Map.of()), "404", "test-user", queuedAt, false);
        when(recovery.orphanedCommands(120_000L)).thenReturn(List.of(managed, recent));
        when(recovery.dismissOrphaned(any(), eq(OrphanedChatTurnService.REASON))).thenReturn(true);
        when(running.getRunning(303L)).thenReturn(runningSince(queuedAt));

        service.sweep();

        verify(chats).stopOrphanedChat(303L);
        // The other kind may still be reclaimed by a returning worker: it waits the full ten minutes.
        verify(recovery, never()).dismissOrphaned(recent, OrphanedChatTurnService.REASON);
    }

}
