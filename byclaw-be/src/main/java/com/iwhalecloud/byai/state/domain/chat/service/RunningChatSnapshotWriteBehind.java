package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;

import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Coalesces non-terminal running-chat snapshots away from the Redis Stream consumer thread.
 *
 * <p>The live WebSocket path keeps processing events while only the latest accumulated projection in a short window
 * is cached. Terminal snapshots use {@link #flushNow(String, ChatProcessContext, String, MessageContext)} so reconnect
 * recovery never observes an older revision after completion.</p>
 */
@Component
public class RunningChatSnapshotWriteBehind {

    private final RunningChatSnapshotService snapshotService;

    private final long coalesceMillis;

    private final ScheduledExecutorService scheduler;

    private final Map<String, PendingState> states = new ConcurrentHashMap<>();

    private volatile boolean shuttingDown;

    @Autowired
    public RunningChatSnapshotWriteBehind(
            RunningChatSnapshotService snapshotService,
            @Value("${byclaw.running-snapshot.write-behind-millis:50}") long coalesceMillis
    ) {
        this(snapshotService, coalesceMillis, writerPool());
    }

    RunningChatSnapshotWriteBehind(
            RunningChatSnapshotService snapshotService,
            long coalesceMillis,
            ScheduledExecutorService scheduler
    ) {
        if (coalesceMillis < 0) {
            throw new IllegalArgumentException("running snapshot coalesce delay must not be negative");
        }
        this.snapshotService = snapshotService;
        this.coalesceMillis = coalesceMillis;
        this.scheduler = scheduler;
    }

    /** Enqueue the latest non-terminal projection and return without Redis I/O. */
    public void enqueue(String key, ChatProcessContext context, String traceId, MessageContext messageContext) {
        if (key == null || context == null || messageContext == null || shuttingDown) {
            return;
        }
        while (true) {
            PendingState state = states.computeIfAbsent(key, ignored -> new PendingState());
            synchronized (state) {
                if (state.terminal) {
                    return;
                }
                if (states.get(key) != state) {
                    continue;
                }
                if (shuttingDown) {
                    if (state.latest == null && state.future == null) {
                        states.remove(key, state);
                    }
                    return;
                }
                state.latest = new PendingSnapshot(context, traceId, messageContext);
                if (state.future == null) {
                    state.future = scheduler.schedule(() -> drain(key, state), coalesceMillis, TimeUnit.MILLISECONDS);
                }
                return;
            }
        }
    }

    /** Cancel a queued older revision and synchronously persist the terminal reconnect baseline. */
    public void flushNow(String key, ChatProcessContext context, String traceId, MessageContext messageContext) {
        if (key == null) {
            snapshotService.save(context, traceId, messageContext);
            return;
        }
        PendingState state;
        while (true) {
            state = states.computeIfAbsent(key, ignored -> new PendingState());
            synchronized (state) {
                if (states.get(key) != state) {
                    continue;
                }
                // Retain this state until every terminal writer finishes. Enqueue must not create a replacement
                // while an older Redis write or the terminal write is still in flight.
                state.terminal = true;
                state.flushers++;
                if (state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                state.latest = null;
                break;
            }
        }
        state.writeLock.lock();
        try {
            snapshotService.save(context, traceId, messageContext);
        }
        finally {
            synchronized (state) {
                if (--state.flushers == 0) {
                    states.remove(key, state);
                }
            }
            state.writeLock.unlock();
        }
    }

    private void drain(String key, PendingState state) {
        state.writeLock.lock();
        try {
            PendingSnapshot pending;
            synchronized (state) {
                if (states.get(key) != state || state.terminal) {
                    return;
                }
                pending = state.latest;
                state.latest = null;
            }
            try {
                if (pending != null) {
                    snapshotService.save(pending.context(), pending.traceId(), pending.messageContext());
                }
            }
            finally {
                synchronized (state) {
                    state.future = null;
                    if (state.latest == null && state.flushers == 0) {
                        states.remove(key, state);
                    }
                    else if (!state.terminal && !shuttingDown) {
                        state.future = scheduler.schedule(() -> drain(key, state), coalesceMillis, TimeUnit.MILLISECONDS);
                    }
                }
            }
        }
        finally {
            state.writeLock.unlock();
        }
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        try {
            states.forEach((key, state) -> {
                synchronized (state) {
                    if (state.future != null) {
                        state.future.cancel(false);
                    }
                }
                drain(key, state);
            });
        }
        finally {
            scheduler.shutdown();
        }
    }

    private static ScheduledExecutorService writerPool() {
        // Bound Redis concurrency while allowing independent sessions to progress past a slow write.
        ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(4, daemonThreadFactory());
        executor.setRemoveOnCancelPolicy(true);
        return executor;
    }

    private static ThreadFactory daemonThreadFactory() {
        return runnable -> {
            Thread thread = new Thread(runnable, "running-chat-snapshot");
            thread.setDaemon(true);
            return thread;
        };
    }

    private record PendingSnapshot(ChatProcessContext context, String traceId, MessageContext messageContext) {
    }

    private static final class PendingState {
        // Redis I/O uses a parkable lock; enqueue only holds the short in-memory monitor.
        private final ReentrantLock writeLock = new ReentrantLock(true);
        private PendingSnapshot latest;
        private ScheduledFuture<?> future;
        private boolean terminal;
        private int flushers;
    }
}
