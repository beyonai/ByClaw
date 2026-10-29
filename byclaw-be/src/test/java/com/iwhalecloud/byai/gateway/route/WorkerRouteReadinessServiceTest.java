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

        verify(sandboxService, never()).launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService, never()).waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }

    @Test
    void offlineWorkerIsStartedAndAwaitedBeforeTheRouteContinues() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenReturn(new SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000)))
            .thenReturn(true);

        service.ensureReady("u1", null, "BYCLAW_EXE_u1", phase -> { });

        verify(sandboxService).launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService, never()).restartSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(sandboxService).waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }

    @Test
    void nonSandboxWorkerDoesNotTriggerAUserSandboxLaunch() {
        when(targetAgentResolver.isUserSandboxAgentType("BY_SUPER", "u1")).thenReturn(false);

        service.ensureReady("u1", 123L, "BY_SUPER", phase -> { });

        verify(workerRegistry, never()).hasOnlineAgentType("BY_SUPER", true);
        verify(sandboxService, never()).launchSandboxForTargetWithoutWait("u1", 123L, "BY_SUPER");
    }

    @Test
    void concurrentRequestsForTheExactRouteShareOneSandboxLaunch() throws Exception {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_CODE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_CODE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        CountDownLatch launchEntered = new CountDownLatch(1);
        CountDownLatch allowLaunchToFinish = new CountDownLatch(1);
        CountDownLatch secondJoinedExistingStart = new CountDownLatch(1);
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", 123L, "BYCLAW_CODE_u1"))
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
            .launchSandboxForTargetWithoutWait("u1", 123L, "BYCLAW_CODE_u1");
        verify(sandboxService, times(1))
            .waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_CODE_u1"), org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= 60000));
    }

    @Test
    void readinessTimeoutFailsInsteadOfSendingToAnOfflineWorker() {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
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
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenAnswer(invocation -> { entered.countDown(); release.await(3, TimeUnit.SECONDS); return new SandboxLaunchData(); });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> leader = executor.submit(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("did not become ready");
            assertThat(leader.isDone()).isTrue();
            verify(sandboxService, times(1)).launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1");
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
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
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
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenAnswer(invocation -> { Thread.sleep(30); return new SandboxLaunchData(); });
        assertThatThrownBy(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null))
            .isInstanceOf(IllegalStateException.class);
        verify(sandboxService, never()).waitWorkerReadySync(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void blockingLaunchCannotHoldTheCallerPastBudgetOrStartAnotherLaunchAfterTimeout() throws Exception {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 40);
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_DSH_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_DSH_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_DSH_u1"))
            .thenAnswer(invocation -> { entered.countDown(); release.await(5, TimeUnit.SECONDS); return new SandboxLaunchData(); });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> caller = executor.submit(() -> bounded.ensureReady("u1", null, "BYCLAW_DSH_u1", null));
            assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> caller.get(400, TimeUnit.MILLISECONDS))
                .isInstanceOf(java.util.concurrent.ExecutionException.class)
                .hasCauseInstanceOf(IllegalStateException.class);
            assertThatThrownBy(() -> bounded.ensureReady("u1", null, "BYCLAW_DSH_u1", null))
                .isInstanceOf(IllegalStateException.class);
            verify(sandboxService, times(1)).launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_DSH_u1");
        }
        finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test
    void sharedTargetResolutionIsBoundedAndKeepsTenantOwnershipWhileCallerTimesOut() throws Exception {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 40);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        var tenant = new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(1, 10, "MEMBER");
        var login = new com.iwhalecloud.byai.common.login.bean.LoginInfo();
        login.setUserCode("u1");
        com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.setLoginInfo(login);
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
        when(targetAgentResolver.resolveAgentType("BYCLAW_DSH", null, null, "u1")).thenAnswer(invocation -> {
            assertThat(com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.get()).isEqualTo(tenant);
            assertThat(com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.getCurrentUserCode()).isEqualTo("u1");
            assertThat(org.springframework.context.i18n.LocaleContextHolder.getLocale()).isEqualTo(java.util.Locale.US);
            entered.countDown(); release.await(5, TimeUnit.SECONDS); return "BYCLAW_DSH_SHARED_context";
        });
        com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.set(tenant);
        try {
            assertThatThrownBy(() -> bounded.resolveTarget("u1", null, "BYCLAW_DSH", null, bounded.startupDeadline()))
                .isInstanceOf(IllegalStateException.class);
            assertThat(entered.getCount()).isZero();
            assertThatThrownBy(() -> bounded.resolveTarget("u1", null, "BYCLAW_DSH", null, bounded.startupDeadline()))
                .isInstanceOf(IllegalStateException.class);
            verify(targetAgentResolver, times(1)).resolveAgentType("BYCLAW_DSH", null, null, "u1");
        }
        finally {
            release.countDown();
            com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.clear();
            com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.clearLoginInfo();
            org.springframework.context.i18n.LocaleContextHolder.resetLocaleContext();
        }
    }

    @Test
    void startupExecutorSaturationRejectsInsteadOfRunningRpcOnCallerAndAllowsLaterRetry() throws Exception {
        var executor = new SandboxStartupConfiguration().sandboxStartupExecutor();
        executor.setCorePoolSize(1); executor.setMaxPoolSize(1); executor.setQueueCapacity(0); executor.initialize();
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        executor.execute(() -> { entered.countDown(); try { release.await(); } catch (InterruptedException error) { Thread.currentThread().interrupt(); } });
        assertThat(entered.await(1, TimeUnit.SECONDS)).isTrue();
        org.springframework.test.util.ReflectionTestUtils.setField(service, "startupExecutor", executor);
        try {
            assertThatThrownBy(() -> service.resolveTarget("u1", null, "BYCLAW_DSH", null, service.startupDeadline()))
                .isInstanceOf(java.util.concurrent.RejectedExecutionException.class);
            verify(targetAgentResolver, never()).resolveAgentType("BYCLAW_DSH", null, null, "u1");
            org.springframework.test.util.ReflectionTestUtils.setField(service, "startupExecutor", (java.util.concurrent.Executor) Runnable::run);
            when(targetAgentResolver.resolveAgentType("BYCLAW_DSH", null, null, "u1")).thenReturn("BYCLAW_DSH_u1");
            assertThat(service.resolveTarget("u1", null, "BYCLAW_DSH", null, service.startupDeadline())).isEqualTo("BYCLAW_DSH_u1");
        }
        finally { release.countDown(); executor.shutdown(); }
    }

    @Test
    void expiredQueuedStartupDoesNotCreateASandboxOrWriteLateProgress() {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 10);
        java.util.concurrent.atomic.AtomicReference<Runnable> queued = new java.util.concurrent.atomic.AtomicReference<>();
        org.springframework.test.util.ReflectionTestUtils.setField(bounded, "startupExecutor", (java.util.concurrent.Executor) queued::set);
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_DSH_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_DSH_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        java.util.List<WorkerRouteReadinessService.ReadinessPhase> phases = new java.util.ArrayList<>();
        assertThatThrownBy(() -> bounded.ensureReady("u1", null, "BYCLAW_DSH_u1", phases::add))
            .isInstanceOf(IllegalStateException.class);
        queued.get().run();
        verify(sandboxService, never()).launchSandboxForTargetWithoutWait(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        assertThat(phases).isEmpty();
    }

    @Test
    void slowRegistryFastPathCannotBlockTheCallerPastStartupDeadline() throws Exception {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 40);
        CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true)).thenAnswer(invocation -> {
            entered.countDown(); release.await(5, TimeUnit.SECONDS);
            return new WorkerRegistry.OnlineAgentCheckResult(true, Collections.emptyList());
        });
        ExecutorService executor = Executors.newSingleThreadExecutor();
        try {
            Future<?> call = executor.submit(() -> bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null));
            assertThat(entered.await(1, TimeUnit.SECONDS)).isTrue();
            assertThatThrownBy(() -> call.get(400, TimeUnit.MILLISECONDS))
                .isInstanceOf(java.util.concurrent.ExecutionException.class);
            verify(sandboxService, never()).launchSandboxForTargetWithoutWait(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        }
        finally { release.countDown(); executor.shutdownNow(); }
    }

    @Test
    void sharedStartsFromDifferentTenantsDoNotJoinTheSameLocalFuture() throws Exception {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 40);
        CountDownLatch entered = new CountDownLatch(2), release = new CountDownLatch(1);
        java.util.Set<Long> seen = java.util.concurrent.ConcurrentHashMap.newKeySet();
        when(targetAgentResolver.resolveAgentType("BYCLAW_DSH", null, null, "u1")).thenAnswer(invocation -> {
            seen.add(com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.get().enterpriseId());
            entered.countDown(); release.await(5, TimeUnit.SECONDS); return "BYCLAW_DSH_SHARED_context";
        });
        try {
            for (long enterprise : new long[] {10L, 20L}) {
                com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.set(
                    new com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext(1, enterprise, "MEMBER"));
                assertThatThrownBy(() -> bounded.resolveTarget("u1", null, "BYCLAW_DSH", null, bounded.startupDeadline()))
                    .isInstanceOf(IllegalStateException.class);
            }
            assertThat(entered.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(seen).containsExactlyInAnyOrder(10L, 20L);
        }
        finally { release.countDown(); com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder.clear(); }
    }

    @Test
    void workerAlreadyOnlineWhenLaunchReturnsNeedsNoAdditionalWait() {
        WorkerRouteReadinessService bounded = new WorkerRouteReadinessService(workerRegistry, sandboxService, targetAgentResolver, 1000);
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        java.util.concurrent.atomic.AtomicBoolean online = new java.util.concurrent.atomic.AtomicBoolean();
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true)).thenAnswer(invocation ->
            new WorkerRegistry.OnlineAgentCheckResult(online.get(), Collections.emptyList()));
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenAnswer(invocation -> { Thread.sleep(30); online.set(true); return new SandboxLaunchData(); });

        bounded.ensureReady("u1", null, "BYCLAW_EXE_u1", null);

        verify(sandboxService, never()).waitWorkerReadySync(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong());
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({
        "BYCLAW_SANDBOX_STARTUP_TIMEOUT_MS=250,250",
        "byclaw.gateway.worker-readiness-timeout-ms=125,125"
    })
    void configuredStartupBudgetIsUsedForTheRemainingWorkerWait(String property, long budget) {
        when(targetAgentResolver.isUserSandboxAgentType("BYCLAW_EXE_u1", "u1")).thenReturn(true);
        when(workerRegistry.hasOnlineAgentType("BYCLAW_EXE_u1", true))
            .thenReturn(new WorkerRegistry.OnlineAgentCheckResult(false, Collections.emptyList()));
        when(sandboxService.launchSandboxForTargetWithoutWait("u1", null, "BYCLAW_EXE_u1"))
            .thenReturn(new SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyLong()))
            .thenReturn(true);
        new org.springframework.boot.test.context.runner.ApplicationContextRunner()
            .withPropertyValues(property)
            .withInitializer(context -> {
                context.getBeanFactory().registerSingleton("workerRegistry", workerRegistry);
                context.getBeanFactory().registerSingleton("sandboxService", sandboxService);
                context.getBeanFactory().registerSingleton("targetAgentResolver", targetAgentResolver);
            })
            .withBean(WorkerRouteReadinessService.class)
            .run(context -> context.getBean(WorkerRouteReadinessService.class)
                .ensureReady("u1", null, "BYCLAW_EXE_u1", null));

        verify(sandboxService).waitWorkerReadySync(org.mockito.ArgumentMatchers.eq("BYCLAW_EXE_u1"),
            org.mockito.ArgumentMatchers.longThat(value -> value > 0 && value <= budget));
    }

}
