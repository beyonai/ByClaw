package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.ArrayDeque;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;

class SandboxLoginAutoStartServiceTest {

    @Test
    void trigger_preparesUserSpaceEvenWithoutAutoStartSpecs() {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        com.iwhalecloud.byai.manager.application.service.user.UserBucketProvisioningService spaces =
            mock(com.iwhalecloud.byai.manager.application.service.user.UserBucketProvisioningService.class);
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of());
        new SandboxLoginAutoStartService(mapper, sandboxService, Runnable::run, spaces).trigger("user001");
        org.mockito.InOrder order = org.mockito.Mockito.inOrder(spaces, mapper);
        order.verify(spaces).ensureUserBucketQuietly("user001");
        order.verify(mapper).selectAutoStartSpecs();
        org.mockito.Mockito.verifyNoInteractions(sandboxService);
    }

    @Test
    void trigger_startsDistinctEnabledSpecsAndContinuesAfterFailure() {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxLoginAutoStartService service = new SandboxLoginAutoStartService(mapper, sandboxService,
            Runnable::run);

        when(mapper.selectAutoStartSpecs()).thenReturn(List.of(
            spec("openclaw"),
            spec("openclaw"),
            spec("byclaw-dsh"),
            spec(" ")
        ));
        doThrow(new IllegalStateException("launch failed"))
            .when(sandboxService).launchSandboxWithServiceKey("user001", "openclaw");

        service.trigger("user001");

        verify(sandboxService).launchSandboxWithServiceKey("user001", "openclaw");
        verify(sandboxService).launchSandboxWithServiceKey("user001", "byclaw-dsh");
        verify(sandboxService, never()).launchSandboxWithServiceKey("user001", " ");
    }

    @Test
    void trigger_skipsManagedFileComputeSpecsWithoutDependingOnServiceName() {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxServiceSpecEntity files = spec("custom-file-compute");
        files.setSpecJson("{\"runtimeOptions\":{\"fileService\":{\"mountDir\":\"/mnt/files\"}}}");
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of(files, spec("byclaw-dsh")));
        SandboxLoginAutoStartService service = new SandboxLoginAutoStartService(mapper, sandboxService, Runnable::run);
        try {
            service.trigger("user001");
            verify(sandboxService, never()).launchSandboxWithServiceKey("user001", "custom-file-compute");
            verify(sandboxService).launchSandboxWithServiceKey("user001", "byclaw-dsh");
        }
        finally {
            service.shutdown();
        }
    }

    @Test
    void trigger_coalescesConcurrentRequestsForSameUser() {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        QueuedExecutor executor = new QueuedExecutor();
        SandboxLoginAutoStartService service = new SandboxLoginAutoStartService(mapper, sandboxService, executor);
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of());

        service.trigger("user001");
        service.trigger("user001");

        org.assertj.core.api.Assertions.assertThat(executor.size()).isEqualTo(1);

        executor.runNext();
        service.trigger("user001");

        org.assertj.core.api.Assertions.assertThat(executor.size()).isEqualTo(1);
    }

    @Test
    void trigger_ignoresBlankUserCode() {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        QueuedExecutor executor = new QueuedExecutor();
        SandboxLoginAutoStartService service = new SandboxLoginAutoStartService(mapper, sandboxService, executor);

        service.trigger(" ");

        org.assertj.core.api.Assertions.assertThat(executor.size()).isZero();
        verify(mapper, never()).selectAutoStartSpecs();
    }

    @Test
    void trigger_propagatesLoginContextToReusedAsyncThread() throws Exception {
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        ExecutorService executor = Executors.newSingleThreadExecutor();
        executor.submit(() -> { }).get(2, TimeUnit.SECONDS);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setSessionId("session-001");
        CurrentUserHolder.setLoginInfo(loginInfo);

        CountDownLatch launched = new CountDownLatch(1);
        AtomicReference<String> observedSessionId = new AtomicReference<>();
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of(spec("byclaw-dsh")));
        doAnswer(invocation -> {
            observedSessionId.set(CurrentUserHolder.getSessionId());
            launched.countDown();
            return null;
        }).when(sandboxService).launchSandboxWithServiceKey("user001", "byclaw-dsh");

        try {
            SandboxLoginAutoStartService service = new SandboxLoginAutoStartService(mapper, sandboxService, executor);
            service.trigger("user001");

            org.assertj.core.api.Assertions.assertThat(launched.await(2, TimeUnit.SECONDS)).isTrue();
            org.assertj.core.api.Assertions.assertThat(observedSessionId.get()).isEqualTo("session-001");
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
            executor.shutdownNow();
        }
    }

    @Test
    void pendingQuota_retriesWithoutNewLoginAndCoalescesWhileWaiting() {
        var mapper = mock(SandboxServiceSpecEntityMapper.class);
        var sandbox = mock(SandboxService.class);
        var timer = mock(java.util.concurrent.ScheduledExecutorService.class);
        Queue<Runnable> retries = new ArrayDeque<>();
        doAnswer(call -> { retries.add(call.getArgument(0)); return null; })
            .when(timer).schedule(org.mockito.ArgumentMatchers.any(Runnable.class),
                org.mockito.ArgumentMatchers.eq(15L), org.mockito.ArgumentMatchers.eq(TimeUnit.SECONDS));
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of(spec("openclaw"), spec("byclaw-dsh")));
        var launches = new java.util.concurrent.atomic.AtomicInteger();
        doAnswer(call -> {
            if (launches.getAndIncrement() == 0) {
                throw new com.iwhalecloud.byai.state.common.exception.StoragePreparingException();
            }
            if (launches.get() == 2) {
                org.assertj.core.api.Assertions.assertThat(CurrentUserHolder.getSessionId()).isEqualTo("login-context");
            }
            return null;
        }).when(sandbox).launchSandboxWithServiceKey("user001", "byclaw-dsh");
        var service = new SandboxLoginAutoStartService(mapper, sandbox, Runnable::run, timer);
        LoginInfo login = new LoginInfo();
        login.setSessionId("login-context");
        CurrentUserHolder.setLoginInfo(login);
        try {
            service.trigger("user001");
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
        }
        service.trigger("user001");
        org.assertj.core.api.Assertions.assertThat(retries).hasSize(1);
        verify(mapper).selectAutoStartSpecs();
        retries.remove().run();
        verify(sandbox, org.mockito.Mockito.times(2)).launchSandboxWithServiceKey("user001", "byclaw-dsh");
        verify(sandbox).launchSandboxWithServiceKey("user001", "openclaw");
        org.assertj.core.api.Assertions.assertThat(retries).isEmpty();
        service.trigger("user001");
        verify(mapper, org.mockito.Mockito.times(2)).selectAutoStartSpecs();
    }

    @Test
    void permanentStorageFailure_doesNotRetry() {
        var mapper = mock(SandboxServiceSpecEntityMapper.class);
        var sandbox = mock(SandboxService.class);
        var timer = mock(java.util.concurrent.ScheduledExecutorService.class);
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of(spec("byclaw-dsh")));
        doThrow(new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException("NAS_MIGRATION_REQUIRED"))
            .when(sandbox).launchSandboxWithServiceKey("user001", "byclaw-dsh");
        new SandboxLoginAutoStartService(mapper, sandbox, Runnable::run, timer).trigger("user001");
        org.mockito.Mockito.verifyNoInteractions(timer);
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {
        "SHARED_USER_NAS_WAITING_QUOTA", "SHARED_USER_NAS_PREPARING_STORAGE", "NAS_SPACE_NOT_READY"
    })
    void temporaryStates_areBoundedAndCancelledRetriesDoNotAffectNewLogin(String state) {
        var mapper = mock(SandboxServiceSpecEntityMapper.class);
        var sandbox = mock(SandboxService.class);
        var timer = mock(java.util.concurrent.ScheduledExecutorService.class);
        Queue<Runnable> retries = new ArrayDeque<>();
        doAnswer(call -> { retries.add(call.getArgument(0)); return null; })
            .when(timer).schedule(org.mockito.ArgumentMatchers.any(Runnable.class),
                org.mockito.ArgumentMatchers.eq(15L), org.mockito.ArgumentMatchers.eq(TimeUnit.SECONDS));
        when(mapper.selectAutoStartSpecs()).thenReturn(List.of(spec("byclaw-dsh")));
        var failure = new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException("preparing");
        failure.setErrorService(state);
        doThrow(failure).when(sandbox).launchSandboxWithServiceKey("user001", "byclaw-dsh");
        var service = new SandboxLoginAutoStartService(mapper, sandbox, Runnable::run, timer);
        service.trigger("user001");
        Runnable stale = retries.remove();
        service.cancel("user001");
        service.trigger("user001");
        stale.run();
        service.trigger("user001");
        verify(mapper, org.mockito.Mockito.times(2)).selectAutoStartSpecs();
        int count = 0;
        while (!retries.isEmpty() && count < 100) { retries.remove().run(); count++; }
        org.assertj.core.api.Assertions.assertThat(count).isEqualTo(80);
        org.assertj.core.api.Assertions.assertThat(retries).isEmpty();
        service.trigger("user001");
        verify(mapper, org.mockito.Mockito.times(3)).selectAutoStartSpecs();
    }

    private static SandboxServiceSpecEntity spec(String serviceKey) {
        SandboxServiceSpecEntity entity = new SandboxServiceSpecEntity();
        entity.setServiceKey(serviceKey);
        entity.setEnabled(1);
        return entity;
    }

    private static final class QueuedExecutor implements Executor {

        private final Queue<Runnable> tasks = new ArrayDeque<>();

        @Override
        public void execute(Runnable command) {
            tasks.add(command);
        }

        int size() {
            return tasks.size();
        }

        void runNext() {
            tasks.remove().run();
        }
    }
}
