package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;
import java.util.UUID;

/** In-memory OAuth2 credential material; persistence must encrypt token fields. */
public record ConnectorCredentialSecret(
    String credentialReference,
    String providerCode,
    String userId,
    Long connectorId,
    String accessToken,
    String refreshToken,
    String tokenType,
    String grantedScopes,
    Date accessExpiresAt,
    Date refreshExpiresAt
) {
    public static ConnectorCredentialSecret forOAuth2(
            String providerCode, String userId, Long connectorId, String accessToken, String refreshToken) {
        return forOAuth2(providerCode, userId, connectorId, accessToken, refreshToken, null, null, null, null);
    }

    public static ConnectorCredentialSecret forOAuth2(String providerCode, String userId, Long connectorId,
            String accessToken, String refreshToken, String tokenType, String grantedScopes,
            Date accessExpiresAt, Date refreshExpiresAt) {
        return new ConnectorCredentialSecret(UUID.randomUUID().toString(), providerCode, userId, connectorId,
            accessToken, refreshToken, tokenType, grantedScopes, accessExpiresAt, refreshExpiresAt);
    }

    public static ConnectorCredentialSecret restored(String reference, String providerCode, String userId,
            Long connectorId, String accessToken, String refreshToken, String tokenType, String grantedScopes,
            Date accessExpiresAt, Date refreshExpiresAt) {
        return new ConnectorCredentialSecret(reference, providerCode, userId, connectorId, accessToken, refreshToken,
            tokenType, grantedScopes, accessExpiresAt, refreshExpiresAt);
    }
}
