package com.iwhalecloud.byai.manager.domain.connector.service;

import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

/** Low-cardinality metrics for Skill-driven connector authorization synchronization. */
@Component
public class ConnectorSkillAuthorizationSyncMetrics {

    private final MeterRegistry registry;
    private final Counter success;
    private final Counter busy;
    private final Timer duration;
    private final ConcurrentHashMap<String, Counter> failures = new ConcurrentHashMap<>();

    public ConnectorSkillAuthorizationSyncMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.success = Counter.builder("byai.connector.skill_sync.success").register(registry);
        this.busy = Counter.builder("byai.connector.skill_sync.busy").register(registry);
        this.duration = Timer.builder("byai.connector.skill_sync.duration").register(registry);
    }

    public Timer.Sample start() {
        return Timer.start(registry);
    }

    public void recordSuccess(Timer.Sample sample) {
        success.increment();
        sample.stop(duration);
    }

    public void recordFailure(Timer.Sample sample, String errorCode) {
        String safeCode = errorCode == null || errorCode.isBlank() ? "UNKNOWN" : errorCode;
        if ("CONNECTOR_VERIFICATION_BUSY".equals(safeCode)) {
            busy.increment();
        }
        failures.computeIfAbsent(safeCode, code -> Counter.builder("byai.connector.skill_sync.failure")
            .tag("error_code", code)
            .register(registry))
            .increment();
        sample.stop(duration);
    }
}
