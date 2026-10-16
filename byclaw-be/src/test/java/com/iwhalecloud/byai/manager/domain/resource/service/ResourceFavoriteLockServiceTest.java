package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.Lock;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.integration.support.locks.RenewableLockRegistry;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

class ResourceFavoriteLockServiceTest {
    private final RenewableLockRegistry registry = mock(RenewableLockRegistry.class);
    private final Lock lock = mock(Lock.class);
    private final ResourceFavoriteLockService service = new ResourceFavoriteLockService(registry);

    @BeforeEach void setup() throws Exception {
        TransactionSynchronizationManager.setActualTransactionActive(true);
        TransactionSynchronizationManager.initSynchronization();
        when(registry.obtain("22:33")).thenReturn(lock);
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenReturn(true);
    }

    @AfterEach void cleanup() {
        TransactionSynchronizationManager.clear();
        Thread.interrupted();
    }

    @Test void lockIsReentrantWithinTransactionAndReleasedOnlyAfterCommitOrRollback() {
        service.acquire(22L, 33L);
        service.acquire(22L, 33L);
        verify(registry, times(1)).obtain("22:33");
        verify(lock, never()).unlock();
        var synchronizations = TransactionSynchronizationManager.getSynchronizations();
        assertThat(synchronizations).hasSize(1);
        var synchronization = synchronizations.get(0);
        synchronization.beforeCommit(false);
        verify(registry).renewLock("22:33");
        verify(lock, never()).unlock();
        synchronization.afterCompletion(TransactionSynchronization.STATUS_COMMITTED);
        verify(lock).unlock();
    }

    @Test void rollbackAlsoReleasesLockAndRenewalFailurePropagates() {
        service.acquire(22L, 33L);
        doThrow(new IllegalStateException("lost lock")).when(registry).renewLock("22:33");
        var synchronization = TransactionSynchronizationManager.getSynchronizations().get(0);
        assertThatThrownBy(() -> synchronization.beforeCommit(false)).hasMessage("lost lock");
        synchronization.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK);
        verify(lock).unlock();
    }

    @Test void missingTransactionCannotAcquireLock() {
        TransactionSynchronizationManager.setActualTransactionActive(false);
        assertThatThrownBy(() -> service.acquire(22L, 33L)).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(registry);
    }

    @Test void timeoutDoesNotRegisterOrReleaseAnUnownedLock() throws Exception {
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenReturn(false);
        assertThatThrownBy(() -> service.acquire(22L, 33L)).isInstanceOf(CannotAcquireLockException.class);
        assertThat(TransactionSynchronizationManager.getSynchronizations()).isEmpty();
        verify(lock, never()).unlock();
    }

    @Test void interruptionRestoresTheFlagAndCannotContinueWriting() throws Exception {
        when(lock.tryLock(30, TimeUnit.SECONDS)).thenThrow(new InterruptedException("interrupted"));
        assertThatThrownBy(() -> service.acquire(22L, 33L)).isInstanceOf(CannotAcquireLockException.class);
        assertThat(Thread.currentThread().isInterrupted()).isTrue();
        verify(lock, never()).unlock();
    }
}
