package com.iwhalecloud.byai.manager.domain.connector.provider.dingtalk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.OffsetDateTime;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService.DwsCredentialStatus;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class DwsDingtalkAuthorizationProviderTest {

    private static final String AUTHORIZATION_ID = "auth-dws-1";
    private static final String VERIFICATION_URL =
        "https://login.dingtalk.com/oauth2/device/verify.htm?user_code=SECRET-CODE";

    private final DwsAuthService dwsAuthService = mock(DwsAuthService.class);
    private final DwsDingtalkAuthorizationProvider provider =
        new DwsDingtalkAuthorizationProvider(dwsAuthService);

    @Test
    void verifiesExistingValidDwsCredentialAsConnected() {
        when(dwsAuthService.getCredentialStatus(42L))
            .thenReturn(DwsCredentialStatus.completed(connectedStatus()));

        AuthorizationStatusResult result = provider.verify("42", new ConnectorInfo());

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("ding-user-42");
        assertThat(result.accountName()).isEqualTo("Ding User");
        verify(dwsAuthService).getCredentialStatus(42L);
    }

    @Test
    void rejectsExistingInvalidDwsCredential() {
        when(dwsAuthService.getCredentialStatus(42L))
            .thenReturn(DwsCredentialStatus.completed(Map.of("tokenValid", false)));

        AuthorizationStatusResult result = provider.verify("42", new ConnectorInfo());

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("CONNECTOR_CREDENTIAL_INVALID");
    }

    @Test
    void mapsDwsCredentialTimeoutAndWorkspaceFailure() {
        when(dwsAuthService.getCredentialStatus(42L))
            .thenReturn(DwsCredentialStatus.timeout(), DwsCredentialStatus.workspaceUnavailable());

        AuthorizationStatusResult timeout = provider.verify("42", new ConnectorInfo());
        AuthorizationStatusResult workspaceFailure = provider.verify("42", new ConnectorInfo());

        assertThat(timeout.errorCode()).isEqualTo("CONNECTOR_VERIFICATION_TIMEOUT");
        assertThat(workspaceFailure.errorCode()).isEqualTo("CREDENTIAL_WORKSPACE_UNAVAILABLE");
    }

    @Test
    void startsPendingAuthorizationWithExplicitUserAndAuthorizationId() {
        when(dwsAuthService.startDeviceAuth(42L, AUTHORIZATION_ID)).thenReturn(Map.of(
            "success", true,
            "userCode", "SECRET-CODE",
            "verificationUrl", VERIFICATION_URL
        ));
        long before = System.currentTimeMillis();

        AuthorizationStartResult result = provider.start(startContext("42"));

        long after = System.currentTimeMillis();
        assertThat(provider.providerCode()).isEqualTo("dws-dingtalk");
        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo(VERIFICATION_URL);
        assertThat(result.expiresAt().getTime()).isBetween(before + 900_000L, after + 900_000L);
        assertThat(result.providerSessionId()).isNull();
        assertThat(result.providerState()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        verify(dwsAuthService).startDeviceAuth(42L, AUTHORIZATION_ID);
        verify(dwsAuthService, never()).startDeviceAuth();
    }

    @Test
    void mapsValidDwsStatusToConnectedAccount() {
        String expiresAt = "2026-08-01T12:30:00+08:00";
        when(dwsAuthService.getAuthStatus(42L)).thenReturn(Map.of(
            "tokenValid", true,
            "userId", "ding-user-42",
            "userName", "Ding User",
            "expiresAt", expiresAt
        ));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext("42"));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("ding-user-42");
        assertThat(result.accountName()).isEqualTo("Ding User");
        assertThat(result.credentialExpiresAt())
            .isEqualTo(Date.from(OffsetDateTime.parse(expiresAt).toInstant()));
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        verify(dwsAuthService).getAuthStatus(42L);
    }

    @Test
    void mapsInvalidOrUnparseableDwsStatusToPendingWithoutSecrets() {
        when(dwsAuthService.getAuthStatus(42L)).thenReturn(Map.of(
            "tokenValid", false,
            "expiresAt", "not-a-date"
        ));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext("42"));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
    }

    @Test
    void returnsInvalidUserFailureWithoutCallingDws() {
        AuthorizationStartResult startResult = provider.start(startContext("0"));
        AuthorizationStatusResult statusResult = provider.queryStatus(sessionContext("not-a-number"));
        provider.cancel(sessionContext("-1"));

        assertThat(startResult.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(startResult.errorCode()).isEqualTo("INVALID_USER");
        assertThat(statusResult.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(statusResult.errorCode()).isEqualTo("INVALID_USER");
        verifyNoInteractions(dwsAuthService);
    }

    @Test
    void routesCancellationByExactAuthorizationIdAndUser() {
        provider.cancel(sessionContext("42"));

        verify(dwsAuthService).cancelDeviceAuth(AUTHORIZATION_ID, 42L);
        verify(dwsAuthService, never()).cancelDeviceAuth(42L);
    }

    @Test
    void revokesDwsCredentialForExplicitUser() {
        provider.revoke("42", new ConnectorInfo());

        verify(dwsAuthService).revokeCredential(42L);
    }

    @Test
    void sanitizesProviderStartFailureDetails() {
        when(dwsAuthService.startDeviceAuth(42L, AUTHORIZATION_ID)).thenReturn(Map.of(
            "success", false,
            "message", "full output with SECRET-CODE and temporary-token"
        ));

        AuthorizationStartResult result = provider.start(startContext("42"));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PROVIDER_START_FAILED");
        assertThat(result.errorMessage())
            .doesNotContain("SECRET-CODE")
            .doesNotContain("temporary-token")
            .isNotBlank();
    }

    @Test
    void rejectsSuccessfulStartWithoutVerificationUrl() {
        when(dwsAuthService.startDeviceAuth(42L, AUTHORIZATION_ID)).thenReturn(Map.of("success", true));

        AuthorizationStartResult nullUrl = provider.start(startContext("42"));
        when(dwsAuthService.startDeviceAuth(42L, AUTHORIZATION_ID)).thenReturn(Map.of(
            "success", true,
            "verificationUrl", "   "
        ));
        AuthorizationStartResult blankUrl = provider.start(startContext("42"));

        assertThat(nullUrl.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(nullUrl.errorCode()).isEqualTo("PROVIDER_START_FAILED");
        assertThat(blankUrl.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(blankUrl.errorCode()).isEqualTo("PROVIDER_START_FAILED");
    }

    @Test
    void connectedStatusTreatsBlankAndInvalidExpiryAsUnknown() {
        Map<String, Object> status = connectedStatus();
        status.put("expiresAt", "   ");
        when(dwsAuthService.getAuthStatus(42L)).thenReturn(status);
        AuthorizationStatusResult blankExpiry = provider.queryStatus(sessionContext("42"));

        status.put("expiresAt", "not-a-date");
        AuthorizationStatusResult invalidExpiry = provider.queryStatus(sessionContext("42"));

        assertThat(blankExpiry.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(blankExpiry.credentialExpiresAt()).isNull();
        assertThat(invalidExpiry.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(invalidExpiry.credentialExpiresAt()).isNull();
    }

    @Test
    void connectedStatusDefensivelyCopiesDateExpiry() {
        Date expiresAt = new Date(1_800_000_000_000L);
        Map<String, Object> status = connectedStatus();
        status.put("expiresAt", expiresAt);
        when(dwsAuthService.getAuthStatus(42L)).thenReturn(status);

        AuthorizationStatusResult result = provider.queryStatus(sessionContext("42"));

        assertThat(result.credentialExpiresAt()).isEqualTo(expiresAt).isNotSameAs(expiresAt);
    }

    @Test
    void connectedStatusParsesUtcZExpiry() {
        Map<String, Object> status = connectedStatus();
        status.put("expiresAt", "2026-08-01T04:30:00Z");
        when(dwsAuthService.getAuthStatus(42L)).thenReturn(status);

        AuthorizationStatusResult result = provider.queryStatus(sessionContext("42"));

        assertThat(result.credentialExpiresAt()).isEqualTo(Date.from(Instant.parse("2026-08-01T04:30:00Z")));
    }

    @Test
    void nullOrExceptionalStatusRemainsPending() {
        when(dwsAuthService.getAuthStatus(42L)).thenReturn(null);
        AuthorizationStatusResult nullStatus = provider.queryStatus(sessionContext("42"));

        when(dwsAuthService.getAuthStatus(42L)).thenThrow(new IllegalStateException("temporary-token"));
        AuthorizationStatusResult exceptionalStatus = provider.queryStatus(sessionContext("42"));

        assertThat(nullStatus.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(exceptionalStatus.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(exceptionalStatus.errorMessage()).isNull();
    }

    private Map<String, Object> connectedStatus() {
        Map<String, Object> status = new HashMap<>();
        status.put("tokenValid", true);
        status.put("userId", "ding-user-42");
        status.put("userName", "Ding User");
        return status;
    }

    private AuthorizationStartContext startContext(String userId) {
        return new AuthorizationStartContext(
            AUTHORIZATION_ID,
            userId,
            1001L,
            "dingtalk",
            "dws-dingtalk",
            null,
            Map.of()
        );
    }

    private AuthorizationSessionContext sessionContext(String userId) {
        return new AuthorizationSessionContext(
            AUTHORIZATION_ID,
            userId,
            1001L,
            "dingtalk",
            "dws-dingtalk",
            null,
            null,
            new Date(System.currentTimeMillis() + 900_000L)
        );
    }
}
