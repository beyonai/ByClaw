package com.iwhalecloud.byai.gateway.sandbox.client;

import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Verify authoritative remote inventory and prohibit cross-provider fallback. @author Codex @since 2026-10-28 */
class RemoteRecoveryInventoryTest {
    private final PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
    private final OpenSandboxClient client = new OpenSandboxClient(new SandboxProperties());
    private final Map<String, String> filter = Map.of("enterpriseId", "7");

    /** Bind the execution-side gateway without consulting BE provider configuration. */
    @BeforeEach
    @SuppressWarnings("unchecked")
    void configure() {
        ObjectProvider<PlatformRemoteGateway> gateways = mock(ObjectProvider.class);
        when(gateways.getIfAvailable()).thenReturn(gateway); when(gateway.isRemote()).thenReturn(true);
        ReflectionTestUtils.setField(client, "platformGateway", gateways);
    }

    /** ACS ownership metadata survives conversion to the existing tenant inspector model. */
    @Test void activeProviderEvidenceUsesTheOriginalCommandAndRecord() {
        when(gateway.call("sandbox", "runtime/recovery-inventory", filter)).thenReturn(Map.of("provider", "aliyunAgentSandbox",
                "complete", true, "items", List.of(Map.of("sandboxId", "ns--db", "state", "Running", "metadata",
                        Map.of("enterpriseId", "7", "ownerScope", "TENANT", "serviceKey", "tenant-opengauss",
                                "providerRequestKey", "command-6:DB_CREATE", "recordId", "8")))));
        var resources = client.recoveryInventory(filter);
        assertEquals("ns--db", resources.getFirst().getId());
        assertEquals("command-6:DB_CREATE", resources.getFirst().getMetadata().get("providerRequestKey"));
        assertEquals("Running", resources.getFirst().getStatus().getState());
    }

    /** Only the explicit complete contract may prove zero resources. */
    @Test void degradedManagementResponsesNeverCountAsAbsence() {
        when(gateway.call("sandbox", "runtime/recovery-inventory", filter)).thenReturn(
                Map.of("provider", "opensandbox", "available", false, "page", Map.of("items", List.of(), "hasNext", false)));
        assertEquals("PROVIDER_QUERY_INCOMPLETE", assertThrows(OpenSandboxClient.OpenSandboxException.class,
                () -> client.recoveryInventory(filter)).getMessage());
        when(gateway.call("sandbox", "runtime/recovery-inventory", filter)).thenReturn(
                Map.of("provider", "opensandbox", "complete", true, "items", List.of()));
        assertEquals(0, client.recoveryInventory(filter).size());
    }

    /** Remote outage and unsupported providers remain blocking results, never a local lookup. */
    @Test void remoteFailureDoesNotFallbackOrCreateResources() {
        when(gateway.call("sandbox", "runtime/recovery-inventory", filter)).thenThrow(new IllegalStateException("unavailable"));
        assertEquals("PROVIDER_QUERY_FAILED", assertThrows(OpenSandboxClient.OpenSandboxException.class,
                () -> client.recoveryInventory(filter)).getMessage());
        doReturn(Map.of("provider", "unknown", "complete", false, "reasonCode", "PROVIDER_RECOVERY_QUERY_UNSUPPORTED"))
                .when(gateway).call("sandbox", "runtime/recovery-inventory", filter);
        assertEquals("PROVIDER_RECOVERY_QUERY_UNSUPPORTED", assertThrows(OpenSandboxClient.OpenSandboxException.class,
                () -> client.recoveryInventory(filter)).getMessage());
        verify(gateway, never()).call(anyString(), org.mockito.ArgumentMatchers.eq("opensandbox/detail"), any());
    }

    /** Responses from another enterprise cannot participate in original-command recovery. */
    @Test void mismatchedTenantIdentityFailsClosed() {
        when(gateway.call("sandbox", "runtime/recovery-inventory", filter)).thenReturn(
                Map.of("provider", "aliyunAgentSandbox", "complete", true, "items",
                        List.of(Map.of("sandboxId", "ns--db", "metadata", Map.of("enterpriseId", "8")))));
        assertEquals("PROVIDER_QUERY_INVALID", assertThrows(OpenSandboxClient.OpenSandboxException.class,
                () -> client.recoveryInventory(filter)).getMessage());
    }
}
