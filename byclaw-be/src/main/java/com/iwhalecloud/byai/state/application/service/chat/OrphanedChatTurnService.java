package com.iwhalecloud.byai.state.application.service.chat;

import com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryService;
import com.iwhalecloud.byai.gateway.sandbox.recovery.SandboxRecoveryService.OrphanedCommand;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Lazy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

/**
 * Ends chat turns whose worker died. BE marks a session running for as long as its turn is open and
 * renews that mark itself, so when the shared host or sandbox executing the turn dies, the session
 * refuses new messages until the user stops it. A turn counts as orphaned when its command is still
 * pending in the user's queue, the worker that took it is offline and no worker of the user is online
 * (the same rule under which an administrator may dismiss it on the recovery page). A worker that
 * comes back reclaims such commands itself, so this waits a minute when the user sends a new message
 * and ten minutes in the background sweep; a platform-managed placement's command, which no worker
 * reclaims once its user is moved, two minutes.
 */
@Slf4j
@Service
public class OrphanedChatTurnService {

    static final long ADMISSION_IDLE_MS = 60_000L;

    /** A command and the running turn it belongs to are queued and marked within this window. */
    static final long SAME_TURN_WINDOW_MS = 10 * 60_000L;

    static final String REASON = "执行宿主已离线，本轮已中断";

    private final SandboxRecoveryService recovery;

    private final RunningOutputStreamRegistry running;

    private final SandboxUserContextRunner users;

    private final AssistantChatApplicationService chats;

    @Value("${byclaw.chat.orphaned-turn.sweep-enabled:true}")
    private boolean sweepEnabled = true;

    @Value("${byclaw.chat.orphaned-turn.sweep-idle-ms:600000}")
    private long sweepIdleMs = 600_000L;

    /** A managed placement's command is never reclaimed once its user is moved, so its turn ends sooner. */
    @Value("${byclaw.chat.orphaned-turn.managed-idle-ms:120000}")
    private long managedIdleMs = 120_000L;

    public OrphanedChatTurnService(SandboxRecoveryService recovery, RunningOutputStreamRegistry running,
        SandboxUserContextRunner users, @Lazy AssistantChatApplicationService chats) {
        this.recovery = recovery;
        this.running = running;
        this.users = users;
        this.chats = chats;
    }

    /**
     * Before refusing a new message because the session is running: stop the running turn if its
     * worker died, and report whether the session can take the message now.
     *
     * @param userCode  the session's user
     * @param sessionId the running session
     * @return true when the running turn was orphaned and has been stopped
     */
    public boolean releaseIfOrphaned(String userCode, Long sessionId) {
        if (userCode == null || sessionId == null) {
            return false;
        }
        List<OrphanedCommand> commands = recovery.orphanedCommands(userCode, String.valueOf(sessionId), ADMISSION_IDLE_MS);
        if (commands.isEmpty() || !sameTurn(running.getRunning(sessionId), commands)) {
            return false;
        }
        for (OrphanedCommand command : commands) {
            if (!recovery.dismissOrphaned(command, REASON)) {
                return false;
            }
        }
        chats.stopOrphanedChat(sessionId);
        log.warn("停止执行者已离线的一轮并接收新消息, sessionId: {}, userCode: {}, commands: {}", sessionId, userCode,
            commands.size());
        return true;
    }

    /** Stops orphaned turns nobody returns to, so their sessions stop showing as running. */
    @Scheduled(fixedDelayString = "${byclaw.chat.orphaned-turn.sweep-interval-ms:300000}",
        initialDelayString = "${byclaw.chat.orphaned-turn.sweep-interval-ms:300000}")
    public void sweep() {
        if (!sweepEnabled) {
            return;
        }
        List<OrphanedCommand> commands;
        try {
            commands = recovery.orphanedCommands(Math.min(sweepIdleMs, managedIdleMs));
        }
        catch (RuntimeException e) {
            log.warn("扫描执行者已离线的会话失败", e);
            return;
        }
        for (OrphanedCommand command : commands) {
            if (command.message().idleMs() < (command.managed() ? managedIdleMs : sweepIdleMs)) {
                continue;
            }
            try {
                // Acknowledge first: on several BE instances only the one that wins stops the turn.
                if (!recovery.dismissOrphaned(command, REASON)) {
                    continue;
                }
                Long sessionId = Long.valueOf(command.sessionId());
                if (sameTurn(running.getRunning(sessionId), List.of(command))) {
                    users.runAsUser(command.userCode(), () -> chats.stopOrphanedChat(sessionId));
                    log.warn("后台停止执行者已离线的一轮, sessionId: {}, userCode: {}", sessionId, command.userCode());
                }
            }
            catch (RuntimeException e) {
                log.warn("停止执行者已离线的一轮失败, sessionId: {}", command.sessionId(), e);
            }
        }
    }

    /** Whether the session's running turn is the one these commands carry, not a newer one. */
    static boolean sameTurn(RunningChatInfo info, List<OrphanedCommand> commands) {
        if (info == null || !Boolean.TRUE.equals(info.getRunning()) || info.getStartedAt() == null) {
            return false;
        }
        long startedAt = info.getStartedAt();
        return commands.stream().anyMatch(command -> Math.abs(command.queuedAt() - startedAt) <= SAME_TURN_WINDOW_MS);
    }
}
