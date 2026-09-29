package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

class TenantDbProvisioningServiceTest {

    private static final String SANDBOX_ID = "803cfd04-ca9f-44f5-b2e1-85d8afeae0b2";

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

    @Test
    void dockerProxyEndpointUsesDatabaseContainerAddress() {
        TenantDbProvisioningService.HostPort endpoint = TenantDbProvisioningService.parseEndpoint(
            "tcp://192.168.0.83:57571/proxy/5432", SANDBOX_ID);

        assertEquals("sandbox-" + SANDBOX_ID, endpoint.host());
        assertEquals(5432, endpoint.port());
    }

    @Test
    void directTcpEndpointKeepsItsHostAndPort() {
        TenantDbProvisioningService.HostPort endpoint = TenantDbProvisioningService.parseEndpoint(
            "tcp://db.internal:15432", SANDBOX_ID);

        assertEquals("db.internal", endpoint.host());
        assertEquals(15432, endpoint.port());
    }

    @Test
    void unexpectedEndpointPathIsRejected() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> TenantDbProvisioningService.parseEndpoint(
                "tcp://192.168.0.83:57571/other/5432", SANDBOX_ID));
        assertTrue(error.getMessage().contains("unsupported path"));
    }
}
