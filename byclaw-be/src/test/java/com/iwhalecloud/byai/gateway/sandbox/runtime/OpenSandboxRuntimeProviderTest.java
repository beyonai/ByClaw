package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient.OpenSandboxException;

class OpenSandboxRuntimeProviderTest {

    @Test
    void listSandboxesByMetadataPropagatesStrictListFailure() {
        OpenSandboxClient openSandboxClient = mock(OpenSandboxClient.class);
        OpenSandboxRuntimeProvider provider = new OpenSandboxRuntimeProvider(openSandboxClient);
        Map<String, String> metadata = Map.of("userCode", "user001", "serviceKey", "openclaw");
        when(openSandboxClient.listSandboxesByMetadataStrict(metadata, 1, 200))
            .thenThrow(new OpenSandboxException("HTTP 500"));

        assertThatThrownBy(() -> provider.listSandboxesByMetadata(metadata, 1, 200))
            .isInstanceOf(OpenSandboxException.class)
            .hasMessageContaining("HTTP 500");

        verify(openSandboxClient).listSandboxesByMetadataStrict(metadata, 1, 200);
    }
}
