package com.iwhalecloud.byai.manager.application.service.digitemploy;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.integration.support.locks.LockRegistry;
import org.springframework.integration.support.locks.RenewableLockRegistry;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.util.Assert;

/** 同企业同资源的员工配置写入和运行态同步共享分布式锁，覆盖完整事务并自动续租。 */
@Component
public class EmployeeVersionLock {

    private final LockRegistry lockRegistry;

    public EmployeeVersionLock(@Qualifier("employeeVersionLockRegistry") LockRegistry lockRegistry) {
        this.lockRegistry = lockRegistry;
    }

    public void acquire(Long tenantId, Long resourceId) {
        Assert.notNull(tenantId, "tenantId must not be null");
        Assert.notNull(resourceId, "resourceId must not be null");
        String lockKey = tenantId + ":" + resourceId;
        Assert.state(TransactionSynchronizationManager.isActualTransactionActive()
            && TransactionSynchronizationManager.isSynchronizationActive(), "Employee version lock requires a transaction");
        for (TransactionSynchronization synchronization : TransactionSynchronizationManager.getSynchronizations()) {
            if (synchronization instanceof VersionLockSynchronization held && held.lockKey.equals(lockKey)) {
                return;
            }
        }

        Lock lock = lockRegistry.obtain(lockKey);
        try {
            if (!lock.tryLock(30, TimeUnit.SECONDS)) {
                throw new CannotAcquireLockException("Timed out waiting for employee version lock: " + lockKey);
            }
        }
        catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new CannotAcquireLockException("Interrupted waiting for employee version lock", exception);
        }
        try {
            TransactionSynchronizationManager.registerSynchronization(new VersionLockSynchronization(lockKey, lock, lockRegistry));
        }
        catch (RuntimeException exception) {
            lock.unlock();
            throw exception;
        }
    }

    private record VersionLockSynchronization(String lockKey, Lock lock, LockRegistry registry)
            implements TransactionSynchronization {
        @Override
        public void beforeCommit(boolean readOnly) {
            // 续租失败或锁已被其他实例取得时必须在数据库提交前失败，不能等 unlock 才发现。
            if (registry instanceof RenewableLockRegistry renewable) {
                renewable.renewLock(lockKey);
            }
        }

        @Override
        public void afterCompletion(int status) {
            lock.unlock();
        }
    }
}
