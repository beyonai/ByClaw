package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatSnapshotResponse;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.BeanUtils;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Per-child write-behind queue for externally scoped message snapshots.
 *
 * <p>The Redis Stream consumer only enqueues the newest complete message snapshot. Database writes run on
 * dedicated workers, coalesce intermediate revisions, retain failed work, and retry without blocking live
 * WebSocket delivery or Stream acknowledgement.</p>
 */
@Slf4j
@Component
public class ScopedMessageWriteBehind {

    private final ByaiMessageHotService messageHotService;

    private final SessionService sessionService;

    private final RunningChatSnapshotService runningChatSnapshotService;

    private final ScheduledExecutorService scheduler;

    private final long batchDelayMillis;

    private final long retryDelayMillis;

    private final Map<String, PendingState> states = new ConcurrentHashMap<>();

    private volatile boolean shuttingDown;

    @Autowired
    public ScopedMessageWriteBehind(
            ByaiMessageHotService messageHotService,
            SessionService sessionService,
            RunningChatSnapshotService runningChatSnapshotService,
            @Value("${byclaw.scoped-message.write-batch-delay-millis:500}") long batchDelayMillis,
            @Value("${byclaw.scoped-message.write-retry-delay-millis:1000}") long retryDelayMillis,
            @Value("${byclaw.scoped-message.write-workers:4}") int workers
    ) {
        this(messageHotService, sessionService, runningChatSnapshotService, batchDelayMillis, retryDelayMillis,
            Executors.newScheduledThreadPool(Math.max(1, workers), daemonThreadFactory()));
    }

    ScopedMessageWriteBehind(
            ByaiMessageHotService messageHotService,
            SessionService sessionService,
            long batchDelayMillis,
            long retryDelayMillis,
            ScheduledExecutorService scheduler
    ) {
        this(messageHotService, sessionService, null, batchDelayMillis, retryDelayMillis, scheduler);
    }

