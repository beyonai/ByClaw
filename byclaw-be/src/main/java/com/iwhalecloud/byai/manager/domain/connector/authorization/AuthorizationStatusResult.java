package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

public record AuthorizationStatusResult(
    AuthorizationStatus status,
    String accountId,
    String accountName,
    Date accessExpiresAt,
    String credentialReference,
    String errorCode,
    String errorMessage,
    AuthorizationProgress progress,
    CredentialState credentialState,
    CredentialRenewalMode renewalMode,
    Date refreshExpiresAt,
    Date lastVerifiedAt
) {
    public AuthorizationStatusResult(
            AuthorizationStatus status,
            String accountId,
            String accountName,
            Date credentialExpiresAt,
            String credentialReference,
            String errorCode,
            String errorMessage) {
        this(status, accountId, accountName, credentialExpiresAt, credentialReference, errorCode, errorMessage, null);
    }

    public AuthorizationStatusResult(
            AuthorizationStatus status,
            String accountId,
            String accountName,
            Date credentialExpiresAt,
            String credentialReference,
            String errorCode,
            String errorMessage,
            AuthorizationProgress progress) {
        this(
            status,
            accountId,
            accountName,
            credentialExpiresAt,
            credentialReference,
            errorCode,
            errorMessage,
            progress,
            defaultCredentialState(status),
            CredentialRenewalMode.NONE,
            null,
            null
        );
    }

    public static AuthorizationStatusResult connected(
            String accountId,
            String accountName,
            CredentialState credentialState,
            CredentialRenewalMode renewalMode,
            Date accessExpiresAt,
            Date refreshExpiresAt,
            Date lastVerifiedAt,
            String credentialReference) {
        return new AuthorizationStatusResult(
            AuthorizationStatus.CONNECTED,
            accountId,
            accountName,
            accessExpiresAt,
            credentialReference,
            null,
            null,
            null,
            credentialState,
            renewalMode,
            refreshExpiresAt,
            lastVerifiedAt
        );
    }

    /** Compatibility alias retained while API clients migrate to accessExpiresAt. */
    public Date credentialExpiresAt() {
        return accessExpiresAt;
    }

    private static CredentialState defaultCredentialState(AuthorizationStatus status) {
        return status == AuthorizationStatus.CONNECTED ? CredentialState.READY : CredentialState.UNKNOWN;
    }
}
