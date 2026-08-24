package com.iwhalecloud.byai.manager.domain.project.service;

import com.iwhalecloud.byai.common.util.RedisUtil;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.UUID;

/**
 * 仓库锁管理器
 *
 * 使用 Redis 分布式锁防止同一仓库同时被多个节点/请求初始化（竞态条件防护）
 */
@Slf4j
@Component
public class RepoLockManager {

    /**
     * Redis 锁前缀
     */
    private static final String LOCK_PREFIX = "project:init:lock:";

    /**
     * 锁的过期时间（秒）
     *
     * 设置为 10 分钟，防止进程异常退出导致锁永久持有
     * 正常情况下，初始化完成后会主动释放锁
     */
    private static final long LOCK_EXPIRE_SECONDS = 600;

    /**
     * 线程本地存储：记录当前线程持有的锁 value（用于释放时校验）
     */
    private final ThreadLocal<String> lockValueHolder = new ThreadLocal<>();

    /**
     * 获取锁（非阻塞）
     *
     * @param normalizedPath 仓库的规范化绝对路径
     * @return true 如果成功获取锁；false 如果锁已被其他请求持有
     */
    public boolean acquireLock(String normalizedPath) {
        String lockKey = LOCK_PREFIX + normalizedPath;
        String lockValue = UUID.randomUUID().toString();

        Boolean acquired = RedisUtil.lock(lockKey, lockValue, LOCK_EXPIRE_SECONDS);

        if (Boolean.TRUE.equals(acquired)) {
            lockValueHolder.set(lockValue);
            log.debug("Acquired distributed lock for repository: {}", normalizedPath);
            return true;
        } else {
            log.warn("Failed to acquire distributed lock for repository (already locked): {}", normalizedPath);
            return false;
        }
    }

    /**
     * 释放锁
     *
     * @param normalizedPath 仓库的规范化绝对路径
     */
    public void releaseLock(String normalizedPath) {
        String lockKey = LOCK_PREFIX + normalizedPath;
        String lockValue = lockValueHolder.get();

        if (lockValue == null) {
            log.warn("Attempted to release lock not held by current thread: {}", normalizedPath);
            return;
        }

        try {
            Boolean released = RedisUtil.releaseLock(lockKey, lockValue);
            if (Boolean.TRUE.equals(released)) {
                log.debug("Released distributed lock for repository: {}", normalizedPath);
            } else {
                log.warn("Failed to release distributed lock (lock may have expired or been taken by another process): {}", normalizedPath);
            }
        } finally {
            lockValueHolder.remove();
        }
    }
}
