package com.iwhalecloud.byai.state.domain.ws.handler;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import java.util.function.Function;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StreamOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamMetrics;
import com.iwhalecloud.byai.state.domain.chat.service.StreamAckFailureRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.StreamDispatchResult;
import com.iwhalecloud.byai.state.domain.chat.service.StreamRecordProcessor;

class RedisStreamMessageListenerBatchTest {

    private final List<List<MapRecord<String, String, String>>> batches = new CopyOnWriteArrayList<>();
    private final List<String> acknowledged = new CopyOnWriteArrayList<>();
    private final List<RedisStreamMessageListener> listeners = new ArrayList<>();
    private final CountDownLatch batchEntered = new CountDownLatch(1);
    private final CountDownLatch releaseBatch = new CountDownLatch(1);
    private final AtomicInteger active = new AtomicInteger();
    private final AtomicInteger maxActive = new AtomicInteger();
    private StreamAckFailureRegistry failures;
    private Consumer<List<MapRecord<String, String, String>>> batchAction = records -> { };
    private Function<List<MapRecord<String, String, String>>, List<StreamDispatchResult>> batchResults =
        records -> Collections.nCopies(records.size(), StreamDispatchResult.HANDLED);
    private StreamRecordProcessor processor;
    private RedisTemplate<String, Object> redisTemplate;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        failures = new StreamAckFailureRegistry();
        processor = mock(StreamRecordProcessor.class, invocation -> {
            if (invocation.getMethod().getName().equals("processBatch")) {
                List<MapRecord<String, String, String>> records = List.copyOf(invocation.getArgument(0));
                batches.add(records);
                maxActive.accumulateAndGet(active.incrementAndGet(), Math::max);
                batchEntered.countDown();
                try {
                    batchAction.accept(records);
                    return batchResults.apply(records);
                }
                finally {
                    active.decrementAndGet();
                }
            }
            if (invocation.getMethod().getName().equals("process")) {
                return StreamDispatchResult.HANDLED;
            }
            return null;
        });
        redisTemplate = mock(RedisTemplate.class);
        StreamOperations<String, Object, Object> operations = mock(StreamOperations.class);
        when(redisTemplate.opsForStream()).thenReturn(operations);
        when(operations.acknowledge(any(), any(), any(RecordId.class))).thenAnswer(invocation -> {
            acknowledged.add(((RecordId) invocation.getArgument(2)).getValue());
            return 1L;
        });
    }

    @AfterEach
    void closeListeners() {
        releaseBatch.countDown();
        for (RedisStreamMessageListener listener : listeners) {
            listener.close();
        }
    }

    @Test
    void flushesIdleBatchInOrderAndDoesNotAckBeforeProcessingCompletes() throws Exception {
        RedisStreamMessageListener listener = listener(100, 256);
        batchAction = records -> await(releaseBatch);

        listener.onMessage(record(1));
        listener.onMessage(record(2));

        assertTrue(batchEntered.await(2, TimeUnit.SECONDS), "Idle records must flush without another incoming event");
        assertTrue(acknowledged.isEmpty(), "PEL must retain records until the batch has been applied");
        releaseBatch.countDown();
        awaitAcknowledged(2);
        assertEquals(List.of("1-0", "2-0"), acknowledged);
        assertEquals(List.of("1-0", "2-0"), batches.get(0).stream().map(record -> record.getId().getValue()).toList());
    }

    @Test
    void fullBatchFlushesWithoutWaitingForDelay() throws Exception {
        RedisStreamMessageListener listener = listener(60_000, 256);
        for (int index = 1; index <= 100; index++) {
            listener.onMessage(record(index));
        }

        assertTrue(batchEntered.await(2, TimeUnit.SECONDS), "One hundred records must trigger an immediate drain");
        awaitAcknowledged(100);
        assertEquals(100, batches.get(0).size());
        assertEquals("100-0", acknowledged.get(99));
    }

    @Test
    void boundsQueueAndSerializesDrainWhileAllowingOtherSessionsToProgress() throws Exception {
        RedisStreamMessageListener slow = listener(1, 2);
        batchAction = records -> {
            if (records.get(0).getId().getValue().equals("1-0")) {
                await(releaseBatch);
            }
        };
        slow.onMessage(record(1));
        assertTrue(batchEntered.await(2, TimeUnit.SECONDS));
        slow.onMessage(record(2));
        slow.onMessage(record(3));
        CountDownLatch fourthAccepted = new CountDownLatch(1);
        Thread producer = Thread.ofVirtual().start(() -> {
            slow.onMessage(record(4));
            fourthAccepted.countDown();
        });
        try {
            assertFalse(fourthAccepted.await(100, TimeUnit.MILLISECONDS), "Full queue must apply backpressure");
            RedisStreamMessageListener fast = listener(1, 2);
            fast.onMessage(record(99));
            awaitAcknowledged(1);
            assertEquals(List.of("99-0"), acknowledged, "A slow session must not occupy the shared timer thread");
            releaseBatch.countDown();
            assertTrue(fourthAccepted.await(2, TimeUnit.SECONDS));
            awaitAcknowledged(5);
            assertEquals(List.of("99-0", "1-0", "2-0", "3-0", "4-0"), acknowledged);
        }
        finally {
            releaseBatch.countDown();
            producer.interrupt();
        }
    }

    @Test
    void neverOverlapsBatchesFromTheSameListener() throws Exception {
        RedisStreamMessageListener listener = listener(1, 256);
        batchAction = records -> {
            if (records.get(0).getId().getValue().equals("1-0")) {
                await(releaseBatch);
            }
        };
        listener.onMessage(record(1));
        assertTrue(batchEntered.await(2, TimeUnit.SECONDS));
        for (int index = 2; index <= 201; index++) {
            listener.onMessage(record(index));
        }
        releaseBatch.countDown();
        awaitAcknowledged(201);
        assertEquals(1, maxActive.get());
        assertTrue(batches.stream().allMatch(records -> records.size() <= 100));
        for (int index = 0; index < 201; index++) {
            assertEquals((index + 1) + "-0", acknowledged.get(index));
        }
    }

    @Test
    void retriesFailedBatchBeforeProcessingLaterRecords() throws Exception {
        RedisStreamMessageListener listener = listener(50, 256);
        CountDownLatch failed = new CountDownLatch(1);
        CountDownLatch laterProcessed = new CountDownLatch(1);
        AtomicInteger attempts = new AtomicInteger();
        batchAction = records -> {
            if (records.get(0).getId().getValue().equals("1-0") && attempts.getAndIncrement() == 0) {
                failed.countDown();
                throw new IllegalStateException("snapshot unavailable");
            }
            if (records.get(0).getId().getValue().equals("3-0")) {
                laterProcessed.countDown();
            }
        };
        listener.onMessage(record(1));
        listener.onMessage(record(2));
        assertTrue(failed.await(2, TimeUnit.SECONDS));
        listener.onMessage(record(3));
        assertFalse(laterProcessed.await(100, TimeUnit.MILLISECONDS), "Later events must wait for the failed checkpoint");
        assertTrue(acknowledged.isEmpty());
        assertFalse(failures.hasFailures("stream-10"), "Unprocessed records must not enter unordered ACK-only recovery");
        awaitAcknowledged(3);
        assertEquals(List.of("1-0", "2-0", "3-0"), acknowledged);
        assertEquals(List.of("1-0", "1-0", "3-0"),
            batches.stream().map(records -> records.get(0).getId().getValue()).toList());
    }

    @Test
    void acknowledgesSuccessfulPrefixOnceAndRetriesOnlyFailedSuffixBeforeNewRecords() throws Exception {
        RedisStreamMessageListener listener = listener(50, 256);
        AtomicInteger attempts = new AtomicInteger();
        CountDownLatch laterProcessed = new CountDownLatch(1);
        batchResults = records -> {
            if (attempts.getAndIncrement() == 0) {
                return List.of(StreamDispatchResult.HANDLED, StreamDispatchResult.ERROR, StreamDispatchResult.ERROR);
            }
            if (records.get(0).getId().getValue().equals("4-0")) {
                laterProcessed.countDown();
            }
            return Collections.nCopies(records.size(), StreamDispatchResult.HANDLED);
        };
        listener.onMessage(record(1));
        listener.onMessage(record(2));
        listener.onMessage(record(3));
        assertTrue(batchEntered.await(2, TimeUnit.SECONDS));
        listener.onMessage(record(4));
        assertFalse(laterProcessed.await(100, TimeUnit.MILLISECONDS));
        assertEquals(List.of("1-0"), acknowledged);
        assertFalse(failures.hasFailures("stream-10"));
        awaitAcknowledged(4);
        assertEquals(List.of("1-0", "2-0", "3-0", "4-0"), acknowledged);
        assertEquals(List.of("2-0", "3-0"),
            batches.get(1).stream().map(record -> record.getId().getValue()).toList());
    }

    @Test
    void closeDiscardsQueuedRecordsAndUnblocksBackpressureButAcknowledgesProcessedInFlight() throws Exception {
        RedisStreamMessageListener listener = listener(1, 1);
        batchAction = records -> await(releaseBatch);
        listener.onMessage(record(1));
        assertTrue(batchEntered.await(2, TimeUnit.SECONDS));
        listener.onMessage(record(2));
        CountDownLatch producerFinished = new CountDownLatch(1);
        Thread producer = Thread.ofVirtual().start(() -> {
            listener.onMessage(record(3));
            producerFinished.countDown();
        });
        try {
            assertFalse(producerFinished.await(100, TimeUnit.MILLISECONDS));
            listener.close();
            assertTrue(producerFinished.await(2, TimeUnit.SECONDS));
            releaseBatch.countDown();
            listener.onMessage(record(4));
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (active.get() != 0 && System.nanoTime() < deadline) {
                Thread.sleep(5);
            }
            awaitAcknowledged(1);
            assertEquals(List.of("1-0"), acknowledged);
            assertEquals(1, batches.size());
        }
        finally {
            releaseBatch.countDown();
            producer.interrupt();
        }
    }

    @Test
    void closeDuringProcessingAcknowledgesOnlySuccessfulPrefixAndDoesNotRetryFailedSuffix() throws Exception {
        RedisStreamMessageListener listener = listener(60_000, 1);
        // Fill an immediate batch deterministically, then block its processor while closing the listener.
        ReflectionTestUtils.setField(listener, "batchQueueCapacity", 100);
        batchAction = records -> await(releaseBatch);
        batchResults = records -> {
            List<StreamDispatchResult> results = new ArrayList<>(Collections.nCopies(records.size(), StreamDispatchResult.ERROR));
            results.set(0, StreamDispatchResult.HANDLED);
            return results;
        };
        for (int index = 1; index <= 100; index++) {
            listener.onMessage(record(index));
        }
        assertTrue(batchEntered.await(2, TimeUnit.SECONDS));
        listener.onMessage(record(101));
        listener.close();
        assertTrue(acknowledged.isEmpty());
        releaseBatch.countDown();
        awaitAcknowledged(1);
        Thread.sleep(1100);
        assertEquals(List.of("1-0"), acknowledged);
        assertEquals(1, batches.size(), "Closed listener must neither drain queued records nor retry its failed suffix");
        assertFalse(failures.hasFailures("stream-10"), "Unprocessed suffix must stay out of ACK-only recovery");
    }

    private RedisStreamMessageListener listener(long delay, int capacity) {
        RedisStreamMessageListener listener = new RedisStreamMessageListener();
        listeners.add(listener);
        ReflectionTestUtils.setField(listener, "redisTemplate", redisTemplate);
        ReflectionTestUtils.setField(listener, "streamRecordProcessor", processor);
        ReflectionTestUtils.setField(listener, "streamAckFailureRegistry", failures);
        ReflectionTestUtils.setField(listener, "sessionStreamMetrics", mock(SessionStreamMetrics.class));
        ReflectionTestUtils.setField(listener, "batchDelayMillis", delay);
        ReflectionTestUtils.setField(listener, "batchQueueCapacity", capacity);
        return listener;
    }

    private void awaitAcknowledged(int count) throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (acknowledged.size() < count && System.nanoTime() < deadline) {
            Thread.sleep(5);
        }
        assertEquals(count, acknowledged.size());
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Batch release timed out");
            }
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private MapRecord<String, String, String> record(int id) {
        return MapRecord.create("stream-10", Map.of("data", "{\"session_id\":\"10\"}"))
            .withId(RecordId.of(id + "-0"));
    }
}
