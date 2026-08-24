package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationProviderRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorAuthorizationProvider;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialRevoker;
import com.iwhalecloud.byai.manager.domain.connector.authorization.RedisAuthorizationSessionRepository;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class ConnectorAuthorizationRevocationServiceTest {

    private static final String USER_ID = "42";
    private static final Long CONNECTOR_ID = 9L;

    private ConnectorInfoService connectorInfoService;
    private RedisAuthorizationSessionRepository sessionRepository;
    private ConnectorConnectionStateService connectionStateService;
    private RevocableProvider provider;
    private ConnectorAuthorizationRevocationService service;
    private ConnectorInfo connector;

    @BeforeEach
    void setUp() {
        connectorInfoService = mock(ConnectorInfoService.class);
        sessionRepository = mock(RedisAuthorizationSessionRepository.class);
        connectionStateService = mock(ConnectorConnectionStateService.class);
        provider = mock(RevocableProvider.class);
        when(provider.providerCode()).thenReturn("wecom-cli");
        AuthorizationProviderRegistry registry = new AuthorizationProviderRegistry(List.of(provider));
        service = new ConnectorAuthorizationRevocationService(
            connectorInfoService, registry, sessionRepository, connectionStateService);

        connector = new ConnectorInfo();
        connector.setConnectorId(CONNECTOR_ID);
        connector.setProviderCode("wecom-cli");
        connector.setStatusCd("00A");
        when(connectorInfoService.findById(CONNECTOR_ID)).thenReturn(connector);
        when(connectionStateService.findActiveAuthorization(USER_ID, CONNECTOR_ID))
            .thenReturn(new ConnectorAuth());
        when(sessionRepository.tryAcquireStartLock(eq(USER_ID), eq(CONNECTOR_ID), any()))
            .thenReturn(Optional.of("lock-token"));
    }

    @Test
    void revokesCredentialBeforeSoftInvalidatingBindingAndReleasesLock() {
        service.revoke(CONNECTOR_ID, USER_ID);

        InOrder order = inOrder(provider, connectionStateService);
        order.verify(provider).revoke(USER_ID, connector);
        order.verify(connectionStateService).revokeAuthorization(USER_ID, CONNECTOR_ID);
        verify(sessionRepository).releaseStartLock(USER_ID, CONNECTOR_ID, "lock-token");
    }

    @Test
    void rejectsActiveAuthorizationWithoutClearingCredential() {
        when(sessionRepository.hasActiveSession(USER_ID, CONNECTOR_ID)).thenReturn(true);

        assertThatThrownBy(() -> service.revoke(CONNECTOR_ID, USER_ID))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("进行中");

        verify(provider, never()).revoke(any(), any());
        verify(connectionStateService, never()).revokeAuthorization(any(), any());
        verify(sessionRepository).releaseStartLock(USER_ID, CONNECTOR_ID, "lock-token");
    }

    @Test
    void keepsBindingActiveWhenCredentialCleanupFails() {
        doThrow(new IllegalStateException("cleanup failed")).when(provider).revoke(USER_ID, connector);

        assertThatThrownBy(() -> service.revoke(CONNECTOR_ID, USER_ID))
            .isInstanceOf(IllegalStateException.class)
            .hasMessage("cleanup failed");

        verify(connectionStateService, never()).revokeAuthorization(any(), any());
        verify(sessionRepository).releaseStartLock(USER_ID, CONNECTOR_ID, "lock-token");
    }

    @Test
    void akSkRevokeUsesTheSharedOperationLockBeforeDeletingCredentials() {
        connector.setAuthMode("AK_SK");

        service.revoke(CONNECTOR_ID, USER_ID);

        verify(connectionStateService).revokeAuthorization(USER_ID, CONNECTOR_ID);
        verify(provider, never()).revoke(any(), any());
        verify(sessionRepository).tryAcquireStartLock(eq(USER_ID), eq(CONNECTOR_ID), any());
        verify(sessionRepository, never()).hasActiveSession(any(), any());
        verify(sessionRepository).releaseStartLock(USER_ID, CONNECTOR_ID, "lock-token");
    }

    @Test
    void akSkRevokeIsIdempotentAfterTheBindingHasAlreadyBeenRemoved() {
        connector.setAuthMode("AK_SK");
        when(connectionStateService.findActiveAuthorization(USER_ID, CONNECTOR_ID)).thenReturn(null);

        assertThatCode(() -> service.revoke(CONNECTOR_ID, USER_ID)).doesNotThrowAnyException();

        verify(connectionStateService).revokeAuthorization(USER_ID, CONNECTOR_ID);
        verify(provider, never()).revoke(any(), any());
    }

    @Test
    void akSkRevokeStillDelegatesCleanupAfterTheConnectorIsDisabled() {
        connector.setAuthMode("AK_SK");
        connector.setStatusCd("00X");

        service.revoke(CONNECTOR_ID, USER_ID);

        verify(connectionStateService).revokeAuthorization(USER_ID, CONNECTOR_ID);
        verify(provider, never()).revoke(any(), any());
    }

    private interface RevocableProvider extends ConnectorAuthorizationProvider, ConnectorCredentialRevoker {
    }
}
