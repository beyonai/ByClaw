package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

class TenantDbProvisioningServiceTest {

    @Test
    void retriesTransientDatabaseStartupFailure() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        TenantDbProvisioningService.retryConnectionProbe(() -> {
            if (calls.incrementAndGet() < 3) throw new IllegalStateException("starting");
        }, 4, 0);
        assertEquals(3, calls.get());
    }

    @Test
    void retainsLastFailureWithoutSleepingAfterFinalAttempt() {
        AtomicInteger calls = new AtomicInteger();
        IllegalStateException cause = new IllegalStateException("not ready");
        IllegalStateException result = assertThrows(IllegalStateException.class,
            () -> TenantDbProvisioningService.retryConnectionProbe(() -> {
                calls.incrementAndGet();
                throw cause;
            }, 3, 0));
        assertEquals(3, calls.get());
        assertSame(cause, result.getCause());
    }
}
