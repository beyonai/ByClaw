package com.iwhalecloud.byai.gateway.sandbox.platform;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PlatformTenantFileRoutingTest {
    @Test void tenantPurgeRequiresPositiveAcknowledgementAndUsesOwnerIdentity() {
        var gateway = mock(PlatformRemoteGateway.class);
        when(gateway.params(any(Object[].class))).thenCallRealMethod();
        var payload = Map.of("type", "TENANT", "tenant", "42", "id", "42");
        when(gateway.call("storage", "nas/purge-contents", payload)).thenReturn(false, true);
        var routing = new PlatformTenantFileRouting(gateway);
        assertThrows(ResponseStatusException.class, () -> routing.purgeTenant(42L));
        assertDoesNotThrow(() -> routing.purgeTenant(42L));
        assertThrows(IllegalArgumentException.class, () -> routing.purgeTenant(-1L));
        verify(gateway, times(2)).call("storage", "nas/purge-contents", payload);
    }
}
