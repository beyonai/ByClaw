package com.iwhalecloud.byai.manager.domain.connector.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import io.micrometer.core.instrument.simple.SimpleMeterRegistry;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifier;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialVerifierRegistry;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialRenewalMode;
import com.iwhalecloud.byai.manager.domain.connector.authorization.CredentialState;
import com.iwhalecloud.byai.manager.domain.connector.manifest.InvalidConnectorManifestException;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorSkillAuthorizationSyncDto;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class ConnectorSkillAuthorizationSyncServiceTest {

    private final ConnectorInfoService connectorInfoService = mock(ConnectorInfoService.class);
    private final ConnectorCredentialVerifierRegistry verifierRegistry =
        mock(ConnectorCredentialVerifierRegistry.class);
    private final ConnectorConnectionStateService connectionStateService =
        mock(ConnectorConnectionStateService.class);
    private final ConnectorCredentialVerifier verifier = mock(ConnectorCredentialVerifier.class);
    private SimpleMeterRegistry meterRegistry;

    private ConnectorSkillAuthorizationSyncService service;

    @BeforeEach
    void setUp() {
        meterRegistry = new SimpleMeterRegistry();
        service = new ConnectorSkillAuthorizationSyncService(
            connectorInfoService,
            verifierRegistry,
            connectionStateService,
            new ConnectorSkillAuthorizationSyncProperties(32, 0),
            new ConnectorSkillAuthorizationSyncMetrics(meterRegistry)
        );
    }

    @Test
    void verifiesCredentialBeforeSavingEnabledAuthorization() {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult connected = result(AuthorizationStatus.CONNECTED, null);
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenReturn(connected);

        ConnectorSkillAuthorizationSyncDto result = service.sync(" dingtalk ", "42");

        assertThat(result.getConnectorCode()).isEqualTo("dingtalk");
        assertThat(result.getConnected()).isTrue();
        verify(verifier).verify(42L, connector);
        verify(connectionStateService).saveEnabledAuthorization("42", connector, connected, null);
    }

    @Test
    void rejectsUnknownOrInactiveConnectorWithoutVerification() {
        when(connectorInfoService.findByCode("missing")).thenReturn(null);
        ConnectorInfo inactive = activeConnector();
        inactive.setStatusCd("00X");
        when(connectorInfoService.findByCode("inactive")).thenReturn(inactive);

        assertSyncError("CONNECTOR_NOT_FOUND", () -> service.sync("missing", "42"));
        assertSyncError("CONNECTOR_NOT_FOUND", () -> service.sync("inactive", "42"));
        verifyNoInteractions(verifierRegistry, verifier, connectionStateService);
    }

    @Test
    void rejectsConnectorWithoutRegisteredVerifier() {
        ConnectorInfo connector = activeConnector();
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk"))
            .thenThrow(new IllegalArgumentException("missing verifier"));

        assertSyncError(
            "CONNECTOR_VERIFIER_NOT_FOUND",
            () -> service.sync("dingtalk", "42")
        );

        verifyNoInteractions(verifier, connectionStateService);
    }

    @Test
    void rejectsConnectorOutsideSkillAllowlistEvenWhenActive() {
        ConnectorInfo connector = activeConnector();
        connector.setConnectorCode("custom");
        when(connectorInfoService.findByCode("custom")).thenReturn(connector);

        assertSyncError("CONNECTOR_NOT_FOUND", () -> service.sync("custom", "42"));

        verifyNoInteractions(verifierRegistry, verifier, connectionStateService);
    }

    @Test
    void rejectsConnectorWhoseProviderDoesNotMatchFixedMapping() {
        ConnectorInfo connector = activeConnector();
        connector.setProviderCode("lark-cli");
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);

        assertSyncError("CONNECTOR_VERIFIER_NOT_FOUND", () -> service.sync("dingtalk", "42"));

        verifyNoInteractions(verifierRegistry, verifier, connectionStateService);
    }

    @Test
    void verificationFailureNeverWritesConnectorState() {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult invalid = result(
            AuthorizationStatus.FAILED,
            "CONNECTOR_CREDENTIAL_INVALID"
        );
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenReturn(invalid);

        assertSyncError(
            "CONNECTOR_CREDENTIAL_INVALID",
            () -> service.sync("dingtalk", "42")
        );

        verifyNoInteractions(connectionStateService);
    }

    @Test
    void reauthorizationRequiredResultNeverWritesConnectorState() {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult reauthorizationRequired = AuthorizationStatusResult.connected(
            "account-42",
            "Ding User",
            CredentialState.REAUTH_REQUIRED,
            CredentialRenewalMode.REFRESH_TOKEN,
            null,
            null,
            new java.util.Date(),
            null
        );
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenReturn(reauthorizationRequired);

        assertSyncError("CONNECTOR_CREDENTIAL_INVALID", () -> service.sync("dingtalk", "42"));

        verifyNoInteractions(connectionStateService);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "CONNECTOR_CACHE_INVALID",
        "CONNECTOR_BUSINESS_PROBE_INVALID"
    })
    void passesPublicWecomDiagnosticCodesWithoutRetry(String errorCode) {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult invalid = result(AuthorizationStatus.FAILED, errorCode);
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenReturn(invalid);

        assertThatThrownBy(() -> service.sync("dingtalk", "42"))
            .isInstanceOfSatisfying(ConnectorSkillAuthorizationSyncException.class, error -> {
                assertThat(error.getErrorCode()).isEqualTo(errorCode);
                assertThat(error.isRetryable()).isFalse();
            });

        verifyNoInteractions(connectionStateService);
    }

    @Test
    void bindingFailureIsSanitizedAndRetryable() {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult connected = result(AuthorizationStatus.CONNECTED, null);
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenReturn(connected);
        when(connectionStateService.saveEnabledAuthorization("42", connector, connected, null))
            .thenThrow(new IllegalStateException("database password=secret"));

        assertThatThrownBy(() -> service.sync("dingtalk", "42"))
            .isInstanceOfSatisfying(ConnectorSkillAuthorizationSyncException.class, error -> {
                assertThat(error.getErrorCode()).isEqualTo("AUTH_BINDING_FAILED");
                assertThat(error.isRetryable()).isTrue();
                assertThat(error.getMessage()).doesNotContain("password", "secret");
            });
    }

    @Test
    void invalidManifestIsSanitizedAndNotRetryable() {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult connected = result(AuthorizationStatus.CONNECTED, null);
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenReturn(connected);
        when(connectionStateService.saveEnabledAuthorization("42", connector, connected, null))
            .thenThrow(new InvalidConnectorManifestException("runtime_manifest contains secret detail"));

        assertThatThrownBy(() -> service.sync("dingtalk", "42"))
            .isInstanceOfSatisfying(ConnectorSkillAuthorizationSyncException.class, error -> {
                assertThat(error.getErrorCode()).isEqualTo("CONNECTOR_MANIFEST_INVALID");
                assertThat(error.isRetryable()).isFalse();
                assertThat(error.getMessage()).doesNotContain("runtime_manifest", "secret");
            });
    }

    @Test
    void rejectsConcurrentVerificationForTheSameUserAndConnectorWithoutWaiting() throws Exception {
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult connected = result(AuthorizationStatus.CONNECTED, null);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenAnswer(invocation -> {
            entered.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("test verifier release timed out");
            }
            return connected;
        });

        var executor = Executors.newSingleThreadExecutor();
        try {
            var first = executor.submit(() -> service.sync("dingtalk", "42"));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();

            assertThatThrownBy(() -> service.sync("dingtalk", "42"))
                .isInstanceOfSatisfying(ConnectorSkillAuthorizationSyncException.class, error -> {
                    assertThat(error.getErrorCode()).isEqualTo("CONNECTOR_VERIFICATION_BUSY");
                    assertThat(error.isRetryable()).isTrue();
                });

            release.countDown();
            assertThat(first.get(5, TimeUnit.SECONDS).getConnected()).isTrue();
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void rejectsVerificationWhenGlobalCapacityIsFullAndRecordsBusyMetric() throws Exception {
        service = new ConnectorSkillAuthorizationSyncService(
            connectorInfoService,
            verifierRegistry,
            connectionStateService,
            new ConnectorSkillAuthorizationSyncProperties(1, 0),
            new ConnectorSkillAuthorizationSyncMetrics(meterRegistry)
        );
        ConnectorInfo connector = activeConnector();
        AuthorizationStatusResult connected = result(AuthorizationStatus.CONNECTED, null);
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        when(connectorInfoService.findByCode("dingtalk")).thenReturn(connector);
        when(verifierRegistry.get("dws-dingtalk")).thenReturn(verifier);
        when(verifier.verify(42L, connector)).thenAnswer(invocation -> {
            entered.countDown();
            if (!release.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("test verifier release timed out");
            }
            return connected;
        });

        var executor = Executors.newSingleThreadExecutor();
        try {
            var first = executor.submit(() -> service.sync("dingtalk", "42"));
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();

            assertSyncError("CONNECTOR_VERIFICATION_BUSY", () -> service.sync("dingtalk", "43"));
            assertThat(meterRegistry.get("byai.connector.skill_sync.busy").counter().count()).isEqualTo(1.0);

            release.countDown();
            assertThat(first.get(5, TimeUnit.SECONDS).getConnected()).isTrue();
        } finally {
            release.countDown();
            executor.shutdownNow();
        }
    }

    private ConnectorInfo activeConnector() {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(1001L);
        connector.setConnectorCode("dingtalk");
        connector.setProviderCode("dws-dingtalk");
        connector.setStatusCd("00A");
        return connector;
    }

    private AuthorizationStatusResult result(AuthorizationStatus status, String errorCode) {
        return new AuthorizationStatusResult(status, null, null, null, null, errorCode, "sensitive detail");
    }

    private void assertSyncError(String errorCode, org.assertj.core.api.ThrowableAssert.ThrowingCallable call) {
        assertThatThrownBy(call)
            .isInstanceOfSatisfying(ConnectorSkillAuthorizationSyncException.class,
                error -> assertThat(error.getErrorCode()).isEqualTo(errorCode));
    }
}
