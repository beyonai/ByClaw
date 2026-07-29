package com.iwhalecloud.byai.gateway.channels.service.wecom.sdk;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.wecom.sdk.model.WecomWsFrame;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Task 4 verification of the per-req_id serial reply queue: ordering, ACK
 * success/error, timeout, queue-cap rejection, failAll cleanup, and the
 * stale-timeout-after-ACK race that the pendingAckSeq guard closes.
 */
class WecomReplyQueueTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private ScheduledExecutorService scheduler;

    @BeforeEach
    void setUp() {
        scheduler = Executors.newScheduledThreadPool(2);
    }

    @AfterEach
    void tearDown() {
        scheduler.shutdownNow();
    }

    private WecomWsFrame ack(String reqId, int errcode) {
        WecomWsFrame f = new WecomWsFrame();
        WecomWsFrame.Headers h = new WecomWsFrame.Headers();
        h.setReqId(reqId);
        f.setHeaders(h);
        f.setErrcode(errcode);
        return f;
    }

    @Test
    void resolvesOnSuccessAck() throws Exception {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 500);
        CompletableFuture<WecomWsFrame> future = q.send("r1", "{\"a\":1}");
        assertThat(q.hasPendingAck("r1")).isTrue();

        q.onAck(ack("r1", 0));
        assertThat(future.get(1, TimeUnit.SECONDS).isSuccess()).isTrue();
        assertThat(q.hasPendingAck("r1")).isFalse();
    }

    @Test
    void failsOnErrorAck() {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 500);
        CompletableFuture<WecomWsFrame> future = q.send("r1", "{}");
        q.onAck(ack("r1", 40001));
        assertThatThrownBy(future::join).hasMessageContaining("errcode=40001");
    }

    @Test
    void serializesSameReqIdOneInFlightAtATime() throws Exception {
        List<String> sent = new java.util.concurrent.CopyOnWriteArrayList<>();
        Function<String, Boolean> sender = json -> {
            sent.add(json);
            return true;
        };
        WecomReplyQueue q = new WecomReplyQueue(sender, scheduler, 5_000, 500);

        CompletableFuture<WecomWsFrame> f1 = q.send("r1", "frame1");
        CompletableFuture<WecomWsFrame> f2 = q.send("r1", "frame2");
        CompletableFuture<WecomWsFrame> f3 = q.send("r1", "frame3");

        // Only the head is sent; the rest wait behind the in-flight ACK.
        assertThat(sent).containsExactly("frame1");

        q.onAck(ack("r1", 0));
        f1.get(1, TimeUnit.SECONDS);
        assertThat(sent).containsExactly("frame1", "frame2");

        q.onAck(ack("r1", 0));
        f2.get(1, TimeUnit.SECONDS);
        assertThat(sent).containsExactly("frame1", "frame2", "frame3");

        q.onAck(ack("r1", 0));
        f3.get(1, TimeUnit.SECONDS);
    }

    @Test
    void timesOutWhenNoAck() {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 100, 500);
        CompletableFuture<WecomWsFrame> future = q.send("r1", "{}");
        assertThatThrownBy(() -> future.get(2, TimeUnit.SECONDS))
                .isInstanceOf(ExecutionException.class)
                .hasMessageContaining("timeout");
    }

    @Test
    void rejectsPastQueueCap() {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 2);
        // First send goes in-flight (not counted against the queue), then 2 queued = cap.
        q.send("r1", "inflight");
        q.send("r1", "q1");
        q.send("r1", "q2");
        CompletableFuture<WecomWsFrame> overflow = q.send("r1", "q3");
        assertThatThrownBy(overflow::join).hasMessageContaining("exceeds max size");
    }

    @Test
    void failAllCancelsPendingAndQueued() {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 500);
        CompletableFuture<WecomWsFrame> inflight = q.send("r1", "a");
        CompletableFuture<WecomWsFrame> queued = q.send("r1", "b");

        q.failAll("connection closed");

        assertThatThrownBy(inflight::join).hasMessageContaining("connection closed");
        assertThatThrownBy(queued::join).hasMessageContaining("connection closed");
    }

    @Test
    void staleTimeoutAfterAckDoesNotCancelNextSend() throws Exception {
        // Isolate the seq guard: frame1 gets a SHORT timeout, frame2 a LONG one
        // (via a second queue would change reqId, so instead we ACK frame1 fast
        // and rely on frame2's fresh seq). ackTimeout is long enough that
        // frame2 will not time out during the observation window; the point is
        // that frame1's already-cancelled timer must not touch frame2's seq.
        List<String> sent = new java.util.concurrent.CopyOnWriteArrayList<>();
        WecomReplyQueue q = new WecomReplyQueue(json -> {
            sent.add(json);
            return true;
        }, scheduler, 1_000, 500);

        CompletableFuture<WecomWsFrame> f1 = q.send("r1", "frame1");
        q.onAck(ack("r1", 0)); // resolve + cancel frame1's timer well before it fires
        f1.get(1, TimeUnit.SECONDS);

        CompletableFuture<WecomWsFrame> f2 = q.send("r1", "frame2");
        assertThat(sent).containsExactly("frame1", "frame2");

        // Short wait, safely under frame2's own 1s timeout: frame2 must still be
        // pending — a stale frame1 timer firing here would wrongly complete it.
        Thread.sleep(200);
        assertThat(f2).isNotCompleted();
        assertThat(q.hasPendingAck("r1")).isTrue();

        q.onAck(ack("r1", 0));
        assertThat(f2.get(1, TimeUnit.SECONDS).isSuccess()).isTrue();
    }

    @Test
    void differentReqIdsAreIndependentUnderConcurrency() throws Exception {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 500);
        int lanes = 20;
        AtomicInteger resolved = new AtomicInteger();
        CountDownLatch start = new CountDownLatch(1);
        ScheduledExecutorService pool = Executors.newScheduledThreadPool(8);
        try {
            for (int i = 0; i < lanes; i++) {
                String reqId = "req-" + i;
                pool.submit(() -> {
                    try {
                        start.await();
                        CompletableFuture<WecomWsFrame> f = q.send(reqId, "{}");
                        q.onAck(ack(reqId, 0));
                        f.get(1, TimeUnit.SECONDS);
                        resolved.incrementAndGet();
                    } catch (Exception ignored) {
                        // counted by absence
                    }
                });
            }
            start.countDown();
            pool.shutdown();
            assertThat(pool.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            assertThat(resolved.get()).isEqualTo(lanes);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void idleLanesAreRetiredSoTheyDoNotLeak() throws Exception {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 500);
        // Each unique reqId opens a lane; after ACK the lane must be retired.
        for (int i = 0; i < 50; i++) {
            String reqId = "cb-" + i;
            CompletableFuture<WecomWsFrame> f = q.send(reqId, "{}");
            q.onAck(ack(reqId, 0));
            f.get(1, TimeUnit.SECONDS);
        }
        // No leak: all lanes retired once idle.
        assertThat(q.laneCount()).isZero();
    }

    @Test
    void laneRetiredAfterTimeoutToo() throws Exception {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 100, 500);
        CompletableFuture<WecomWsFrame> f = q.send("cb-x", "{}");
        assertThatThrownBy(() -> f.get(2, TimeUnit.SECONDS)).hasMessageContaining("timeout");
        // Give the timeout callback a moment to retire the lane.
        Thread.sleep(100);
        assertThat(q.laneCount()).isZero();
    }

    @Test
    void laneReusableAfterRetirement() throws Exception {
        WecomReplyQueue q = new WecomReplyQueue(json -> true, scheduler, 5_000, 500);
        CompletableFuture<WecomWsFrame> f1 = q.send("cb", "{}");
        q.onAck(ack("cb", 0));
        f1.get(1, TimeUnit.SECONDS);
        assertThat(q.laneCount()).isZero();
        // Same reqId again after retirement must work (fresh lane).
        CompletableFuture<WecomWsFrame> f2 = q.send("cb", "{}");
        q.onAck(ack("cb", 0));
        assertThat(f2.get(1, TimeUnit.SECONDS).isSuccess()).isTrue();
    }
}
