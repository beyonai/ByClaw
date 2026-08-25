package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.EnumMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.serializer.SerializationException;
import org.springframework.stereotype.Component;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;

/**
 * Session Stream 低基数指标入口。
 * <p>
 * 消费主链路只调用明确的方法，不把 session、stream 或异常消息写入标签，避免动态标签导致
 * Prometheus 时间序列数量失控。指标异常不会反向中断 Redis Stream 消费。
 */
@Slf4j
@Component
public class SessionStreamMetrics {

    private final Counter received;
    private final Counter ackSuccess;
    private final Counter ackFailure;
    private final Counter missingContext;
    private final Counter pending;
    private final Counter dispatchError;
    private final Counter pendingSampleFailure;
    private final Counter invalidConfiguration;
    private final Map<ReadErrorReason, Counter> readErrors = new EnumMap<>(ReadErrorReason.class);
    private final AtomicLong activeListeners = new AtomicLong();
    private final AtomicLong pendingTotal = new AtomicLong();

    public SessionStreamMetrics(MeterRegistry registry, OutputStreamManager outputStreamManager) {
        received = counter(registry, "byclaw.session.stream.received", "Received Session Stream records");
        ackSuccess = counter(registry, "byclaw.session.stream.ack.success", "Successful Session Stream ACKs");
        ackFailure = counter(registry, "byclaw.session.stream.ack.failure", "Failed Session Stream ACKs");
        missingContext = counter(registry, "byclaw.session.stream.missing_context",
            "Session Stream records without a recoverable context");
        pending = counter(registry, "byclaw.session.stream.pending",
            "Session Stream records intentionally retained in the pending list");
        dispatchError = counter(registry, "byclaw.session.stream.dispatch.error",
            "Session Stream dispatch errors");
        pendingSampleFailure = counter(registry, "byclaw.session.stream.pending.sample.failure",
            "Failed Session Stream pending metric samples");
        invalidConfiguration = counter(registry, "byclaw.session.stream.config.invalid",
            "Invalid Session Stream timeout configurations");

        for (ReadErrorReason reason : ReadErrorReason.values()) {
            readErrors.put(reason, Counter.builder("byclaw.session.stream.read.error")
                .description("Session Stream read errors")
                .tag("reason", reason.tagValue)
                .register(registry));
        }

        Gauge.builder("byclaw.session.stream.listener.active", activeListeners, AtomicLong::doubleValue)
            .description("Active Session Stream listeners on this instance")
            .register(registry);
        Gauge.builder("byclaw.session.stream.pending.total", pendingTotal, AtomicLong::doubleValue)
            .description("Last successful aggregate pending count for active Session Streams")
            .register(registry);
        Gauge.builder("byclaw.session.stream.http.queue.total", outputStreamManager,
            manager -> manager.getTotalGatewayEventQueueSize())
            .description("Total queued HTTP SSE Session Stream events")
            .register(registry);
        Gauge.builder("byclaw.session.stream.http.queue.max", outputStreamManager,
            manager -> manager.getMaxGatewayEventQueueSize())
            .description("Largest HTTP SSE Session Stream queue")
            .register(registry);
    }

    public void recordReceived() {
        safeIncrement(received);
    }

    public void recordAckSuccess() {
        safeIncrement(ackSuccess);
    }

    public void recordAckFailure() {
        safeIncrement(ackFailure);
    }

    public void recordReadError(Throwable error) {
        safeIncrement(readErrors.get(classify(error)));
    }

    public void recordMissingContext() {
        safeIncrement(missingContext);
    }

    public void recordPending() {
        safeIncrement(pending);
    }

    public void recordDispatchError() {
        safeIncrement(dispatchError);
    }

    public void recordPendingSampleFailure() {
        safeIncrement(pendingSampleFailure);
    }

    public void recordInvalidConfiguration() {
        safeIncrement(invalidConfiguration);
    }

    public void updateActiveListeners(long count) {
        activeListeners.set(Math.max(0L, count));
    }

    public void updatePendingTotal(long count) {
        pendingTotal.set(Math.max(0L, count));
    }

    private Counter counter(MeterRegistry registry, String name, String description) {
        return Counter.builder(name).description(description).register(registry);
    }

    private ReadErrorReason classify(Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof QueryTimeoutException) {
                return ReadErrorReason.TIMEOUT;
            }
            if (current instanceof RedisConnectionFailureException) {
                return ReadErrorReason.CONNECTION;
            }
            if (current instanceof SerializationException) {
                return ReadErrorReason.SERIALIZATION;
            }
            current = current.getCause();
        }
        return ReadErrorReason.OTHER;
    }

    private void safeIncrement(Counter counter) {
        try {
            counter.increment();
        }
        catch (Exception e) {
            log.debug("记录 Session Stream 指标失败, metric: {}", counter.getId().getName(), e);
        }
    }

    private enum ReadErrorReason {
        TIMEOUT("timeout"),
        CONNECTION("connection"),
        SERIALIZATION("serialization"),
        OTHER("other");

        private final String tagValue;

        ReadErrorReason(String tagValue) {
            this.tagValue = tagValue;
        }
    }
}
