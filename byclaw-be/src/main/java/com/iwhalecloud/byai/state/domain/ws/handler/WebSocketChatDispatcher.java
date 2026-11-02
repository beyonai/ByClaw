package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Supplier;
import java.util.concurrent.atomic.AtomicBoolean;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRequestCancellation;
import java.util.concurrent.RejectedExecutionException;

import io.netty.channel.Channel;
import io.netty.util.AttributeKey;
import lombok.extern.slf4j.Slf4j;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Bounded admission before creating virtual threads; one ordered drain per connection. */
@Component
@Slf4j
public class WebSocketChatDispatcher {
    // Channel-owned tombstone survives removal of an idle drain without retaining closed connections.
    private static final AttributeKey<Boolean> CLOSED = AttributeKey.valueOf(WebSocketChatDispatcher.class, "closed");
    private final int maxOutstanding;
    private final int maxPerChannel;
    private final Map<Channel, Lane> lanes = new HashMap<>();
    private int outstanding;
    private boolean closed;

    public WebSocketChatDispatcher() {
        this(128, 8);
    }

    @Autowired
    public WebSocketChatDispatcher(@Value("${byclaw.websocket.chat.max-outstanding:128}") int maxOutstanding,
        @Value("${byclaw.websocket.chat.max-per-channel:8}") int maxPerChannel) {
        if (maxOutstanding < 1 || maxPerChannel < 1) {
            throw new IllegalArgumentException("WebSocket chat admission limits must be positive");
        }
        this.maxOutstanding = maxOutstanding;
        this.maxPerChannel = maxPerChannel;
    }

    public void submit(Channel channel, Runnable action) {
        submit(channel, () -> null, action);
    }

    public synchronized void submit(Channel channel, Supplier<ChatKey> key, Runnable action) {
        Lane lane = lanes.get(channel);
        if (closed || Boolean.TRUE.equals(channel.attr(CLOSED).get()) || !channel.isActive() || outstanding >= maxOutstanding
            || (lane != null && lane.pending.size() + (lane.running ? 1 : 0) >= maxPerChannel)) {
            throw new RejectedExecutionException("WebSocket chat capacity reached; please retry later");
        }
        if (lane == null) {
            lane = new Lane();
            lanes.put(channel, lane);
        }
        lane.pending.add(new Operation(key, action));
        outstanding++;
        if (lane.worker == null) {
            Lane drainLane = lane;
            lane.worker = Thread.ofVirtual().name("ws-chat-" + channel.id().asShortText())
                .inheritInheritableThreadLocals(false).unstarted(() -> drain(channel, drainLane));
            try {
                lane.worker.start();
            }
            catch (RuntimeException | Error failure) {
                discardPending(lane);
                lanes.remove(channel, lane);
                throw failure;
            }
        }
    }

    private void drain(Channel channel, Lane lane) {
        while (true) {
            Operation action;
            synchronized (this) {
                if (closed || Boolean.TRUE.equals(channel.attr(CLOSED).get()) || !channel.isActive()) {
                    discardPending(lane);
                }
                action = lane.pending.poll();
                if (action == null) {
                    lanes.remove(channel, lane);
                    return;
                }
                lane.running = true;
                lane.active = action;
            }
            try {
                ChatRequestCancellation.run(action.cancelled, sessionId -> action.routedSessionId = sessionId, action.action);
            }
            catch (Throwable failure) {
                if (failure instanceof java.util.concurrent.CancellationException && action.cancelled.get()) {
                    log.debug("WebSocket chat action cancelled for channel {}", channel.id().asShortText());
                    continue;
                }
                // Like an executor worker, failure of one task must not strand later admitted frames.
                log.error("WebSocket chat action failed for channel {}", channel.id().asShortText(), failure);
            }
            finally {
                // Cancellation belongs to the completed action, never the next admitted frame.
                Thread.interrupted();
                synchronized (this) {
                    outstanding--;
                    lane.running = false;
                    lane.active = null;
                }
            }
        }
    }

    /** Only called after the normal STOP authorization/service path has accepted the request. */
    public synchronized void cancel(ChatKey key) {
        if (key.sessionId() == null) return;
        // STOP is session-scoped across this user's devices, while tenant/user identity stays fenced.
        for (Lane lane : lanes.values()) {
            lane.pending.removeIf(operation -> {
                if (!key.equals(operation.currentKey())) return false;
                operation.cancelled.set(true);
                outstanding--;
                return true;
            });
            if (lane.active != null && key.equals(lane.active.currentKey())) {
                lane.active.cancelled.set(true);
                lane.worker.interrupt();
            }
        }
    }

    public synchronized void closeChannel(Channel channel) {
        channel.attr(CLOSED).set(true);
        Lane lane = lanes.get(channel);
        if (lane != null) {
            discardPending(lane);
            if (lane.active != null) lane.active.cancelled.set(true);
            lane.worker.interrupt();
        }
    }

    private void discardPending(Lane lane) {
        outstanding -= lane.pending.size();
        lane.pending.clear();
    }

    @PreDestroy
    public synchronized void shutdown() {
        closed = true;
        for (Lane lane : lanes.values()) {
            discardPending(lane);
            if (lane.active != null) lane.active.cancelled.set(true);
            lane.worker.interrupt();
        }
    }

    public record ChatKey(Long userId, Long enterpriseId, Long sessionId) {
    }

    private static final class Operation {
        private final Supplier<ChatKey> key;
        private final Runnable action;
        private final AtomicBoolean cancelled = new AtomicBoolean();
        private volatile Long routedSessionId;

        private Operation(Supplier<ChatKey> key, Runnable action) {
            this.key = key;
            this.action = action;
        }

        private ChatKey currentKey() {
            ChatKey original = key.get();
            Long resolved = routedSessionId;
            return original == null || resolved == null ? original
                : new ChatKey(original.userId(), original.enterpriseId(), resolved);
        }
    }

    private static final class Lane {
        private Operation active;
        private final ArrayDeque<Operation> pending = new ArrayDeque<>();
        private Thread worker;
        private boolean running;
    }
}
