package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

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
    Date lastVerifiedAt,
    Map<String, String> accountAttributes
) {
    private static final Set<String> ALLOWED_ACCOUNT_ATTRIBUTES = Set.of("username", "principalName");

    public AuthorizationStatusResult {
        Map<String, String> sanitized = new LinkedHashMap<>();
        if (accountAttributes != null) {
            accountAttributes.forEach((key, value) -> {
                if (ALLOWED_ACCOUNT_ATTRIBUTES.contains(key)
                        && value != null && !value.isBlank() && value.length() <= 512) {
                    sanitized.put(key, value);
                }
            });
        }
        accountAttributes = Map.copyOf(sanitized);
    }

    public AuthorizationStatusResult(
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
            Date lastVerifiedAt) {
        this(status, accountId, accountName, accessExpiresAt, credentialReference, errorCode, errorMessage,
            progress, credentialState, renewalMode, refreshExpiresAt, lastVerifiedAt, Map.of());
    }

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
            null,
            Map.of()
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
        return connected(accountId, accountName, credentialState, renewalMode, accessExpiresAt,
            refreshExpiresAt, lastVerifiedAt, credentialReference, Map.of());
    }

    public static AuthorizationStatusResult connected(
            String accountId,
            String accountName,
            CredentialState credentialState,
            CredentialRenewalMode renewalMode,
            Date accessExpiresAt,
            Date refreshExpiresAt,
            Date lastVerifiedAt,
            String credentialReference,
            Map<String, String> accountAttributes) {
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
            lastVerifiedAt,
            accountAttributes
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
