package com.iwhalecloud.byai.gateway.route;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import org.junit.jupiter.api.Test;

class WorkerRouteReadinessServiceTest {

    private final WorkerRegistry workerRegistry = mock(WorkerRegistry.class);

    private final SandboxService sandboxService = mock(SandboxService.class);

    private final TargetAgentResolver targetAgentResolver = mock(TargetAgentResolver.class);

    private final WorkerRouteReadinessService service = new WorkerRouteReadinessService(
        workerRegistry, sandboxService, targetAgentResolver);

    @Test
    void onlineWorkerUsesTheRegistryFastPathWithoutTouchingSandboxLifecycle() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(true, Collections.singletonList("worker-1")));

        service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> { });

        verify(sandboxService, never()).restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService, never()).waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }

    @Test
    void offlineWorkerIsStartedAndAwaitedBeforeTheRouteContinues() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenReturn(new SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000)))
            .thenReturn(true);

        service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> { });

        verify(sandboxService).restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService).waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }

    @Test
    void nonSandboxWorkerDoesNotTriggerAUserSandboxLaunch() {
        when(targetAgentResolver.isUserSandboxAgentType("BY_SUPER", "u1")).thenReturn(false);

        service.ensureReady("u1", 123L, "BY_SUPER", phase -> { });

        verify(workerRegistry, never()).hasOnlineAgentType("BY_SUPER", true);
        verify(sandboxService, never()).restartSandboxForTargetWithoutWait("u1", 123L, "BY_SUPER");
    }

    @Test
    void concurrentRequestsForTheExactRouteShareOneSandboxLaunch() throws Exception {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_CODE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_CODE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        CountDownLatch launchEntered = new CountDownLatch(1);
        CountDownLatch allowLaunchToFinish = new CountDownLatch(1);
        CountDownLatch secondJoinedExistingStart = new CountDownLatch(1);
        when(sandboxService.restartSandboxForTargetWithoutWait("u1", 123L, "BYCLAW_CODE_u1"))
            .thenAnswer(invocation -> {
                launchEntered.countDown();
                allowLaunchToFinish.await(5, TimeUnit.SECONDS);
                return new SandboxLaunchData();
            });
        when(sandboxService.waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_CODE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000)))
            .thenReturn(true);

        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = executor.submit(
                () -> service.ensureReady("u1", 123L, "BYCLAW_CODE_u1", phase -> { }));
            assertThat(launchEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<?> second = executor.submit(
                () -> service.ensureReady("u1", 123L, "BYCLAW_CODE_u1", phase -> {
                    if (phase == WorkerRouteReadinessService.ReadinessPhase.WAITING) {
                        secondJoinedExistingStart.countDown();
                    }
                }));
            assertThat(secondJoinedExistingStart.await(5, TimeUnit.SECONDS)).isTrue();
            allowLaunchToFinish.countDown();
            first.get(5, TimeUnit.SECONDS);
            second.get(5, TimeUnit.SECONDS);
        }
        finally {
            executor.shutdownNow();
        }

        verify(sandboxService, times(1))
            .restartSandboxForTargetWithoutWait("u1", 123L, "BYCLAW_CODE_u1");
        verify(sandboxService, times(1))
            .waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_CODE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }

    @Test
    void readinessTimeoutFailsInsteadOfSendingToAnOfflineWorker() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenReturn(new SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000)))
            .thenReturn(false);

        assertThatThrownBy(() -> service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> { }))
            .isInstanceOf(IllegalStateException.class);

        verify(sandboxService, times(1))
            .waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }
    @Test
    void followerTimesOutWithoutCancelingAnUnfinishedLeader() throws Exception {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 40);
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(sandboxService.restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenAnswer(invocation -> { entered.countDown(); release.await(3, TimeUnit.SECONDS); return new SandboxLaunchData(); });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> leader = executor.submit(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("did not become ready");
            assertThat(leader.isDone()).isFalse();
            verify(sandboxService, times(1)).restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
            release.countDown();
            assertThatThrownBy(() -> leader.get(2, TimeUnit.SECONDS)).isInstanceOf(java.util.concurrent.ExecutionException.class);
            verify(sandboxService, never()).waitWorkerReadySync(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong());
        }
        finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test
    void interruptedFollowerExitsAndPreservesItsInterruptFlag() throws Exception {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1), joined = new CountDownLatch(1), exited = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean interrupted = new java.util.concurrent.atomic.AtomicBoolean();
        when(sandboxService.restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenAnswer(invocation -> { entered.countDown(); release.await(3, TimeUnit.SECONDS); return new SandboxLaunchData(); });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        Thread follower = new Thread(() -> {
            try { service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> {
                if (phase == WorkerRouteReadinessService.ReadinessPhase.WAITING) joined.countDown();
            }); }
            catch (IllegalStateException expected) { interrupted.set(Thread.currentThread().isInterrupted()); }
            finally { exited.countDown(); }
        });
        try {
            executor.submit(() -> service.ensureReady("u1", null, "BYCLAW_EXE_u1", null));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            follower.start();
            assertThat(joined.await(2, TimeUnit.SECONDS)).isTrue();
            follower.interrupt();
            assertThat(exited.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(interrupted).isTrue();
        }
        finally { follower.interrupt(); release.countDown(); executor.shutdownNow(); }
    }

    @Test
    void launchTimeConsumesTheReadinessBudgetInsteadOfAddingAnotherFullWait() {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 10);
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenAnswer(invocation -> { Thread.sleep(30); return new SandboxLaunchData(); });
        assertThatThrownBy(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null))
            .isInstanceOf(IllegalStateException.class);
        verify(sandboxService, never()).waitWorkerReadySync(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong());
    }

}
