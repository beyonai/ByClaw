package com.iwhalecloud.byai.manager.domain.resource.service;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.integration.support.locks.LockRegistry;
import org.springframework.integration.support.locks.RenewableLockRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.Assert;

/** 同编码导入与审核共享分布式锁，锁覆盖整个写事务，包括数据库提交。 */
@Service
public class SkillImportLockService {

    private final LockRegistry lockRegistry;

    public SkillImportLockService(@Qualifier("skillImportLockRegistry") LockRegistry lockRegistry) {
        this.lockRegistry = lockRegistry;
    }

    public void acquire(String resourceCode) {
        Assert.hasText(resourceCode, "resourceCode must not be blank");
        Assert.state(TransactionSynchronizationManager.isActualTransactionActive()
            && TransactionSynchronizationManager.isSynchronizationActive(), "Skill import lock requires a transaction");
        for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
            if (synchronization instanceof SkillLockSynchronization held && held.resourceCode.equals(resourceCode)) {
                return;
            }
        }

        Lock lock = lockRegistry.obtain(resourceCode);
        try {
            if (!lock.tryLock(30, TimeUnit.SECONDS)) {
                throw new CannotAcquireLockException("Timed out waiting for skill import lock: " + resourceCode);
            }
        }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new CannotAcquireLockException("Interrupted waiting for skill import lock", exception);
        }
        try {
            TransactionSynchronizationManager.registerSynchronization(new SkillLockSynchronization(resourceCode, lock, lockRegistry));
        }
        catch (RuntimeException exception) {
            lock.unlock();
            throw exception;
        }
    }

    private record SkillLockSynchronization(String resourceCode, Lock lock, LockRegistry registry)
            implements TransactionSynchronization {
        @Override
        public void beforeCommit(boolean readOnly) {
            // 续租失败或锁已被其他实例取得时必须在数据库提交前失败，不能等 unlock 才发现。
            if (registry instanceof RenewableLockRegistry renewable) {
                renewable.renewLock(resourceCode);
            }
        }

        @Override
        public void afterCompletion(int status) {
            lock.unlock();
        }
    }
}
