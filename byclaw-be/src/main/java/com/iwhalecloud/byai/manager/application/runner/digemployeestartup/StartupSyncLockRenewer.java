package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import com.iwhalecloud.byai.common.util.RedisUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 启动期分布式锁续租器（PR-2）。
 * <p>
 * 核心职责：抢到 {@code byai:dig-employee:startup-sync} 锁的 Pod 在同步期间
 * 周期 {@code renewLock}，防止租约在长跑 Runner 完成前过期。
 * <p>
 * 行为约定：
 * <ul>
 *     <li>续租失败 → 主动 {@code releaseLock} 并抛 {@link RuntimeException}，
 *         触发 doFullInit 的 fencing 退出路径</li>
 *     <li>{@link #stopRenewal} 幂等可重复调用，无资源泄漏</li>
 *     <li>不持有任何状态；lock key 与 podId 由调用方传入，便于多 Pod 共用同一实现</li>
 * </ul>
 */
@Component
public class StartupSyncLockRenewer {

    private static final Logger logger = LoggerFactory.getLogger(StartupSyncLockRenewer.class);

    /**
     * 启动后台续租心跳。
     *
     * @param lockKey 锁 key（约定：{@code byai:dig-employee:startup-sync}）
     * @param podId 当前 Pod 标识（{@code POD_NAME@POD_IP}），用于 CAS 续租的 value
     * @param renewIntervalSeconds 续租间隔（默认 30s）
     * @param lockExpireSeconds 锁租约（默认 600s）
     * @return ScheduledExecutorService 调用方负责 {@link #stopRenewal} 关闭
     */
    public ScheduledExecutorService startRenewal(String lockKey, String podId,
                                                int renewIntervalSeconds, int lockExpireSeconds) {
        if (lockKey == null || podId == null) {
            throw new IllegalArgumentException("lockKey/podId 不能为空");
        }
        final int interval = Math.max(1, renewIntervalSeconds);
        final int expire = Math.max(interval + 1, lockExpireSeconds);

        final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor(
            new ThreadFactory() {
                private final AtomicInteger idx = new AtomicInteger(0);
                @Override
                public Thread newThread(Runnable r) {
                    Thread t = new Thread(r, "lock-renewer-" + idx.incrementAndGet());
                    t.setDaemon(true);
                    return t;
                }
            });

        scheduler.scheduleAtFixedRate(() -> {
            try {
                boolean renewed = RedisUtil.renewLock(lockKey, podId, expire);
                if (!renewed) {
                    logger.warn("renewLock CAS 失败: lockKey={}, podId={} —— 锁已被其他 Pod 接管或租约过期",
                        lockKey, podId);
                    throw new IllegalStateException("renewLock CAS failed; lock lost");
                }
            }
            catch (Throwable t) {
                // 任何失败：主动释放锁 + 抛异常终止后续任务
                logger.error("renewLock 异常, lockKey={}, podId={}, reason={} —— 主动释放锁并停止续租",
                    lockKey, podId, t.getMessage(), t);
                try {
                    RedisUtil.releaseLock(lockKey, podId);
                }
                catch (Throwable releaseEx) {
                    logger.warn("renewLock 失败后 releaseLock 仍异常, reason={}", releaseEx.getMessage());
                }
                // 抛异常让 scheduleAtFixedRate 取消后续任务
                throw new RuntimeException(t);
            }
        }, interval, interval, TimeUnit.SECONDS);

        logger.info("StartupSyncLockRenewer 启动: lockKey={}, podId={}, renewInterval={}s, lockExpire={}s",
            lockKey, podId, interval, expire);
        return scheduler;
    }

    /**
     * 停止续租调度。幂等可重复调用。
     *
     * @param scheduler 由 {@link #startRenewal} 返回的实例；为 null 时静默忽略
     */
    public void stopRenewal(ScheduledExecutorService scheduler) {
        if (scheduler == null || scheduler.isShutdown()) {
            return;
        }
        scheduler.shutdownNow();
        try {
            if (!scheduler.awaitTermination(5, TimeUnit.SECONDS)) {
                logger.warn("renewer 未在 5s 内停止，强制取消剩余任务");
            }
        }
        catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }
}
