package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorInfoService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorManifestService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class DeepSeekWebSearchRuntimeServiceTest {

    private final ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
    private final ConnectorConnectionStateService connectionStateService = mock(ConnectorConnectionStateService.class);
    private final ConnectorManifestService manifestService = mock(ConnectorManifestService.class);
    private final DeepSeekWebSearchClient client = mock(DeepSeekWebSearchClient.class);
    private final DeepSeekWebSearchBatchExecutor batchExecutor = mock(DeepSeekWebSearchBatchExecutor.class);
    private final DeepSeekWebSearchRuntimeService service = new DeepSeekWebSearchRuntimeService(
        connectorInfoService, connectionStateService, manifestService, client, batchExecutor);

    @Test
    void disabledConnectorCannotReadOrUseCredential() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        ConnectorAuth disabledAuthorization = new ConnectorAuth();
        disabledAuthorization.setEnableFlag("N");
        disabledAuthorization.setStatusCd("00A");
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(disabledAuthorization);

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_ENABLED");

        verify(manifestService, never()).readManagedCredentials(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        verify(client, never()).search(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void revokedOrMissingAuthorizationIsReportedSeparatelyFromDisabled() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(null);

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED");

        verify(manifestService, never()).readManagedCredentials(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void enabledConnectorUsesOnlyCurrentUsersManagedCredential() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(enabledAuthorization());
        when(manifestService.readManagedCredentials(42L, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS))
            .thenReturn(Map.of(DeepSeekWebSearchCredentialFormProvider.API_KEY, "secret"));
        DeepSeekWebSearchResult expected = new DeepSeekWebSearchResult(
            List.of(new DeepSeekWebSearchResult.Source("https://example.com", "title", null, null)), false);
        when(client.search(connector, "secret", "latest news", 5)).thenReturn(expected);

        assertThat(service.search(42L, "latest news", 5)).isEqualTo(expected);
    }

    @Test
    void batchSearchDeduplicatesQueriesBeforeExecution() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(enabledAuthorization());
        when(manifestService.readManagedCredentials(42L, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS))
            .thenReturn(Map.of(DeepSeekWebSearchCredentialFormProvider.API_KEY, "secret"));
        DeepSeekWebSearchResult expected = new DeepSeekWebSearchResult(List.of(), false);
        when(batchExecutor.search(connector, "secret", List.of("one", "two"), 5)).thenReturn(expected);

        assertThat(service.search(42L, List.of("one", "one", " two "), 5)).isEqualTo(expected);
    }

    @Test
    void batchSearchRejectsMoreThanFourQueries() {
        assertThatThrownBy(() -> service.search(42L, List.of("1", "2", "3", "4", "5"), 5))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("at most 4");
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(100L);
        connector.setConnectorCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE);
        connector.setStatusCd("00A");
        return connector;
    }

    private ConnectorAuth enabledAuthorization() {
        ConnectorAuth authorization = new ConnectorAuth();
        authorization.setEnableFlag("Y");
        authorization.setStatusCd("00A");
        return authorization;
    }
}
