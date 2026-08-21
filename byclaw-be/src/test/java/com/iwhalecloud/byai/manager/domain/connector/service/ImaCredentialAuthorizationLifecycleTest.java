package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationQrCodeEncoder;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialFormProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialFormVerification;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.dto.connector.StartConnectorAuthorizationRequest;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorAuthMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

class ImaCredentialAuthorizationLifecycleTest {

    @Test
    void akSkAuthorizationRejectsBusyAdmissionWithoutInvokingCliVerifier() {
        ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
        ConnectorCredentialFormProvider formProvider = mock(ConnectorCredentialFormProvider.class);
        ConnectorCredentialFormProviderRegistry formProviders = mock(ConnectorCredentialFormProviderRegistry.class);
        ConnectorInfo connector = connector();
        when(connectorInfoService.findById(9L)).thenReturn(connector);
        when(formProviders.get("ima-openapi")).thenReturn(formProvider);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        when(sessions.tryAcquireStartLock(eq("1001"), eq(9L), any())).thenReturn(Optional.of("lock"));
        ConnectorCredentialVerificationGuard guard = new ConnectorCredentialVerificationGuard(
            new ConnectorSkillAuthorizationSyncProperties(1, 0));
        ConnectorAuthorizationService service = new ConnectorAuthorizationService(
            connectorInfoService, mock(AuthorizationProviderRegistry.class), sessions,
            mock(ConnectorAuthMapper.class), mock(SequenceService.class), mock(ConnectorConnectionStateService.class),
            new AuthorizationQrCodeEncoder(), null, formProviders, guard);
        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(9L);
        request.setCredentials(Map.of("clientId", "client", "apiKey", "key"));

        try (ConnectorCredentialVerificationGuard.Admission ignored = guard.acquire(1001L, "ima-openapi")) {
            var result = service.start(request, "1001");

            assertThat(result.getStatus()).isEqualTo("failed");
            assertThat(result.getErrorCode()).isEqualTo("CONNECTOR_VERIFICATION_BUSY");
            assertThat(result.getErrorMessage()).doesNotContain("client", "key");
            verifyNoInteractions(formProvider);
        }
    }

    @Test
    void akSkAuthorizationVerifiesSynchronouslyWithoutSessionOrSecretEcho() {
        ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
        AuthorizationProviderRegistry authorizationProviders = mock(AuthorizationProviderRegistry.class);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialFormProvider formProvider = mock(ConnectorCredentialFormProvider.class);
        ConnectorCredentialFormProviderRegistry formProviders = mock(ConnectorCredentialFormProviderRegistry.class);
        ConnectorInfo connector = connector();
        when(connectorInfoService.findById(9L)).thenReturn(connector);
        when(formProviders.get("ima-openapi")).thenReturn(formProvider);
        when(sessions.tryAcquireStartLock(eq("1001"), eq(9L), any())).thenReturn(Optional.of("lock"));
        when(formProvider.verify(eq("1001"), eq(connector), any())).thenReturn(new CredentialFormVerification(
            AuthorizationStatusResult.connected(null, "IMA", CredentialState.READY, CredentialRenewalMode.NONE,
                null, null, null, null),
            Map.of("IMA_OPENAPI_CLIENTID", "client-id", "IMA_OPENAPI_APIKEY", "api-key")
        ));
        ConnectorAuthorizationService service = new ConnectorAuthorizationService(
            connectorInfoService, authorizationProviders, sessions, mock(ConnectorAuthMapper.class), mock(SequenceService.class),
            stateService, new AuthorizationQrCodeEncoder(), null, formProviders
        );
        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(9L);
        request.setCredentials(Map.of("clientId", "client-id", "apiKey", "api-key"));

        var result = service.start(request, "1001");

        assertThat(result.getStatus()).isEqualTo("connected");
        assertThat(result.getAuthorizationUrl()).isNull();
        assertThat(result.getQrCodeUrl()).isNull();
        verify(stateService).saveEnabledCredentialAuthorization(
            eq("1001"), eq(connector), any(), any(), any());
        verify(sessions).tryAcquireStartLock(eq("1001"), eq(9L), any());
        verify(sessions).releaseStartLock("1001", 9L, "lock");
        verify(sessions, never()).create(any());
    }

