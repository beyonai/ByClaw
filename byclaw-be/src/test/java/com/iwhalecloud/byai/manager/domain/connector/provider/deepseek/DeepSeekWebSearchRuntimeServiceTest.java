package com.iwhalecloud.byai.manager.domain.connector.provider.deepseek;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;

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
import java.util.Date;
import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.fasterxml.jackson.databind.ObjectMapper;

class DeepSeekWebSearchRuntimeServiceTest extends I18nTestSupport {
    @org.junit.jupiter.api.BeforeEach
    void useEnglishMessages() {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
    }


    private final ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
    private final ConnectorConnectionStateService connectionStateService = mock(ConnectorConnectionStateService.class);
    private final ConnectorManifestService manifestService = mock(ConnectorManifestService.class);
    private final DeepSeekWebSearchClient client = mock(DeepSeekWebSearchClient.class);
    private final DeepSeekWebSearchBatchExecutor batchExecutor = mock(DeepSeekWebSearchBatchExecutor.class);
    private final ByaiSystemConfigService systemConfigService = mock(ByaiSystemConfigService.class);
    private final DeepSeekWebSearchRuntimeService service = new DeepSeekWebSearchRuntimeService(
        connectorInfoService, connectionStateService, manifestService, client, batchExecutor,
        systemConfigService, new ObjectMapper());

    @Test
    void disabledPersonalAuthorizationWithoutGlobalCredentialPromptsConfiguration() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        ConnectorAuth disabledAuthorization = new ConnectorAuth();
        disabledAuthorization.setEnableFlag("N");
        disabledAuthorization.setStatusCd("00A");
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(disabledAuthorization);

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED");

