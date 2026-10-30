package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class ResourceSyncDispatcherTest {
    private final ResourceSyncReconcileService reconciler = mock(ResourceSyncReconcileService.class);

    @ParameterizedTest
    @CsvSource({"COMPLETED,0,COMPLETED,true", "COMPLETED,1,COMPLETED,false",
        "PARTIAL_V2,0,PARTIAL,false", "FAILED_V2,0,FAILED,false", "RUNNING_V2,0,RUNNING,false"})
    void reportsOnlyCompletedUnskippedWorkAsEffective(String stored, int skipped, String external, boolean effective) {
        var job = new ResourceSyncJob(); job.setSyncJobId(100L); job.setStatus(stored);
        job.setResultSummary("{\"skippedUserCount\":" + skipped + "}");
        when(reconciler.reconcileNow(100L)).thenReturn(job);
        var dispatcher = new ResourceSyncDispatcher(reconciler, Runnable::run, 5000);
        assertThat(dispatcher.dispatch(100L)).containsEntry("status", external).containsEntry("effective", effective);
    }

    @Test void timeoutReturnsPendingWithoutCancellingTheWorkerOrMutatingTheResponse() throws Exception {
        var release = new CountDownLatch(1);
        var done = new CountDownLatch(1);
        when(reconciler.reconcileNow(100L)).thenAnswer(call -> {
            release.await(3, TimeUnit.SECONDS);
            var job = new ResourceSyncJob(); job.setSyncJobId(100L); job.setStatus("COMPLETED");
            done.countDown(); return job;
        });
        try (var executor = Executors.newSingleThreadExecutor()) {
            var response = new ResourceSyncDispatcher(reconciler, executor, 20).dispatch(100L);
            assertThat(response).containsEntry("status", "PENDING").containsEntry("effective", false);
            release.countDown();
            assertThat(done.await(3, TimeUnit.SECONDS)).isTrue();
            assertThat(response).containsEntry("status", "PENDING");
        } finally { release.countDown(); }
    }

    @Test void queueRejectionLeavesTheAcceptedJobPendingForScheduledRecovery() {
        var dispatcher = new ResourceSyncDispatcher(reconciler, task -> { throw new RejectedExecutionException(); }, 20);
        assertThat(dispatcher.dispatch(100L)).containsEntry("status", "PENDING").containsEntry("effective", false);
        verifyNoInteractions(reconciler);
    }

    @Test void workerExceptionDoesNotMisreportCompletionOrFailTheCommittedImport() {
        when(reconciler.reconcileNow(100L)).thenThrow(new IllegalStateException("database unavailable"));
        assertThat(new ResourceSyncDispatcher(reconciler, Runnable::run, 20).dispatch(100L))
            .containsEntry("status", "PENDING").containsEntry("effective", false);
    }
}
