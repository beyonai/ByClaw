package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Scope;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamMetrics;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.StreamAckFailureRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.StreamRecordProcessor;
import com.iwhalecloud.byai.state.domain.chat.service.StreamDispatchResult;

/**
 * Redis Stream 数据流消息监听器。
 * <p>
 * 每个 session 在 Gateway 模式下拥有独立的监听器实例（prototype scope），
 * 通过 ApplicationContext 每次获取新的实例，避免多 session 并发写入同一实例的线程安全问题。
 * 监听 Gateway SDK 当前 Key Schema 对应的 Session Stream，在 Gateway 模式下接收响应消息并投入事件队列。
 * <p>
 * 设计要点：本监听器只负责将 Redis Stream 事件投入 {@link ChatProcessContext#gatewayEventQueue}，
 * 所有 OutputStream 写操作均由请求线程（Tomcat http-nio-* 线程）在
 * ScriptService.handleGatewayMode() 中消费队列时执行，保证 SSE 实时推流。
 * <p>
 * 同时将事件广播到同一用户的其他 WebSocket 设备，实现多端消息同步。
 * <p>
 * 消息体约定（data 字段的 JSON 结构）：
 * <pre>
 * {
 *   "session_id": "123456",
 *   "event_type": "answerDelta",   // 对应 SseResponseEventEnum 中的常量
 *   "data":     "{...}",           // 事件 payload，与 Python SSE data 字段对齐
 *   "metadata": { "error": "..." } // 仅 error 事件携带
 * }
 * </pre>
 */
@Component
@Scope("prototype")
public class RedisStreamMessageListener implements StreamListener<String, MapRecord<String, String, String>> {

    private static final Logger logger = LoggerFactory.getLogger(RedisStreamMessageListener.class);
    private static final int ACK_RETRY_LIMIT = 3;
    private static final int MAX_BATCH_SIZE = 100;
    private static final long BATCH_RETRY_DELAY_MILLIS = 1000;
    private static final ScheduledExecutorService BATCH_TIMER = Executors.newSingleThreadScheduledExecutor(runnable -> {
        Thread thread = new Thread(runnable, "session-stream-batch-timer");
        thread.setDaemon(true);
        return thread;
    });
    private static final ExecutorService BATCH_EXECUTOR = Executors.newVirtualThreadPerTaskExecutor();
    private static final ScheduledExecutorService ACK_RETRY_EXECUTOR = Executors.newScheduledThreadPool(1, runnable -> {
        Thread thread = new Thread(runnable, "session-stream-ack-retry");
        thread.setDaemon(true);
        return thread;
    });

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private StreamRecordProcessor streamRecordProcessor;

    @Autowired
    private StreamAckFailureRegistry streamAckFailureRegistry;

    @Autowired
    private SessionStreamMetrics sessionStreamMetrics;

    @Value("${byclaw.session-stream.batch-delay-millis:20}")
    private long batchDelayMillis;

    @Value("${byclaw.session-stream.batch-queue-capacity:256}")
    private int batchQueueCapacity = 256;

