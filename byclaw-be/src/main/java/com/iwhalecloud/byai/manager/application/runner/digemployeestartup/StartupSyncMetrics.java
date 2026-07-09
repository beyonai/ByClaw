package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 启动期同步 Micrometer 指标封装（PR-4 + PR-fix Major-2）。
 * <p>
 * 命名空间: {@code byai_digemployee_startup_sync.*}
 * <ul>
 *   <li>{@code byai_digemployee_startup_sync_total} - Counter, 总同步资源数
 *   <li>{@code byai_digemployee_startup_sync_success} - Counter, 成功资源数
 *   <li>{@code byai_digemployee_startup_sync_failure{reason}} - Counter, 失败资源数(按 reason 分桶)
 *   <li>{@code byai_digemployee_startup_sync_timeout} - Counter, 超时次数
 *   <li>{@code byai_digemployee_startup_sync_duration_seconds} - Timer, 同步总耗时
 *   <li>{@code byai_digemployee_startup_sync_dlq_size} - Gauge, 当前 DLQ 长度
 * </ul>
 *
 * <p><strong>PR-fix Major-2</strong>:
 * <ul>
 *   <li>所有 Counter/Timer/Gauge 统一通过注入的 {@link MeterRegistry} 注册（与其它 4 个指标一致风格）</li>
 *   <li>{@code failureByReason} 用 {@link ConcurrentHashMap} 缓存按 reason 分桶的 Counter 引用,
 *       避免每次失败都重建 Counter(原实现重复 {@code Counter.builder(...).register(...)} 每次都查注册表)</li>
 *   <li>不再使用 {@code Metrics.globalRegistry}(静态 API,与 Spring 注入式风格不一致;且 globalRegistry 在
 *       @MockBean 测试环境下无法被替换,影响测试友好性)</li>
 * </ul>
 *
 * <p>所有 counter increment / gauge set 操作不抛异常, 失败时仅 log warn.
 *
 * @author ByClaw PR-4 / PR-fix Major-2
 */
@Component
public class StartupSyncMetrics {

    private static final Logger logger = LoggerFactory.getLogger(StartupSyncMetrics.class);

    private final MeterRegistry registry;
    private final Counter totalCounter;
    private final Counter successCounter;
    private final Counter timeoutCounter;
    private final Counter failureCounter;
    private final Timer durationTimer;
    private final AtomicLong dlqSizeHolder = new AtomicLong(0);

    /**
     * 按 reason 分桶的失败 Counter 缓存(PR-fix Major-2)。
     * <p>
     * Key = reason(已 normalize 为非 null)
     * Value = 已注册的 Counter 引用
     */
    private final ConcurrentMap<String, Counter> failureByReason = new ConcurrentHashMap<>();

    public StartupSyncMetrics(MeterRegistry registry) {
        this.registry = registry;
        this.totalCounter = Counter.builder("byai.digemployee.startup.sync.total")
            .description("Total digital employees processed in startup sync")
            .register(registry);
        this.successCounter = Counter.builder("byai.digemployee.startup.sync.success")
            .description("Successfully synced digital employees")
            .register(registry);
        this.timeoutCounter = Counter.builder("byai.digemployee.startup.sync.timeout")
            .description("Total timeout events")
            .register(registry);
        this.failureCounter = Counter.builder("byai.digemployee.startup.sync.failure")
            .description("Total failure events (sum across all reasons)")
            .register(registry);
        this.durationTimer = Timer.builder("byai.digemployee.startup.sync.duration")
            .description("Startup sync total duration")
            .register(registry);
        Gauge.builder("byai.digemployee.startup.sync.dlq.size", dlqSizeHolder, AtomicLong::doubleValue)
            .description("DLQ current size")
            .register(registry);
    }

    public void recordTotal(long n) {
        if (n > 0) {
            try {
                totalCounter.increment(n);
            }
            catch (Exception e) {
                // 不抛出
            }
        }
    }

    public void recordSuccess(long n) {
        if (n > 0) {
            try {
                successCounter.increment(n);
            }
            catch (Exception e) {
                // 不抛出
            }
        }
    }

    /**
     * PR-fix Major-2: 用 ConcurrentHashMap 缓存按 reason 的 Counter 引用,
     * 避免每次失败都重建 Counter。
     * <p>
     * 注意: reason 来自异常 message,理论上 unbounded(可能产生 metric 基数爆炸)。
     * 当前实现不做白名单(由调用方在 record 前 normalize);
     * follow-up 建议在调用方 normalize reason 到白名单枚举(perPageTimeout/totalTimeout/fencingTokenLost 等)。
     */
    public void recordFailure(String reason) {
        try {
            String r = reason == null ? "unknown" : reason;
            Counter counter = failureByReason.computeIfAbsent(r, k -> Counter.builder("byai.digemployee.startup.sync.failure")
                .description("Startup sync failure events by reason")
                .tag("reason", k)
                .register(registry));
            counter.increment();
            failureCounter.increment();
        }
        catch (Exception e) {
            // 不抛出
        }
    }

    public void recordTimeout() {
        try {
            timeoutCounter.increment();
        }
        catch (Exception e) {
            // 不抛出
        }
    }

    public void recordDuration(long nanos) {
        try {
            durationTimer.record(nanos, TimeUnit.NANOSECONDS);
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