        verify(manifestService, never()).readManagedCredentials(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
        verify(client, never()).search(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void missingPersonalAndGlobalAuthorizationPromptsConfiguration() {
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
        verify(systemConfigService, never()).getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG);
    }

    @Test
    void connectorDisabledWhilePersonalSearchRunsIsNotTreatedAsCredentialFallback() {
        ConnectorInfo connector = connector();
        ConnectorInfo disabled = connector();
        disabled.setStatusCd("00X");
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE))
            .thenReturn(connector, disabled);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(enabledAuthorization());
        when(manifestService.readManagedCredentials(42L, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS))
            .thenReturn(Map.of(DeepSeekWebSearchCredentialFormProvider.API_KEY, "secret"));
        when(client.search(connector, "secret", "latest news", 5))
            .thenReturn(new DeepSeekWebSearchResult(List.of(), false));

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_ENABLED");
        verify(systemConfigService, never()).getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG);
    }

    @Test
    void disabledPersonalAuthorizationFallsBackToGlobalCredential() {
        ConnectorInfo connector = connector();
        ConnectorAuth authorization = enabledAuthorization();
        authorization.setEnableFlag("N");
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(authorization);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\" global-secret \"}");
        DeepSeekWebSearchResult expected = new DeepSeekWebSearchResult(List.of(), false);
        when(client.search(connector, "global-secret", "latest news", 5)).thenReturn(expected);

        assertThat(service.search(42L, "latest news", 5)).isEqualTo(expected);

        verify(manifestService, never()).readManagedCredentials(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void expiredPersonalAuthorizationFallsBackToGlobalCredential() {
        ConnectorInfo connector = connector();
        ConnectorAuth authorization = enabledAuthorization();
        authorization.setExpireTime(new Date(System.currentTimeMillis() - 1_000));
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(authorization);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\"global-secret\"}");
        DeepSeekWebSearchResult expected = new DeepSeekWebSearchResult(List.of(), false);
        when(client.search(connector, "global-secret", "latest news", 5)).thenReturn(expected);

        assertThat(service.search(42L, "latest news", 5)).isEqualTo(expected);
    }

    @Test
    void invalidPersonalCredentialRetriesWithGlobalCredential() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(enabledAuthorization());
        when(manifestService.readManagedCredentials(42L, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS))
            .thenReturn(Map.of(DeepSeekWebSearchCredentialFormProvider.API_KEY, "personal-secret"));
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\"global-secret\"}");
        when(client.search(connector, "personal-secret", "latest news", 5))
            .thenThrow(new DeepSeekWebSearchException("CONNECTOR_CREDENTIAL_INVALID", "expired"));
        DeepSeekWebSearchResult expected = new DeepSeekWebSearchResult(List.of(), false);
        when(client.search(connector, "global-secret", "latest news", 5)).thenReturn(expected);

        assertThat(service.search(42L, "latest news", 5)).isEqualTo(expected);
    }

    @Test
    void unavailableEnabledPersonalCredentialRetriesWithGlobalCredential() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(enabledAuthorization());
        when(manifestService.readManagedCredentials(42L, connector, DeepSeekWebSearchCredentialFormProvider.MANAGED_KEYS))
            .thenReturn(Map.of(DeepSeekWebSearchCredentialFormProvider.API_KEY, "personal-secret"));
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\"global-secret\"}");
        when(client.search(connector, "personal-secret", "latest news", 5))
            .thenThrow(new DeepSeekWebSearchException("DEEPSEEK_WEB_SEARCH_UNAVAILABLE", "provider unavailable"));
        DeepSeekWebSearchResult expected = new DeepSeekWebSearchResult(List.of(), false);
        when(client.search(connector, "global-secret", "latest news", 5)).thenReturn(expected);

        assertThat(service.search(42L, "latest news", 5)).isEqualTo(expected);
    }

    @Test
    void unavailablePersonalAndGlobalCredentialsPromptConnectorConfiguration() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(null);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG)).thenReturn("  ");

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED")
            .hasMessageContaining("connector settings");
    }

    @Test
    void unresolvedGlobalEnvironmentPlaceholderIsNotUsedAsCredential() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(null);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\"${DEEPSEEK_WEB_SEARCH_API_KEY}\"}");

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED");

        verify(client, never()).search(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt());
    }

    @Test
    void invalidGlobalCredentialPromptsConnectorConfiguration() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(null);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\"global-secret\"}");
        when(client.search(connector, "global-secret", "latest news", 5))
            .thenThrow(new DeepSeekWebSearchException("CONNECTOR_CREDENTIAL_INVALID", "expired"));

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED")
            .hasMessageContaining("connector settings");
    }

    @Test
    void unavailableGlobalCredentialPromptsConnectorConfiguration() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(null);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"deepseek-web-search\":\"global-secret\"}");
        when(client.search(connector, "global-secret", "latest news", 5))
            .thenThrow(new DeepSeekWebSearchException("DEEPSEEK_WEB_SEARCH_UNAVAILABLE", "provider unavailable"));

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED")
            .hasMessageContaining("connector settings");
    }

    @Test
    void ignoresKeysForOtherWebSearchProviders() {
        ConnectorInfo connector = connector();
        when(connectorInfoService.findByCode(DeepSeekWebSearchRuntimeService.CONNECTOR_CODE)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization("42", 100L)).thenReturn(null);
        when(systemConfigService.getDcSystemConfigValueByCode(
            DeepSeekWebSearchRuntimeService.GLOBAL_API_KEY_CONFIG))
            .thenReturn("{\"another-search\":\"other-secret\"}");

        assertThatThrownBy(() -> service.search(42L, "latest news", 5))
            .isInstanceOf(DeepSeekWebSearchException.class)
            .hasMessageContaining("CONNECTOR_NOT_AUTHORIZED");

        verify(client, never()).search(
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.anyInt());
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
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource(value = {
        "zh-CN|maxResults 必须为 1 至 20|queries 至少需要一条查询",
        "en-US|maxResults must be between 1 and 20|queries must contain at least one query"
    }, delimiter = '|')
    void invalidRequestsAreLocalizedBeforeCallingTheProvider(String language, String maximum, String query) {
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.forLanguageTag(language));
        assertThatThrownBy(() -> service.search(42L, "query", 1000))
            .isInstanceOf(IllegalArgumentException.class).hasMessage(maximum);
        assertThatThrownBy(() -> service.search(42L, List.of(), 1))
            .isInstanceOf(IllegalArgumentException.class).hasMessage(query);
        org.mockito.Mockito.verifyNoInteractions(client, batchExecutor, connectorInfoService);
    }

}
