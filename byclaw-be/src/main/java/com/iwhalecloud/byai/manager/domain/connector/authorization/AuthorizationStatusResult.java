package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

public record AuthorizationStatusResult(
    AuthorizationStatus status,
    String accountId,
    String accountName,
    Date credentialExpiresAt,
    String credentialReference,
    String errorCode,
    String errorMessage
) {
}
