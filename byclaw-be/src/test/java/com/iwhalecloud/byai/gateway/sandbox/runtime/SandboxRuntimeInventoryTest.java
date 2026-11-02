package com.iwhalecloud.byai.gateway.sandbox.runtime;

import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SandboxRuntimeInventoryTest {
    @Test void remoteInventoryUsesOnlyTheSelectedEngineAndFollowsPagination() {
        PlatformRemoteGateway remote = mock(PlatformRemoteGateway.class);
        SandboxRuntimeProvider legacy = mock(SandboxRuntimeProvider.class);
        when(remote.isRemote()).thenReturn(true);
        when(remote.call(eq("sandbox"), eq("runtime/list"), any())).thenReturn(
            Map.of("provider", "aliyunAgentSandbox", "page", Map.of("items", List.of(
                Map.of("sandboxId", "acs-1", "state", "Running")), "hasNext", true)),
            Map.of("provider", "aliyunAgentSandbox", "page", Map.of("items", List.of(
                Map.of("sandboxId", "acs-2", "state", "Pending")), "hasNext", false)));
        SandboxRuntimeInventory inventory = inventory(remote, legacy);
        assertThat(inventory.current()).containsAllEntriesOf(Map.of("acs-1", "RUNNING", "acs-2", "STARTING"));
        verify(remote).call("sandbox", "runtime/list", Map.of("pageNo", 2, "pageSize", 500));
        verifyNoInteractions(legacy);
    }

    @Test void remoteFailureReturnsAnEmptyInventoryWithoutFallback() {
        PlatformRemoteGateway remote = mock(PlatformRemoteGateway.class);
        SandboxRuntimeProvider legacy = mock(SandboxRuntimeProvider.class);
        when(remote.isRemote()).thenReturn(true);
        when(remote.call(eq("sandbox"), eq("runtime/list"), any())).thenThrow(new IllegalStateException("unavailable"));
        assertThat(inventory(remote, legacy).current()).isEmpty();
        verifyNoInteractions(legacy);
    }

    @Test void aLaterUnavailablePageDiscardsEarlierResults() {
        PlatformRemoteGateway remote = mock(PlatformRemoteGateway.class);
        SandboxRuntimeProvider legacy = mock(SandboxRuntimeProvider.class);
        when(remote.isRemote()).thenReturn(true);
        when(remote.call(eq("sandbox"), eq("runtime/list"), any())).thenReturn(
            Map.of("provider", "aliyunAgentSandbox", "page", Map.of("items", List.of(
                Map.of("sandboxId", "acs-1", "state", "Running")), "hasNext", true)),
            Map.of("provider", "aliyunAgentSandbox", "available", false));
        assertThat(inventory(remote, legacy).current()).isEmpty();
        verifyNoInteractions(legacy);
    }

    @Test void legacyModeReadsTheSelectedLocalRuntime() {
        SandboxRuntimeProvider local = mock(SandboxRuntimeProvider.class);
        when(local.listSandboxesByMetadata(Map.of(), 1, 500)).thenReturn(SandboxRuntimePage.<SandboxRuntimeInstance>builder()
            .items(List.of(SandboxRuntimeInstance.builder().sandboxId("legacy-id").state("Running").build()))
            .hasNext(false).build());
        assertThat(inventory(null, local).current()).containsExactlyEntriesOf(Map.of("legacy-id", "RUNNING"));
    }

    private SandboxRuntimeInventory inventory(PlatformRemoteGateway gateway, SandboxRuntimeProvider runtime) {
        var beans = new DefaultListableBeanFactory();
        if (gateway != null) beans.registerSingleton("gateway", gateway);
        beans.registerSingleton("runtime", runtime);
        return new SandboxRuntimeInventory(beans.getBeanProvider(PlatformRemoteGateway.class),
            beans.getBeanProvider(SandboxRuntimeProvider.class));
    }
}
