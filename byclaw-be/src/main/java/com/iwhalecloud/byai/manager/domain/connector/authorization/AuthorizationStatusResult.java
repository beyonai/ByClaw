package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

public record AuthorizationStatusResult(
    AuthorizationStatus status,
    String accountId,
    String accountName,
    Date credentialExpiresAt,
    String credentialReference,
    String errorCode,
    String errorMessage,
    AuthorizationProgress progress
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
}
