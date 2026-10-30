package com.iwhalecloud.byai.common.lock;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 不启动 Redis，验证事务与锁的生命周期边界。 */
class TransactionalRedisLockServiceTest {
    private final RedisLockRegistry registry = mock(RedisLockRegistry.class);
    private final Lock lock = mock(Lock.class);
    private final TransactionalRedisLockService service = new TransactionalRedisLockService(registry);
    private static final String KEY = "quota-write-guard:ENTERPRISE_MEMBER:42";

    @BeforeEach
    void setup() throws Exception {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        TransactionSynchronizationManager.initSynchronization();
        when(registry.obtain(KEY)).thenReturn(lock);
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenReturn(true);
    }

    @AfterEach
    void cleanup() {
        TransactionSynchronizationManager.clear();
        Thread.interrupted();
    }

    @Test
    void duplicateAcquisitionRenewsBeforeCommitAndUnlocksOnlyOnceAfterCommit() throws Exception {
        service.acquire(KEY);
        service.acquire(KEY);
        verify(lock, times(1)).tryLock(30, TimeUnit.SECONDS);
        verify(lock, never()).unlock();
        var callback = TransactionSynchronizationManager.getSynchronizations().getFirst();
        callback.beforeCommit(false);
        verify(registry).renewLock(KEY);
        verify(lock, never()).unlock();
        callback.afterCommit();
        callback.afterCompletion(TransactionSynchronization.STATUS_COMMITTED);
        verify(lock, times(1)).unlock();
    }

    @Test
    void rollbackReleasesWithoutCommitCallback() {
        service.acquire(KEY);
        TransactionSynchronizationManager.getSynchronizations().getFirst()
            .afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
        verify(lock).unlock();
    }

    @Test
    void lostOwnershipPreventsCommitAndStillAttemptsCleanup() {
        service.acquire(KEY);
        doThrow(new IllegalStateException("lost")).when(registry).renewLock(KEY);
        var callback = TransactionSynchronizationManager.getSynchronizations().getFirst();
        assertThrows(IllegalStateException.class, () -> callback.beforeCommit(false));
        callback.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
        verify(lock).unlock();
    }

    @Test
    void timeoutDoesNotUnlockAnotherOwner() throws Exception {
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenReturn(false);
        assertThrows(org.springframework.dao.CannotAcquireLockException.class, () -> service.acquire(KEY));
        verify(lock, never()).unlock();
    }

    @Test
    void interruptedAcquisitionRestoresInterruptAndDoesNotUnlock() throws Exception {
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenThrow(new InterruptedException());
        assertThrows(org.springframework.dao.CannotAcquireLockException.class, () -> service.acquire(KEY));
        org.junit.jupiter.api.Assertions.assertTrue(Thread.currentThread().isInterrupted());
        verify(lock, never()).unlock();
    }

    @Test
    void missingTransactionNeverObtainsLock() {
        TransactionSynchronizationManager.setActualTransactionActive(false);
        assertThrows(IllegalStateException.class, () -> service.acquire(KEY));
        verifyNoInteractions(registry);
    }
}
