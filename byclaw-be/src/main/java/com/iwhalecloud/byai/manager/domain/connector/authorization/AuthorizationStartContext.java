package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Map;

public record AuthorizationStartContext(
    String authorizationId,
    String userId,
    Long connectorId,
    String connectorCode,
    String providerCode,
    String redirectUrl,
    Map<String, Object> providerConfig,
    ManifestCommandCatalog commandCatalog
) {
    public AuthorizationStartContext(
            String authorizationId,
            String userId,
            Long connectorId,
            String connectorCode,
            String providerCode,
            String redirectUrl,
            Map<String, Object> providerConfig) {
        this(authorizationId, userId, connectorId, connectorCode, providerCode, redirectUrl, providerConfig, null);
    }
}
