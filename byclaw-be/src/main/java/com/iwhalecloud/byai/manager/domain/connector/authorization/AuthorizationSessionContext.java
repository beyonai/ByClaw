package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

public record AuthorizationSessionContext(
    String authorizationId,
    String userId,
    Long connectorId,
    String connectorCode,
    String providerCode,
    String providerSessionId,
    String providerState,
    Date expiresAt,
    ManifestCommandCatalog commandCatalog
) {
    public AuthorizationSessionContext(
            String authorizationId,
            String userId,
            Long connectorId,
            String connectorCode,
            String providerCode,
            String providerSessionId,
            String providerState,
            Date expiresAt) {
        this(
            authorizationId,
            userId,
            connectorId,
            connectorCode,
            providerCode,
            providerSessionId,
            providerState,
            expiresAt,
            null
        );
    }
}
