package com.iwhalecloud.byai.manager.application.runner.digemployeestartup;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.util.Objects;

/**
 * 启动期分布式锁 fencing token 防护（PR-2）。
 * <p>
 * Reviewer 建议方案：在每个 batch / chunk 前用 {@code GET lockValue} 校验
 * 锁是否仍由本 Pod 持有；若已被其他 Pod 接管（GC pause / 续租失败），
 * {@link #mayProceed} 返回 false，doFullInit 主动停止后续处理。
 * <p>
 * 该组件是无状态的：每次 {@link #mayProceed} 都会重新查 Redis。
 * 但进程内有 {@code volatile stopRequested} 缓存，避免 churn 大量 Redis GET。
 * <p>
 * 用法（InitDigEmployeeRedisRunner 调用方契约）：
 * <pre>{@code
 *   if (!lockGuard.mayProceed(LOCK_KEY, podId)) {
 *       // 锁已不在本 Pod 手中，主动退出 doFullInit
 *       break;
 *   }
 *   // 继续处理 chunk / page
 * }</code>
 */
@Component
public class StartupSyncLockGuard {

    private static final Logger logger = LoggerFactory.getLogger(StartupSyncLockGuard.class);

    private final StringRedisTemplate redisTemplate;

    /**
     * 一旦 fencing 检测到锁已不属于本 Pod，置 true 并缓存，
     * 避免后续 batch 重复触发 Redis GET。
     */
    private volatile boolean stopRequested = false;

    public StartupSyncLockGuard(StringRedisTemplate redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    /**
     * 检查锁是否仍由本 Pod 持有；不持有则请求停止。
     *
     * @param lockKey 锁 key
     * @param podId   当前 Pod 标识
     * @return true 可继续执行；false 应退出 doFullInit
     */
    public boolean mayProceed(String lockKey, String podId) {
        if (stopRequested) {
            return false;
        }
        if (lockKey == null || podId == null) {
            // 配置缺失时降级为允许继续，避免 fence 误杀
            return true;
        }
        try {
            String holder = redisTemplate.opsForValue().get(lockKey);
            if (!Objects.equals(holder, podId)) {
                logger.warn("StartupSyncLockGuard 检测到锁已不属于本 Pod —— 本 Pod 退出 doFullInit: "
                    + "lockKey={}, podId={}, currentHolder={}", lockKey, podId, holder);
                stopRequested = true;
                return false;
            }
            return true;
        }
        catch (Exception e) {
            // Redis 异常时降级为允许继续（避免 fence 误杀）
            logger.warn("StartupSyncLockGuard 读取锁异常，降级继续: lockKey={}, reason={}",
                lockKey, e.getMessage(), e);
            return true;
        }
    }

    /**
     * 显式请求停止（如 lock renewer 失败、shutdown hook 触发）。
     * 调用后 {@link #mayProceed} 必返回 false。
     */
    public void requestStop() {
        stopRequested = true;
        logger.info("StartupSyncLockGuard.requestStop called —— 后续 mayProceed 必返回 false");
    }
}
