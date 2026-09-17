package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Coalesces accumulated scoped-session projections before broadcasting them.
 *
 * <p>Each projection already contains all content accumulated for a message. Keeping only the newest revision in a
 * short window reduces redundant full-message traffic; each projection still scales with accumulated content. Terminal
 * revisions bypass the coalescing delay. Transport backpressure separately bounds queued snapshots per client.</p>
 */
@Component
public class ScopedProjectionBroadcaster {

    private final MultiDeviceBroadcastService broadcastService;

    private final long coalesceMillis;

    private final ScheduledExecutorService scheduler;

    private final Map<ProjectionKey, PendingState> states = new ConcurrentHashMap<>();

    private volatile boolean shuttingDown;

    @Autowired
    public ScopedProjectionBroadcaster(
            MultiDeviceBroadcastService broadcastService,
            @Value("${byclaw.scoped-message.websocket-coalesce-millis:50}") long coalesceMillis
    ) {
        this(broadcastService, coalesceMillis, Executors.newSingleThreadScheduledExecutor(daemonThreadFactory()));
    }

    ScopedProjectionBroadcaster(
            MultiDeviceBroadcastService broadcastService,
            long coalesceMillis,
            ScheduledExecutorService scheduler
    ) {
        if (coalesceMillis < 0) {
            throw new IllegalArgumentException("WebSocket coalesce delay must not be negative");
        }
        this.broadcastService = broadcastService;
        this.coalesceMillis = coalesceMillis;
        this.scheduler = scheduler;
    }

    public void enqueue(String contextKey, Long userId, JSONObject message, boolean terminal) {
        if (contextKey == null || userId == null || message == null) {
            return;
        }
        if (shuttingDown) {
            throw new IllegalStateException("scoped projection broadcaster is shutting down");
        }
        JSONObject data = message.getJSONObject("data");
        ProjectionKey key = new ProjectionKey(contextKey, data == null ? null : data.getString("messageId"));
        while (true) {
            PendingState state = states.computeIfAbsent(key, ignored -> new PendingState());
            synchronized (state) {
                if (states.get(key) != state) {
                    continue;
                }
                state.latest = new PendingBroadcast(userId, message, terminal);
                if (terminal && state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                if (state.future == null) {
                    state.future = scheduler.schedule(() -> drain(key, state),
                        terminal ? 0L : coalesceMillis, TimeUnit.MILLISECONDS);
                }
                return;
            }
        }
    }

    private void drain(ProjectionKey key, PendingState state) {
        PendingBroadcast pending;
        synchronized (state) {
            state.future = null;
            pending = state.latest;
            state.latest = null;
        }
        if (pending != null) {
            broadcastService.broadcastScopedProjection(pending.userId(), key.contextKey(), pending.message(), pending.terminal());
        }
        synchronized (state) {
            if (state.latest == null) {
                states.remove(key, state);
            }
            else if (!shuttingDown && state.future == null) {
                state.future = scheduler.schedule(() -> drain(key, state), coalesceMillis,
                    TimeUnit.MILLISECONDS);
            }
        }
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        states.forEach((key, state) -> {
            PendingBroadcast pending;
            synchronized (state) {
                if (state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                pending = state.latest;
                state.latest = null;
            }
            if (pending != null) {
                broadcastService.broadcastScopedProjection(pending.userId(), key.contextKey(), pending.message(), pending.terminal());
            }
            states.remove(key, state);
        });
        scheduler.shutdown();
    }

    private static ThreadFactory daemonThreadFactory() {
        return runnable -> {
            Thread thread = new Thread(runnable, "scoped-projection-broadcast");
            thread.setDaemon(true);
            return thread;
        };
    }

    private record PendingBroadcast(Long userId, JSONObject message, boolean terminal) {
    }

    private record ProjectionKey(String contextKey, String messageId) {
    }

    private static final class PendingState {
        private PendingBroadcast latest;
        private ScheduledFuture<?> future;
    }
}
