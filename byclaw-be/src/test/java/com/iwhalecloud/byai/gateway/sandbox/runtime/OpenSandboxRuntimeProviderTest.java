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
    void persistedCorrelationSurvivesProviderRuntimeMetadata() {
        var client = mock(OpenSandboxClient.class);
        var provider = new OpenSandboxRuntimeProvider(client);
        var request = com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest.builder()
            .metadata(Map.of("providerRequestKey", "command-41:NODE_CREATE", "ownerScope", "TENANT"))
            .build();
        var response = new com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxResponse();
        response.setId("sandbox-41");
        when(client.createSandbox(request, "existing-idempotency-key")).thenReturn(response);
        provider.create(request, new com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec(),
            "tenant-node-12", "tenant-data-node", "existing-idempotency-key");
        var sent = org.mockito.ArgumentCaptor.forClass(com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest.class);
        verify(client).createSandbox(sent.capture(), org.mockito.ArgumentMatchers.eq("existing-idempotency-key"));
        org.assertj.core.api.Assertions.assertThat(sent.getValue().getMetadata())
            .containsEntry("providerRequestKey", "command-41:NODE_CREATE")
            .containsEntry("ownerScope", "TENANT");
    }

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
