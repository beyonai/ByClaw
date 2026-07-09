package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Tags;
import io.micrometer.core.instrument.Timer;
import org.springframework.stereotype.Component;

import java.util.concurrent.TimeUnit;

/**
 * 启动期同步 Micrometer 指标封装（PR-4）。
 * <p>
 * 命名空间: {@code byai.digemployee.startup.sync.*}
 * <ul>
 *   <li>{@code byai_digemployee_startup_sync_total} - Counter, 总同步资源数
 *   <li>{@code byai_digemployee_startup_sync_success_total} - Counter, 成功资源数
 *   <li>{@code byai_digemployee_startup_sync_failure_total{reason}} - Counter, 失败资源数(按 reason 分桶)
 *   <li>{@code byai_digemployee_startup_sync_timeout_total} - Counter, 超时次数
 *   <li>{@code byai_digemployee_startup_sync_duration_seconds} - Timer, 同步总耗时
 *   <li>{@code byai_digemployee_startup_sync_dlq_size} - Gauge, 当前 DLQ 长度
 * </ul>
 *
 * <p>所有 counter increment 操作不抛异常, 失败时仅 log warn.
 *
 * @author ByClaw PR-4
 */
@Component
public class StartupSyncMetrics {

    private final Counter total;
    private final Counter success;
    private final Counter timeout;
    private final Counter failureCollector;
    private final Timer duration;
    private final java.util.concurrent.atomic.AtomicLong dlqSizeHolder = new java.util.concurrent.atomic.AtomicLong(0);

    public StartupSyncMetrics(MeterRegistry registry) {
        this.total = Counter.builder("byai.digemployee.startup.sync.total")
            .description("Total digital employees processed in startup sync")
            .register(registry);
        this.success = Counter.builder("byai.digemployee.startup.sync.success")
            .description("Successfully synced digital employees")
            .register(registry);
        this.timeout = Counter.builder("byai.digemployee.startup.sync.timeout")
            .description("Total timeout events")
            .register(registry);
        this.failureCollector = Counter.builder("byai.digemployee.startup.sync.failure")
            .description("Failure events by reason")
            .register(registry);
        this.duration = Timer.builder("byai.digemployee.startup.sync.duration")
            .description("Startup sync total duration")
            .register(registry);
        // Gauge for DLQ size: 每次 recordFailure 时更新此值
        registry.gauge("byai.digemployee.startup.sync.dlq.size", dlqSizeHolder);
    }

    public void recordTotal(long n) {
        if (n > 0) {
            try {
                total.increment(n);
            }
            catch (Exception e) {
                // 不抛出
            }
        }
    }

    public void recordSuccess(long n) {
        if (n > 0) {
            try {
                success.increment(n);
            }
            catch (Exception e) {
                // 不抛出
            }
        }
    }

    public void recordFailure(String reason) {
        try {
            Counter.builder("byai.digemployee.startup.sync.failure")
                .tags(Tags.of("reason", reason == null ? "unknown" : reason))
                .register(io.micrometer.core.instrument.Metrics.globalRegistry)
                .increment();
            failureCollector.increment();
        }
        catch (Exception e) {
            // 不抛出
        }
    }

    public void recordTimeout() {
        try {
            timeout.increment();
        }
        catch (Exception e) {
            // 不抛出
        }
    }

    public void recordDuration(long nanos) {
        try {
            duration.record(nanos, TimeUnit.NANOSECONDS);
        }
        catch (Exception e) {
            // 不抛出
        }
    }

    public void updateDlqSize(long size) {
        try {
            dlqSizeHolder.set(size);
        }
        catch (Exception e) {
            // 不抛出
        }
    }
}
