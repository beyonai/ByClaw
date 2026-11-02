package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;

class ExactToolSandboxReleaseTest {
    @Test
    void blankExactIdCannotReachLegacyReleaseOrGateway() {
        SandboxService service = spy(new SandboxService());
        ObjectProvider<PlatformRemoteGateway> provider = mock(ObjectProvider.class);
        ReflectionTestUtils.setField(service, "platformGatewayProvider", provider);
        for (String exactId : new String[] { null, "", "   " }) {
            assertThatThrownBy(() -> service.removeSandbox("owner", null, "media", exactId))
                .isInstanceOf(IllegalArgumentException.class);
        }
        verifyNoInteractions(provider);
        verify(service, never()).removeSandbox("owner", null, "media");
    }

    @Test
    void exactRemoteReceiptIsReturnedWithoutTypeOnlyFallback() {
        SandboxService service = spy(new SandboxService());
        ObjectProvider<PlatformRemoteGateway> provider = mock(ObjectProvider.class);
        PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
        ReflectionTestUtils.setField(service, "platformGatewayProvider", provider);
        when(provider.getObject()).thenReturn(gateway);
        when(gateway.isRemote()).thenReturn(true);
        Map<String, Object> params = Map.of("userCode", "owner", "sandboxType", "media", "expectedSandboxId", "exact-b");
        Map<String, Object> receipt = Map.of("releaseConfirmed", true, "remoteAbsentConfirmed", true, "sandboxId", "exact-b");
        when(gateway.params(any(Object[].class))).thenReturn(params);
        when(gateway.service(eq("remove"), eq(params))).thenReturn(receipt);
        assertThat(service.removeSandbox("owner", null, "media", "exact-b")).isSameAs(receipt);
        verify(gateway).params("userCode", "owner", "resourceId", null, "sandboxType", "media", "expectedSandboxId", "exact-b");
        verify(service, never()).removeSandbox("owner", null, "media");
    }
}