    @Test
    void akSkVerificationFailureDoesNotPersistOrTouchRedis() {
        ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialFormProvider formProvider = mock(ConnectorCredentialFormProvider.class);
        ConnectorCredentialFormProviderRegistry formProviders = mock(ConnectorCredentialFormProviderRegistry.class);
        ConnectorInfo connector = connector();
        when(connectorInfoService.findById(9L)).thenReturn(connector);
        when(formProviders.get("ima-openapi")).thenReturn(formProvider);
        when(sessions.tryAcquireStartLock(eq("1001"), eq(9L), any())).thenReturn(Optional.of("lock"));
        when(formProvider.verify(any(), any(), any())).thenReturn(new CredentialFormVerification(
            new AuthorizationStatusResult(com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus.FAILED,
                null, null, null, null, "CONNECTOR_CREDENTIAL_INVALID", "safe"), Map.of()));
        ConnectorAuthorizationService service = new ConnectorAuthorizationService(
            connectorInfoService, mock(AuthorizationProviderRegistry.class), sessions, mock(ConnectorAuthMapper.class),
            mock(SequenceService.class), stateService, new AuthorizationQrCodeEncoder(), null, formProviders);
        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(9L);
        request.setCredentials(Map.of("clientId", "client", "apiKey", "key"));

        assertThat(service.start(request, "1001").getStatus()).isEqualTo("failed");
        org.mockito.Mockito.verifyNoInteractions(stateService);
        verify(sessions).releaseStartLock("1001", 9L, "lock");
    }

    @Test
    void akSkSuccessfulCallsCreateDistinctIdsAndBindingFailureNeverCreatesSession() {
        ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
        RedisAuthorizationSessionRepository sessions = mock(RedisAuthorizationSessionRepository.class);
        ConnectorConnectionStateService stateService = mock(ConnectorConnectionStateService.class);
        ConnectorCredentialFormProvider formProvider = mock(ConnectorCredentialFormProvider.class);
        ConnectorCredentialFormProviderRegistry formProviders = mock(ConnectorCredentialFormProviderRegistry.class);
        ConnectorInfo connector = connector();
        when(connectorInfoService.findById(9L)).thenReturn(connector);
        when(formProviders.get("ima-openapi")).thenReturn(formProvider);
        when(sessions.tryAcquireStartLock(eq("1001"), eq(9L), any())).thenReturn(Optional.of("lock"));
        when(formProvider.verify(any(), any(), any())).thenReturn(new CredentialFormVerification(
            AuthorizationStatusResult.connected(null, "IMA", CredentialState.READY, CredentialRenewalMode.NONE,
                null, null, null, null), Map.of("IMA_OPENAPI_CLIENTID", "client", "IMA_OPENAPI_APIKEY", "key")));
        ConnectorAuthorizationService service = new ConnectorAuthorizationService(
            connectorInfoService, mock(AuthorizationProviderRegistry.class), sessions, mock(ConnectorAuthMapper.class),
            mock(SequenceService.class), stateService, new AuthorizationQrCodeEncoder(), null, formProviders);
        StartConnectorAuthorizationRequest request = new StartConnectorAuthorizationRequest();
        request.setConnectorId(9L); request.setCredentials(Map.of("clientId", "client", "apiKey", "key"));
        var first = service.start(request, "1001");
        var second = service.start(request, "1001");
        assertThat(first.getAuthorizationId()).isNotBlank().isNotEqualTo(second.getAuthorizationId());
        assertThat(first.getAuthorizationUrl()).isNull(); assertThat(first.getQrCodeUrl()).isNull();
        org.mockito.Mockito.doThrow(new IllegalStateException("save failed")).when(stateService)
            .saveEnabledCredentialAuthorization(any(), any(), any(), any(), any());
        assertThat(service.start(request, "1001").getStatus()).isEqualTo("failed");
        verify(sessions, never()).create(any());
    }

    private ConnectorInfo connector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setConnectorCode("ima-openapi");
        connector.setProviderCode("ima-openapi");
        connector.setAuthMode("AK_SK");
        connector.setStatusCd("00A");
        return connector;
    }
}
