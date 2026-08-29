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
 * short window prevents full-message WebSocket traffic from growing quadratically while a response streams. Terminal
 * revisions bypass the delay so completion remains immediate.</p>
 */
@Component
public class ScopedProjectionBroadcaster {

    private final MultiDeviceBroadcastService broadcastService;

    private final long coalesceMillis;

    private final ScheduledExecutorService scheduler;

    private final Map<String, PendingState> states = new ConcurrentHashMap<>();

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
        while (true) {
            PendingState state = states.computeIfAbsent(contextKey, ignored -> new PendingState());
            synchronized (state) {
                if (states.get(contextKey) != state) {
                    continue;
                }
                state.latest = new PendingBroadcast(userId, message);
                if (terminal && state.future != null) {
                    state.future.cancel(false);
                    state.future = null;
                }
                if (state.future == null) {
                    state.future = scheduler.schedule(() -> drain(contextKey, state),
                        terminal ? 0L : coalesceMillis, TimeUnit.MILLISECONDS);
                }
                return;
            }
        }
    }

    private void drain(String contextKey, PendingState state) {
        PendingBroadcast pending;
        synchronized (state) {
            state.future = null;
            pending = state.latest;
            state.latest = null;
        }
        if (pending != null) {
            broadcastService.broadcastRawToUser(pending.userId(), pending.message(), null);
        }
        synchronized (state) {
            if (state.latest == null) {
                states.remove(contextKey, state);
            }
            else if (!shuttingDown && state.future == null) {
                state.future = scheduler.schedule(() -> drain(contextKey, state), coalesceMillis,
                    TimeUnit.MILLISECONDS);
            }
        }
    }

    @PreDestroy
    void shutdown() {
        shuttingDown = true;
        states.forEach((contextKey, state) -> {
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
                broadcastService.broadcastRawToUser(pending.userId(), pending.message(), null);
            }
            states.remove(contextKey, state);
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

    private record PendingBroadcast(Long userId, JSONObject message) {
    }

    private static final class PendingState {
        private PendingBroadcast latest;
        private ScheduledFuture<?> future;
    }
}
