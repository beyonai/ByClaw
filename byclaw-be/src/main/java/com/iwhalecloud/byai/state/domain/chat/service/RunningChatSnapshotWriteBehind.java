package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

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
        this(snapshotService, coalesceMillis,
            Executors.newSingleThreadScheduledExecutor(daemonThreadFactory()));
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
                if (states.get(key) != state) {
                    continue;
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
        PendingState state = key == null ? null : states.get(key);
        if (state != null) {
            synchronized (state) {
                if (state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                state.latest = null;
                states.remove(key, state);
                snapshotService.save(context, traceId, messageContext);
                return;
            }
        }
        snapshotService.save(context, traceId, messageContext);
    }

    private void drain(String key, PendingState state) {
        synchronized (state) {
            state.future = null;
            PendingSnapshot pending = state.latest;
            state.latest = null;
            if (pending != null) {
                snapshotService.save(pending.context(), pending.traceId(), pending.messageContext());
            }
            if (state.latest == null) {
                states.remove(key, state);
            }
            else if (!shuttingDown) {
                state.future = scheduler.schedule(() -> drain(key, state), coalesceMillis, TimeUnit.MILLISECONDS);
            }
        }
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        states.forEach((key, state) -> {
            synchronized (state) {
                if (state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                PendingSnapshot pending = state.latest;
                state.latest = null;
                if (pending != null) {
                    snapshotService.save(pending.context(), pending.traceId(), pending.messageContext());
                }
                states.remove(key, state);
            }
        });
        scheduler.shutdown();
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
        private PendingSnapshot latest;
        private ScheduledFuture<?> future;
    }
}