    private final ReentrantLock batchLock = new ReentrantLock();
    private final Condition queueSpace = batchLock.newCondition();
    private final ArrayDeque<MapRecord<String, String, String>> pendingBatch = new ArrayDeque<>();
    private List<MapRecord<String, String, String>> retryBatch;
    private ScheduledFuture<?> scheduledBatch;
    private long scheduleGeneration;
    private boolean draining;
    private volatile boolean closed;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        sessionStreamMetrics.recordReceived();
        if (closed) {
            return;
        }
        if (batchDelayMillis > 0) {
            enqueue(message);
            return;
        }
        try {
            StreamDispatchResult result = streamRecordProcessor.process(message);
            handleResult(message, result);
        }
        catch (Exception e) {
            sessionStreamMetrics.recordDispatchError();
            logger.error("处理 Redis Stream 消息失败，将保留 pending, stream: {}, messageId: {}",
                message.getStream(), message.getId(), e);
        }
    }

    private void enqueue(MapRecord<String, String, String> message) {
        if (batchQueueCapacity < 1) {
            throw new IllegalArgumentException("byclaw.session-stream.batch-queue-capacity must be positive");
        }
        batchLock.lock();
        try {
            // Condition.await releases the lock while backpressuring the Redis reader, including virtual threads.
            while (!closed && pendingBatch.size() >= batchQueueCapacity) {
                queueSpace.await();
            }
            if (!closed) {
                pendingBatch.addLast(message);
                scheduleDrain();
            }
        }
        catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        finally {
            batchLock.unlock();
        }
    }

    /** Called with batchLock held; timer callbacks only hand work to a per-listener virtual drain. */
    private void scheduleDrain() {
        if (closed || draining || (retryBatch == null && pendingBatch.isEmpty())) {
            return;
        }
        if (retryBatch == null && pendingBatch.size() >= MAX_BATCH_SIZE) {
            if (scheduledBatch != null) {
                scheduledBatch.cancel(false);
                scheduledBatch = null;
            }
            scheduleGeneration++;
            draining = true;
            BATCH_EXECUTOR.execute(this::drain);
        }
        else if (scheduledBatch == null) {
            long generation = ++scheduleGeneration;
            scheduledBatch = BATCH_TIMER.schedule(() -> {
                batchLock.lock();
                try {
                    if (closed || generation != scheduleGeneration) {
                        return;
                    }
                    scheduledBatch = null;
                    draining = true;
                    BATCH_EXECUTOR.execute(this::drain);
                }
                finally {
                    batchLock.unlock();
                }
            }, retryBatch == null ? batchDelayMillis : BATCH_RETRY_DELAY_MILLIS, TimeUnit.MILLISECONDS);
        }
    }

    private void drain() {
        while (true) {
            List<MapRecord<String, String, String>> records = new ArrayList<>(MAX_BATCH_SIZE);
            batchLock.lock();
            try {
                if (closed) {
                    draining = false;
                    return;
                }
                if (retryBatch != null) {
                    records.addAll(retryBatch);
                    retryBatch = null;
                }
                else {
                    while (records.size() < MAX_BATCH_SIZE && !pendingBatch.isEmpty()) {
                        records.add(pendingBatch.removeFirst());
                    }
                }
                queueSpace.signalAll();
            }
            finally {
                batchLock.unlock();
            }

            List<MapRecord<String, String, String>> failedSuffix = processBatch(records);

            batchLock.lock();
            try {
                if (!closed && failedSuffix != null) {
                    // Do not let a later terminal event finalize a conversation before this checkpoint succeeds.
                    // ACK-only recovery claims IDs out of order, so unprocessed suffixes stay in the PEL/local retry.
                    retryBatch = failedSuffix;
                }
                if (closed || retryBatch != null || pendingBatch.size() < MAX_BATCH_SIZE) {
                    draining = false;
                    scheduleDrain();
                    return;
                }
            }
            finally {
                batchLock.unlock();
            }
        }
    }

    private List<MapRecord<String, String, String>> processBatch(List<MapRecord<String, String, String>> records) {
        try {
            List<StreamDispatchResult> results = streamRecordProcessor.processBatch(records);
            if (results == null || results.size() != records.size()) {
                throw new IllegalStateException("Stream batch processor must return one result per record");
            }
            // HTTP terminal delivery may close this listener before processing returns. Successful results
            // are already checkpointed and must still be ACKed; only unprocessed work stays in the PEL.
            for (int index = 0; index < records.size(); index++) {
                MapRecord<String, String, String> message = records.get(index);
                try {
                    StreamDispatchResult result = results.get(index);
                    handleResult(message, result);
                    if (!result.shouldAcknowledge()) {
                        return new ArrayList<>(records.subList(index, records.size()));
                    }
                }
                catch (Exception e) {
                    recordBatchFailure(message, e);
                    return new ArrayList<>(records.subList(index, records.size()));
                }
            }
        }
        catch (Exception e) {
            for (MapRecord<String, String, String> message : records) {
                recordBatchFailure(message, e);
            }
            return records;
        }
        return null;
    }

    private void recordBatchFailure(MapRecord<String, String, String> message, Exception failure) {
        sessionStreamMetrics.recordDispatchError();
        logger.error("处理 Redis Stream 批量消息失败，将保留 pending, stream: {}, messageId: {}",
            message.getStream(), message.getId(), failure);
    }

    private void handleResult(MapRecord<String, String, String> message, StreamDispatchResult result) {
        if (result.shouldAcknowledge()) {
            if (acknowledge(message)) {
                streamRecordProcessor.afterAcknowledge(result);
            }
            else {
                scheduleAckRetry(message, result, 1);
            }
        }
        else {
            if (result == StreamDispatchResult.MISSING_CONTEXT) {
                sessionStreamMetrics.recordMissingContext();
            }
            else {
                sessionStreamMetrics.recordPending();
            }
            logger.warn("Redis Stream 消息暂不 ACK, result: {}, stream: {}, messageId: {}",
                result, message.getStream(), message.getId());
        }
    }

    /** Cancel buffered work; completed in-flight results may still ACK, while unfinished records stay in the PEL. */
    public void close() {
        batchLock.lock();
        try {
            closed = true;
            scheduleGeneration++;
            if (scheduledBatch != null) {
                scheduledBatch.cancel(false);
                scheduledBatch = null;
            }
            pendingBatch.clear();
            retryBatch = null;
            queueSpace.signalAll();
        }
        finally {
            batchLock.unlock();
        }
    }

    private void scheduleAckRetry(MapRecord<String, String, String> message, StreamDispatchResult result,
        int attempt) {
        if (closed || attempt > ACK_RETRY_LIMIT) {
            // 登记失败消息：活跃 listener 的心跳会持续刷新，该 session 永远不会被判定为 stale，
            // 只能由此处主动告知 recovery 仍有 pending 需要定向 claim。
            streamAckFailureRegistry.record(message.getStream(), message.getId().getValue());
            logger.warn("Redis Stream ACK 尚未完成，等待 pending recovery, stream: {}, messageId: {}",
                message.getStream(), message.getId());
            return;
        }
        ACK_RETRY_EXECUTOR.schedule(() -> {
            if (closed) {
                streamAckFailureRegistry.record(message.getStream(), message.getId().getValue());
                return;
            }
            if (acknowledge(message)) {
                streamRecordProcessor.afterAcknowledge(result);
            }
            else {
                scheduleAckRetry(message, result, attempt + 1);
            }
        }, 5, TimeUnit.SECONDS);
    }

    private boolean acknowledge(MapRecord<String, String, String> message) {
        try {
            redisTemplate.opsForStream()
                .acknowledge(message.getStream(), SessionStreamManager.CONSUMER_GROUP, message.getId());
            streamAckFailureRegistry.clear(message.getStream(), message.getId().getValue());
            sessionStreamMetrics.recordAckSuccess();
            return true;
        }
        catch (Exception e) {
            sessionStreamMetrics.recordAckFailure();
            logger.warn("ack Session Stream 消息失败, stream: {}, messageId: {}",
                message.getStream(), message.getId(), e);
            return false;
        }
    }
}
