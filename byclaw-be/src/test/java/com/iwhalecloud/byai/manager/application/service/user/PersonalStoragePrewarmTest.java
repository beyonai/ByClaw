package com.iwhalecloud.byai.manager.application.service.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.ArrayDeque;
import java.util.Queue;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.state.common.exception.StoragePreparingException;

class PersonalStoragePrewarmTest {
    final PlatformRemoteGateway platform = mock(PlatformRemoteGateway.class);
    final Queue<Runnable> jobs = new ArrayDeque<>();
    final PersonalStoragePrewarm prewarm = new PersonalStoragePrewarm(platform, jobs::add);

    @org.junit.jupiter.api.BeforeEach void enableAdmissionForExistingPolicyTests() {
        when(platform.isPersonalStorageAdmissionEnabled()).thenReturn(true);
    }

    @AfterEach void cleanup() { TransactionSynchronizationManager.clear(); }

    @Test void disabledAdmissionDoesNotScheduleAccountStoragePrewarm() {
        when(platform.isRemote()).thenReturn(true);
        when(platform.isPersonalStorageAdmissionEnabled()).thenReturn(false);
        prewarm.afterCommit("new-user");
        assertThat(jobs).isEmpty();
        verify(platform, never()).call(anyString(), anyString(), any());
    }

    @Test void waitsForCommitAndDoesNotProvisionRolledBackAccounts() {
        when(platform.isRemote()).thenReturn(true);
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        prewarm.afterCommit("new-user");
        assertThat(jobs).isEmpty();
        TransactionSynchronizationManager.getSynchronizations().forEach(s ->
            s.afterCompletion(TransactionSynchronization.STATUS_ROLLED_BACK));
        assertThat(jobs).isEmpty();
        verify(platform, never()).call(anyString(), anyString(), any());
    }

    @Test void committedAccountsReserveAsynchronouslyAndPreparingIsExpected() {
        when(platform.isRemote()).thenReturn(true);
        when(platform.call(eq("storage"), eq("quota-check"), any())).thenThrow(new StoragePreparingException());
        TransactionSynchronizationManager.initSynchronization();
        TransactionSynchronizationManager.setActualTransactionActive(true);
        prewarm.afterCommit("new-user");
        TransactionSynchronizationManager.getSynchronizations().forEach(TransactionSynchronization::afterCommit);
        assertThat(jobs).hasSize(1);
        verify(platform, never()).call(anyString(), anyString(), any());
        prewarm.afterCommit("new-user");
        TransactionSynchronizationManager.clear();
        jobs.remove().run();
        verify(platform).params("userCode", "new-user", "operation", "CHAT", "requestedBytes", 0L);
        verify(platform).call(eq("storage"), eq("quota-check"), any());
    }

    @Test void submissionFailureDoesNotBreakCreationOrPreventLaterRetry() {
        when(platform.isRemote()).thenReturn(true);
        java.util.concurrent.atomic.AtomicBoolean reject = new java.util.concurrent.atomic.AtomicBoolean(true);
        PersonalStoragePrewarm resilient = new PersonalStoragePrewarm(platform, task -> {
            if (reject.get()) throw new java.util.concurrent.RejectedExecutionException();
            jobs.add(task);
        });
        resilient.afterCommit("new-user");
        assertThat(jobs).isEmpty();
        reject.set(false);
        resilient.afterCommit("new-user");
        when(platform.call(eq("storage"), eq("quota-check"), any())).thenThrow(new IllegalStateException("offline"));
        jobs.remove().run();
        resilient.afterCommit("new-user");
        assertThat(jobs).hasSize(1);
    }

    @Test void legacyDoesNotReserveAndRepeatedRequestsCoalesce() {
        prewarm.afterCommit("new-user");
        assertThat(jobs).isEmpty();
        when(platform.isRemote()).thenReturn(true);
        prewarm.afterCommit("new-user");
        prewarm.afterCommit("new-user");
        assertThat(jobs).hasSize(1);
        jobs.remove().run();
        prewarm.afterCommit("new-user");
        assertThat(jobs).hasSize(1);
    }
}
