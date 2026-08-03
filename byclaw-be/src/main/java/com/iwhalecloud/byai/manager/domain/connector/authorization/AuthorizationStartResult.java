package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

public record AuthorizationStartResult(
    AuthorizationStatus status,
    String authorizationUrl,
    Date expiresAt,
    String providerSessionId,
    String providerState,
    String errorCode,
    String errorMessage,
    String phase
) {
    public AuthorizationStartResult(
            AuthorizationStatus status,
            String authorizationUrl,
            Date expiresAt,
            String providerSessionId,
            String providerState,
            String errorCode,
            String errorMessage) {
        this(status, authorizationUrl, expiresAt, providerSessionId, providerState, errorCode, errorMessage, null);
    }
}
