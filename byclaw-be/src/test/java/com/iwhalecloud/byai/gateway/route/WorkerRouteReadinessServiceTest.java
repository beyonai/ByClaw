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

        verify(sandboxService, never()).restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService, never()).waitWorkerReadySync("BYCLAW_EXE_u1", SandboxService.WORKER_READY_TIMEOUT_MS);
    }

    @Test
    void offlineWorkerIsStartedAndAwaitedBeforeTheRouteContinues() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenReturn(new SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync("BYCLAW_EXE_u1", SandboxService.WORKER_READY_TIMEOUT_MS))
            .thenReturn(true);

        service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> { });

        verify(sandboxService).restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService).waitWorkerReadySync("BYCLAW_EXE_u1", SandboxService.WORKER_READY_TIMEOUT_MS);
    }

    @Test
    void nonSandboxWorkerDoesNotTriggerAUserSandboxLaunch() {
        when(targetAgentResolver.isUserSandboxAgentType("BY_SUPER", "u1")).thenReturn(false);

        service.ensureReady("u1", 123L, "BY_SUPER", phase -> { });

        verify(workerRegistry, never()).hasOnlineAgentType("BY_SUPER", true);
        verify(sandboxService, never()).restartSandboxAfterRemoteExitWithoutWait("u1", 123L, "BY_SUPER");
    }

    @Test
    void concurrentRequestsForTheExactRouteShareOneSandboxLaunch() throws Exception {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_CODE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_CODE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        CountDownLatch launchEntered = new CountDownLatch(1);
        CountDownLatch allowLaunchToFinish = new CountDownLatch(1);
        CountDownLatch secondJoinedExistingStart = new CountDownLatch(1);
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", 123L, "BYCLAW_CODE_u1"))
            .thenAnswer(invocation -> {
                launchEntered.countDown();
                allowLaunchToFinish.await(5, TimeUnit.SECONDS);
                return new SandboxLaunchData();
            });
        when(sandboxService.waitWorkerReadySync("BYCLAW_CODE_u1", SandboxService.WORKER_READY_TIMEOUT_MS))
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
            .restartSandboxAfterRemoteExitWithoutWait("u1", 123L, "BYCLAW_CODE_u1");
        verify(sandboxService, times(1))
            .waitWorkerReadySync("BYCLAW_CODE_u1", SandboxService.WORKER_READY_TIMEOUT_MS);
    }

    @Test
    void readinessTimeoutFailsInsteadOfSendingToAnOfflineWorker() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenReturn(new SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync("BYCLAW_EXE_u1", SandboxService.WORKER_READY_TIMEOUT_MS))
            .thenReturn(false);

        assertThatThrownBy(() -> service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> { }))
            .isInstanceOf(IllegalStateException.class);

        verify(sandboxService, times(WorkerRouteReadinessService.SANDBOX_STARTUP_WAIT_ROUNDS))
            .waitWorkerReadySync("BYCLAW_EXE_u1", SandboxService.WORKER_READY_TIMEOUT_MS);
    }
}
