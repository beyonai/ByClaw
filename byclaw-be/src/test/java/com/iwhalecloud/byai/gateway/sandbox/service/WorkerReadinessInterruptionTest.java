package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class WorkerReadinessInterruptionTest {
    @Test
    void interruptingReadinessSleepExitsPromptlyWithoutLosingCancellation() throws Exception {
        WorkerRegistry registry = mock(WorkerRegistry.class);
        CountDownLatch polled = new CountDownLatch(1), exited = new CountDownLatch(1);
        when(registry.hasOnlineAgentType("worker", true)).thenAnswer(invocation -> {
            polled.countDown();
            return new WorkerRegistry.OnlineAgentCheckResult(false, java.util.List.of());
        });
        SandboxService service = new SandboxService();
        ReflectionTestUtils.setField(service, "gatewayWorkerRegistry", registry);
        AtomicBoolean interrupted = new AtomicBoolean(), ready = new AtomicBoolean(true);
        Thread waiter = new Thread(() -> {
            ready.set(service.waitWorkerReadySync("worker", 5000));
            interrupted.set(Thread.currentThread().isInterrupted());
            exited.countDown();
        });
        try {
            waiter.start();
            assertThat(polled.await(2, TimeUnit.SECONDS)).isTrue();
            waiter.interrupt();
            assertThat(exited.await(1, TimeUnit.SECONDS)).isTrue();
            assertThat(ready).isFalse();
            assertThat(interrupted).isTrue();
        }
        finally { waiter.interrupt(); waiter.join(2000); }
    }
}
