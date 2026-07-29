package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

/**
 * Per-{@code req_id} serial reply queue, ported from the reference SDK
 * {@code ws.ts} send-reply logic. Ported to Java it must add explicit
 * concurrency control the single-threaded Node SDK never needed.
 *
 * <p>Guarantees (plan §6.5 + Task 4):
 * <ul>
 *   <li><b>Serial per req_id</b>: one in-flight frame per {@code req_id}; the
 *       next is sent only after the current ACK / timeout. All state mutation
 *       for a given {@code req_id} is guarded by that {@code req_id}'s lane
 *       monitor, so the WS ACK thread, the business executor, and the timeout
 *       scheduler never interleave.</li>
 *   <li><b>Queue cap</b>: each lane rejects new sends past
 *       {@code maxReplyQueueSize} (default 500) to prevent unbounded growth.</li>
 *   <li><b>Seq guard</b>: each pending send carries a monotonic {@code seq}; the
 *       timeout callback fires only if the lane's current pending still matches
 *       that {@code seq}, closing the timeout-vs-ACK race.</li>
 * </ul>
 *
 * <p>The sender is injected as a {@code Function<String,Boolean>} (raw JSON →
 * sent?) so the queue is unit-testable without a live socket.
 */
public class WecomReplyQueue {

    private static final Logger logger = LoggerFactory.getLogger(WecomReplyQueue.class);

    private final Function<String, Boolean> sender;
    private final ScheduledExecutorService scheduler;
    private final long ackTimeoutMs;
    private final int maxReplyQueueSize;

    private final Map<String, Lane> lanes = new ConcurrentHashMap<>();
    private final AtomicLong pendingAckSeq = new AtomicLong();

    public WecomReplyQueue(Function<String, Boolean> sender,
                           ScheduledExecutorService scheduler,
                           long ackTimeoutMs,
                           int maxReplyQueueSize) {
        this.sender = sender;
        this.scheduler = scheduler;
        this.ackTimeoutMs = ackTimeoutMs <= 0 ? 5_000L : ackTimeoutMs;
        this.maxReplyQueueSize = maxReplyQueueSize <= 0 ? 500 : maxReplyQueueSize;
    }

    /** A single queued send. */
    private static final class Task {
        final String frameJson;
        final CompletableFuture<WecomWsFrame> future;

        Task(String frameJson, CompletableFuture<WecomWsFrame> future) {
            this.frameJson = frameJson;
            this.future = future;
        }
    }

    /** Per-req_id serialization unit. All fields guarded by {@code synchronized(lane)}. */
    private static final class Lane {
        final Deque<Task> queue = new ArrayDeque<>();
        Task inFlight;
        long inFlightSeq = -1;
        ScheduledFuture<?> timeoutFuture;
        /** Set true once retired from the map; a fresh lane must be fetched. */
        boolean removed;
    }

    private Lane laneFor(String reqId) {
        return lanes.computeIfAbsent(reqId, k -> new Lane());
    }

    /**
     * Retire an idle lane (no in-flight, empty queue) so lanes do not
     * accumulate one-per-unique-req_id forever. Caller holds the lane monitor.
     */
    private void retireIfIdle(String reqId, Lane lane) {
        if (lane.inFlight == null && lane.queue.isEmpty() && !lane.removed) {
            lane.removed = true;
            lanes.remove(reqId, lane);
        }
    }

    /**
     * Enqueue a frame for {@code reqId}. Resolves when its ACK returns
     * {@code errcode == 0}; completes exceptionally on ACK error, timeout,
     * queue-cap overflow, or connection close.
     */
    public CompletableFuture<WecomWsFrame> send(String reqId, String frameJson) {
        CompletableFuture<WecomWsFrame> future = new CompletableFuture<>();
        // Retry loop: a lane can be retired between laneFor() and the monitor;
        // if we grabbed a just-removed lane, fetch a fresh one and try again.
        while (true) {
            Lane lane = laneFor(reqId);
            synchronized (lane) {
                if (lane.removed) {
                    continue;
                }
                if (lane.queue.size() >= maxReplyQueueSize) {
                    future.completeExceptionally(new IllegalStateException(
                            "Reply queue for reqId " + reqId + " exceeds max size " + maxReplyQueueSize));
                    return future;
                }
                lane.queue.addLast(new Task(frameJson, future));
                if (lane.inFlight == null) {
                    processNext(reqId, lane);
                }
                return future;
            }
        }
    }

