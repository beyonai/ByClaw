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
