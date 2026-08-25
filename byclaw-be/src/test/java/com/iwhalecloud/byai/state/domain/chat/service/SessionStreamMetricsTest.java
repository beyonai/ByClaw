package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.LinkedBlockingQueue;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.serializer.SerializationException;

import com.alibaba.fastjson.JSONObject;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

class SessionStreamMetricsTest {

    private SimpleMeterRegistry registry;
    private OutputStreamManager outputStreamManager;
    private SessionStreamMetrics metrics;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        outputStreamManager = new OutputStreamManager();
        metrics = new SessionStreamMetrics(registry, outputStreamManager);
    }

    @Test
    void recordsMessageAndAckCounters() {
        metrics.recordReceived();
        metrics.recordAckSuccess();
        metrics.recordAckFailure();

        assertThat(counter("byclaw.session.stream.received")).isEqualTo(1.0);
        assertThat(counter("byclaw.session.stream.ack.success")).isEqualTo(1.0);
        assertThat(counter("byclaw.session.stream.ack.failure")).isEqualTo(1.0);
    }

    @Test
    void classifiesReadErrorsIntoBoundedReasons() {
        metrics.recordReadError(new QueryTimeoutException("timeout"));
        metrics.recordReadError(new RedisConnectionFailureException("down"));
        metrics.recordReadError(new SerializationException("bad record"));
        metrics.recordReadError(new IllegalStateException("other"));

        assertThat(readError("timeout")).isEqualTo(1.0);
        assertThat(readError("connection")).isEqualTo(1.0);
        assertThat(readError("serialization")).isEqualTo(1.0);
        assertThat(readError("other")).isEqualTo(1.0);
    }

    @Test
    void updatesAtomicGauges() {
        metrics.updateActiveListeners(3L);
        metrics.updatePendingTotal(7L);

        assertThat(gauge("byclaw.session.stream.listener.active")).isEqualTo(3.0);
        assertThat(gauge("byclaw.session.stream.pending.total")).isEqualTo(7.0);
    }

    @Test
    void readsHttpQueueGaugesFromOutputStreamManager() {
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.gatewayEventQueue = new LinkedBlockingQueue<>();
        ctx.gatewayEventQueue.add(new JSONObject());
        ctx.gatewayEventQueue.add(new JSONObject());
        outputStreamManager.putContext("10", ctx);

        assertThat(gauge("byclaw.session.stream.http.queue.total")).isEqualTo(2.0);
        assertThat(gauge("byclaw.session.stream.http.queue.max")).isEqualTo(2.0);
    }

    @Test
    void recordsSamplingAndConfigurationFailures() {
        metrics.recordPendingSampleFailure();
        metrics.recordInvalidConfiguration();

        assertThat(counter("byclaw.session.stream.pending.sample.failure")).isEqualTo(1.0);
        assertThat(counter("byclaw.session.stream.config.invalid")).isEqualTo(1.0);
    }

    @Test
    void preservesExistingDispatchCounters() {
        metrics.recordMissingContext();
        metrics.recordPending();
        metrics.recordDispatchError();

        assertThat(counter("byclaw.session.stream.missing_context")).isEqualTo(1.0);
        assertThat(counter("byclaw.session.stream.pending")).isEqualTo(1.0);
        assertThat(counter("byclaw.session.stream.dispatch.error")).isEqualTo(1.0);
    }

    private double counter(String name) {
        return registry.get(name).counter().count();
    }

    private double readError(String reason) {
        return registry.get("byclaw.session.stream.read.error").tag("reason", reason).counter().count();
    }

    private double gauge(String name) {
        return registry.get(name).gauge().value();
    }
}