    /** Send the head of the lane and arm its ACK timeout. Caller holds lane monitor. */
    private void processNext(String reqId, Lane lane) {
        Task task = lane.queue.pollFirst();
        if (task == null) {
            // Nothing left in this lane: retire it so lanes do not leak.
            retireIfIdle(reqId, lane);
            return;
        }
        lane.inFlight = task;
        long seq = pendingAckSeq.incrementAndGet();
        lane.inFlightSeq = seq;

        boolean sent;
        try {
            sent = Boolean.TRUE.equals(sender.apply(task.frameJson));
        } catch (Exception e) {
            lane.inFlight = null;
            task.future.completeExceptionally(e);
            processNext(reqId, lane);
            return;
        }
        if (!sent) {
            lane.inFlight = null;
            task.future.completeExceptionally(new IllegalStateException(
                    "WeCom socket not open, send failed for reqId " + reqId));
            processNext(reqId, lane);
            return;
        }

        lane.timeoutFuture = scheduler.schedule(
                () -> onTimeout(reqId, seq), ackTimeoutMs, TimeUnit.MILLISECONDS);
    }

    private void onTimeout(String reqId, long seq) {
        Lane lane = lanes.get(reqId);
        if (lane == null) {
            return;
        }
        synchronized (lane) {
            // Seq guard: ignore a stale timeout whose pending was already ACKed.
            if (lane.inFlight == null || lane.inFlightSeq != seq) {
                return;
            }
            // WeCom ACKs carry only req_id, no per-frame sequence, so a late ACK
            // for this timed-out frame cannot be told apart from the ACK of a
            // subsequently-sent frame on the same req_id. Do NOT continue the lane
            // (that would let a late ACK resolve the wrong frame and hide a lost
            // one). Fail the in-flight frame, drain the backlog, and retire the
            // lane; a later send() on the same req_id starts a fresh lane cleanly.
            Task timedOut = lane.inFlight;
            lane.inFlight = null;
            lane.timeoutFuture = null;
            timedOut.future.completeExceptionally(new IllegalStateException(
                    "Reply ack timeout (" + ackTimeoutMs + "ms) for reqId " + reqId));
            drainQueue(lane, "reqId " + reqId + " lane aborted after ack timeout");
            retireIfIdle(reqId, lane);
        }
    }

    /** Fail and remove every queued (not in-flight) task in a lane. Caller holds lane monitor. */
    private void drainQueue(Lane lane, String reason) {
        Task t;
        while ((t = lane.queue.pollFirst()) != null) {
            t.future.completeExceptionally(new IllegalStateException(reason));
        }
    }

    /**
     * Resolve the in-flight send for this ACK frame. Called from the WS
     * listener's {@code onReplyAck}. No-op if there is no matching pending.
     */
    public void onAck(WecomWsFrame ackFrame) {
        String reqId = ackFrame.reqId();
        if (reqId == null) {
            return;
        }
        Lane lane = lanes.get(reqId);
        if (lane == null) {
            return;
        }
        synchronized (lane) {
            Task inFlight = lane.inFlight;
            if (inFlight == null) {
                return;
            }
            cancelTimeout(lane);
            lane.inFlight = null;
            if (ackFrame.isSuccess()) {
                inFlight.future.complete(ackFrame);
            } else {
                inFlight.future.completeExceptionally(new IllegalStateException(
                        "Reply ack error for reqId " + reqId + ", errcode=" + ackFrame.getErrcode()));
            }
            processNext(reqId, lane);
        }
    }

    /** Fail all pending + queued sends across all lanes (connection close). */
    public void failAll(String reason) {
        Map<String, Lane> snapshot;
        synchronized (this) {
            snapshot = new HashMap<>(lanes);
            lanes.clear();
        }
        for (Lane lane : snapshot.values()) {
            synchronized (lane) {
                // Mark retired under the lane monitor so a send() that grabbed this
                // lane before the map was cleared sees removed==true and retries
                // with a fresh lane, instead of enqueuing onto an orphan whose
                // ACK/timeout callbacks can no longer find it via lanes.get(reqId).
                lane.removed = true;
                cancelTimeout(lane);
                if (lane.inFlight != null) {
                    lane.inFlight.future.completeExceptionally(new IllegalStateException(reason));
                    lane.inFlight = null;
                }
                Task t;
                while ((t = lane.queue.pollFirst()) != null) {
                    t.future.completeExceptionally(new IllegalStateException(reason));
                }
            }
        }
        logger.debug("WecomReplyQueue failed all pending replies: {}", reason);
    }

    private void cancelTimeout(Lane lane) {
        if (lane.timeoutFuture != null) {
            lane.timeoutFuture.cancel(false);
            lane.timeoutFuture = null;
        }
    }

    /** True when a send for this req_id is awaiting ACK (stream skip-if-pending). */
    public boolean hasPendingAck(String reqId) {
        Lane lane = lanes.get(reqId);
        if (lane == null) {
            return false;
        }
        synchronized (lane) {
            return lane.inFlight != null;
        }
    }

    /** Number of live lanes. Test hook to verify idle lanes are retired (no leak). */
    int laneCount() {
        return lanes.size();
    }
}
