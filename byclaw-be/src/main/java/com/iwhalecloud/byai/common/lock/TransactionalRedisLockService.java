package com.iwhalecloud.byai.common.lock;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.Assert;

/** Renewable cross-instance locks. Ownership is checked before commit and released after completion. */
// Excludes the repository *Service transaction auto-proxy: callers must own the transaction.
@Service("transactionalRedisLocks")
public class TransactionalRedisLockService {
    private final RedisLockRegistry registry;

    public TransactionalRedisLockService(@Qualifier("businessLockRegistry") RedisLockRegistry registry) {
        this.registry = registry;
    }

    public void acquire(String key) {
        Assert.state(TransactionSynchronizationManager.isActualTransactionActive()
            && TransactionSynchronizationManager.isSynchronizationActive(), "Business lock requires a transaction");
        for (var synchronization : TransactionSynchronizationManager.getSynchronizations()) {
            if (synchronization instanceof HeldLock held && held.owner == this && held.key.equals(key)) return;
        }
        Lock lock = obtain(key);
        try {
            for (Object resource : TransactionSynchronizationManager.getResourceMap().values()) {
                if (resource instanceof org.mybatis.spring.SqlSessionHolder holder) holder.getSqlSession().clearCache();
            }
            TransactionSynchronizationManager.registerSynchronization(new HeldLock(this, key, lock));
        } catch (RuntimeException error) {
            lock.unlock();
            throw error;
        }
    }

    /** Independent lifetime for external send/STOP gates, deliberately outside business transactions. */
    public Lock obtain(String key) {
        Assert.hasText(key, "Lock key is required");
        Lock lock = registry.obtain(key);
        try {
            if (!lock.tryLock(30, TimeUnit.SECONDS)) throw new CannotAcquireLockException("Business lock timed out");
            return lock;
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CannotAcquireLockException("Business lock interrupted", error);
        }
    }

    public void validate(String key) {
        registry.renewLock(key);
    }

    private static final class HeldLock implements TransactionSynchronization {
        private final TransactionalRedisLockService owner;
        private final String key;
        private final Lock lock;
        private boolean released;
        private HeldLock(TransactionalRedisLockService owner, String key, Lock lock) {
            this.owner = owner; this.key = key; this.lock = lock;
        }
        @Override public int getOrder() { return org.springframework.core.Ordered.HIGHEST_PRECEDENCE; }
        @Override public void beforeCommit(boolean readOnly) { owner.validate(key); }
        // Release after the physical commit, before callbacks can open a competing transaction.
        @Override public void afterCommit() { release(); }
        @Override public void afterCompletion(int status) { release(); }
        private void release() { if (!released) { released = true; lock.unlock(); } }
    }
}