    private ScopedMessageWriteBehind(
            ByaiMessageHotService messageHotService,
            SessionService sessionService,
            RunningChatSnapshotService runningChatSnapshotService,
            long batchDelayMillis,
            long retryDelayMillis,
            ScheduledExecutorService scheduler
    ) {
        if (batchDelayMillis < 0 || retryDelayMillis < 0) {
            throw new IllegalArgumentException("write-behind delays must not be negative");
        }
        this.messageHotService = messageHotService;
        this.sessionService = sessionService;
        this.runningChatSnapshotService = runningChatSnapshotService;
        this.batchDelayMillis = batchDelayMillis;
        this.retryDelayMillis = retryDelayMillis;
        this.scheduler = scheduler;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverDurableSnapshots() {
        if (runningChatSnapshotService == null) {
            return;
        }
        for (RunningChatSnapshotResponse snapshot : runningChatSnapshotService.findExternalChildSnapshots()) {
            if (snapshot == null || snapshot.getSessionId() == null || snapshot.getMessageId() == null) {
                continue;
            }
            ByaiMessageHotDtoDto message = new ByaiMessageHotDtoDto();
            BeanUtils.copyProperties(snapshot, message);
            boolean terminal = Boolean.FALSE.equals(snapshot.getRunning());
            enqueue("child:" + snapshot.getSessionId() + ":" + snapshot.getMessageId(),
                snapshot.getSessionId(), message, terminal);
        }
    }

    /** Enqueue the latest accumulated child message without waiting for database I/O. */
    public void enqueue(String contextKey, Long sessionId, ByaiMessageHotDtoDto message, boolean terminal) {
        if (contextKey == null || sessionId == null || message == null) {
            return;
        }
        if (shuttingDown) {
            throw new IllegalStateException("scoped message persistence queue is shutting down");
        }
        while (true) {
            PendingState state = states.computeIfAbsent(contextKey, ignored -> new PendingState());
            synchronized (state) {
                if (states.get(contextKey) != state) {
                    continue;
                }
                if (shuttingDown) {
                    throw new IllegalStateException("scoped message persistence queue is shutting down");
                }
                state.revision++;
                state.latest = new PendingWrite(sessionId, message, terminal, state.revision);
                if (terminal && state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                if (state.future == null) {
                    schedule(contextKey, state, terminal ? 0L : batchDelayMillis);
                }
                return;
            }
        }
    }

    private void schedule(String contextKey, PendingState state, long delayMillis) {
        state.future = scheduler.schedule(() -> drain(contextKey, state), delayMillis, TimeUnit.MILLISECONDS);
    }

    private void drain(String contextKey, PendingState state) {
        PendingWrite pending;
        synchronized (state) {
            state.future = null;
            if (state.writing) {
                schedule(contextKey, state, retryDelayMillis);
                return;
            }
            pending = state.latest;
            if (pending == null) {
                states.remove(contextKey, state);
                return;
            }
            state.writing = true;
        }

        boolean persisted = false;
        try {
            messageHotService.updateSelective(pending.message());
            sessionService.touchUpdateTime(pending.sessionId());
            if (runningChatSnapshotService != null) {
                runningChatSnapshotService.markExternalChildPersisted(pending.message());
            }
            persisted = true;
        }
        catch (Exception e) {
            log.warn("作用域消息异步落库失败，将保留最新快照重试, sessionId: {}, messageId: {}",
                pending.sessionId(), pending.message().getMessageId(), e);
        }
        finally {
            synchronized (state) {
                state.writing = false;
                boolean unchanged = state.latest != null && state.latest.revision() == pending.revision();
                if (persisted && unchanged) {
                    state.latest = null;
                    states.remove(contextKey, state);
                }
                else if (state.future == null && !shuttingDown) {
                    PendingWrite latest = state.latest;
                    long delay = persisted && latest != null && latest.terminal() ? 0L : retryDelayMillis;
                    schedule(contextKey, state, delay);
                }
            }
        }
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        for (Map.Entry<String, PendingState> entry : states.entrySet()) {
            PendingState state = entry.getValue();
            synchronized (state) {
                if (state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
            }
        }
        scheduler.shutdown();
        try {
            if (!scheduler.awaitTermination(10, TimeUnit.SECONDS)) {
                log.warn("外部子会话异步消息队列关闭超时，仍有 {} 个会话待处理", states.size());
            }
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        states.forEach(this::flushOnShutdown);
        if (!states.isEmpty()) {
            log.warn("外部子会话异步消息队列关闭后仍有 {} 个会话未落库，Redis 快照将在 TTL 内继续提供恢复",
                states.size());
        }
    }

    private void flushOnShutdown(String contextKey, PendingState state) {
        PendingWrite pending;
        synchronized (state) {
            if (state.writing || state.latest == null) {
                return;
            }
            pending = state.latest;
            state.writing = true;
        }
        boolean persisted = false;
        try {
            messageHotService.updateSelective(pending.message());
            sessionService.touchUpdateTime(pending.sessionId());
            if (runningChatSnapshotService != null) {
                runningChatSnapshotService.markExternalChildPersisted(pending.message());
            }
            persisted = true;
        }
        catch (Exception e) {
            log.warn("外部子会话异步消息队列关闭前最终落库失败, sessionId: {}, messageId: {}",
                pending.sessionId(), pending.message().getMessageId(), e);
        }
        finally {
            synchronized (state) {
                state.writing = false;
                if (persisted && state.latest != null && state.latest.revision() == pending.revision()) {
                    state.latest = null;
                    states.remove(contextKey, state);
                }
            }
        }
    }

    private static ThreadFactory daemonThreadFactory() {
        return runnable -> {
            Thread thread = new Thread(runnable, "scoped-message-persistence");
            thread.setDaemon(true);
            return thread;
        };
    }

    private record PendingWrite(Long sessionId, ByaiMessageHotDtoDto message, boolean terminal, long revision) {
    }

    private static final class PendingState {
        private long revision;
        private PendingWrite latest;
        private ScheduledFuture<?> future;
        private boolean writing;
    }
}
