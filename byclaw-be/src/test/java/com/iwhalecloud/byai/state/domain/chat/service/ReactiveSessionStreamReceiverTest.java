package com.iwhalecloud.byai.state.domain.chat.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;

import reactor.core.publisher.Flux;

class ReactiveSessionStreamReceiverTest {

    private ReactiveSessionStreamReceiver receiver;

    @AfterEach
    void tearDown() {
        if (receiver != null) receiver.shutdown();
    }

    @Test
    void manySessionsUseIndependentSingleKeyReadsWithoutBlockingThreads() throws Exception {
        CountDownLatch reads = new CountDownLatch(2);
        Map<String, String> consumersByStream = new java.util.concurrent.ConcurrentHashMap<>();
        ReactiveSessionStreamReceiver.ReactiveReadOperations operations = (consumer, options, offset) -> {
            consumersByStream.put(offset.getKey(), consumer.getName());
            reads.countDown();
            return Flux.empty();
        };
        receiver = receiver(operations);

        receiver.register("10", "byai_gateway:session:10:data_stream", "consumer-10",
            mock(RedisStreamMessageListener.class), false);
        receiver.register("20", "byai_gateway:v2:session:{20}:data_stream", "consumer-20",
            mock(RedisStreamMessageListener.class), false);

        assertTrue(reads.await(1, TimeUnit.SECONDS));
        assertEquals("consumer-10", consumersByStream.get("byai_gateway:session:10:data_stream"));
        assertEquals("consumer-20", consumersByStream.get("byai_gateway:v2:session:{20}:data_stream"));
        assertEquals(2, receiver.registeredSessionCount());
    }

    @Test
    void pausedSessionIsNotReadUntilRecoveryResumesIt() throws Exception {
        CountDownLatch resumedRead = new CountDownLatch(1);
        ReactiveSessionStreamReceiver.ReactiveReadOperations operations = (consumer, options, offset) -> {
            resumedRead.countDown();
            return Flux.empty();
        };
        receiver = receiver(operations);

        receiver.register("10", "stream-10", "consumer-10", mock(RedisStreamMessageListener.class), true);
        Thread.sleep(30);
        assertFalse(resumedRead.await(10, TimeUnit.MILLISECONDS));
        assertTrue(receiver.resume("10"));
        assertTrue(resumedRead.await(1, TimeUnit.SECONDS));
    }

    @Test
    void returnedRecordIsDispatchedToTheRegisteredListener() throws Exception {
        String stream = "stream-10";
        MapRecord<String, String, String> record = MapRecord.create(stream, Map.of("data", "{}"))
            .withId(RecordId.of("1-0"));
        AtomicBoolean emitted = new AtomicBoolean();
        ReactiveSessionStreamReceiver.ReactiveReadOperations operations = (consumer, options, offset) ->
            emitted.compareAndSet(false, true) ? Flux.just(record) : Flux.empty();
        CountDownLatch delivered = new CountDownLatch(1);
        RedisStreamMessageListener listener = new RedisStreamMessageListener() {
            @Override
            public void onMessage(MapRecord<String, String, String> message) {
                if (record.equals(message)) delivered.countDown();
            }
        };
        receiver = receiver(operations);

        receiver.register("10", stream, "consumer-10", listener, false);

        assertTrue(delivered.await(1, TimeUnit.SECONDS));
        receiver.unregister("10");
        assertEquals(0, receiver.registeredSessionCount());
    }

    @Test
    void boundsConcurrentRedisCommandsWithoutRejectingRegistrations() throws Exception {
        AtomicInteger reads = new AtomicInteger();
        ReactiveSessionStreamReceiver.ReactiveReadOperations operations = (consumer, options, offset) -> {
            reads.incrementAndGet();
            return Flux.never();
        };
        receiver = new ReactiveSessionStreamReceiver(mock(SessionStreamMetrics.class), operations, Runnable::run,
            Duration.ofMillis(1), Duration.ofMillis(5), Duration.ofMillis(5), 10, 2);

        for (int index = 0; index < 20; index++) {
            receiver.register("session-" + index, "stream-" + index, "consumer-" + index,
                mock(RedisStreamMessageListener.class), false);
        }
        Thread.sleep(50);

        assertEquals(2, reads.get());
        assertEquals(20, receiver.registeredSessionCount());
    }

    @Test
    void readFailureIsObservedAndRetriedWithoutEndingTheSubscription() throws Exception {
        SessionStreamMetrics metrics = mock(SessionStreamMetrics.class);
        AtomicInteger attempts = new AtomicInteger();
        CountDownLatch retried = new CountDownLatch(1);
        RedisConnectionFailureException failure = new RedisConnectionFailureException("down");
        ReactiveSessionStreamReceiver.ReactiveReadOperations operations = (consumer, options, offset) -> {
            if (attempts.incrementAndGet() == 1) return Flux.error(failure);
            retried.countDown();
            return Flux.empty();
        };
        receiver = new ReactiveSessionStreamReceiver(metrics, operations, Runnable::run,
            Duration.ofMillis(1), Duration.ofMillis(5), Duration.ofMillis(1), 10, 2);

        receiver.register("10", "stream-10", "consumer-10", mock(RedisStreamMessageListener.class), false);

        assertTrue(retried.await(1, TimeUnit.SECONDS));
        verify(metrics).recordReadError(failure);
    }

    private ReactiveSessionStreamReceiver receiver(ReactiveSessionStreamReceiver.ReactiveReadOperations operations) {
        return new ReactiveSessionStreamReceiver(mock(SessionStreamMetrics.class), operations, Runnable::run,
            Duration.ofMillis(1), Duration.ofMillis(5), Duration.ofMillis(5), 10, 32);
    }
}
