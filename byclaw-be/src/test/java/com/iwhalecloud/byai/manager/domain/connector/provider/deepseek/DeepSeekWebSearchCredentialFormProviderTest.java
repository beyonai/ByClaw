package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DeepSeekWebSearchCredentialFormProviderTest {

    private final DeepSeekWebSearchClient client = mock(DeepSeekWebSearchClient.class);
    private final ConnectorManifestService manifestService = mock(ConnectorManifestService.class);
    private final DeepSeekWebSearchCredentialFormProvider provider =
        new DeepSeekWebSearchCredentialFormProvider(client, manifestService);
    private final ConnectorInfo connector = new ConnectorInfo();

    @Test
    void successfulVerificationReturnsBackendManagedCredential() {
        when(client.search(connector, "secret", "DeepSeek", 1)).thenReturn(
            new DeepSeekWebSearchResult(List.of(), false));

        var result = provider.verify("42", connector, Map.of("apiKey", "secret"));

        assertThat(result.status().status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.runtimeEnvironment()).containsExactly(
            Map.entry(DeepSeekWebSearchCredentialFormProvider.API_KEY, "secret"));
    }

    @Test
    void failedVerificationNeverReturnsCredentialForPersistence() {
        when(client.search(connector, "bad", "DeepSeek", 1)).thenThrow(
            new DeepSeekWebSearchException("CONNECTOR_CREDENTIAL_INVALID", "rejected"));

        var result = provider.verify("42", connector, Map.of("apiKey", "bad"));

        assertThat(result.status().status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.runtimeEnvironment()).isEmpty();
    }

    @Test
    void rejectsUnexpectedFormFields() {
        assertThatThrownBy(() -> provider.verify(
            "42", connector, Map.of("apiKey", "secret", "baseUrl", "https://evil.example")))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
