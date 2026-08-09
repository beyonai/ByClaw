package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Date;

public record AuthorizationProgress(
    String phase,
    String authorizationUrl,
    String providerState,
    Date expiresAt
) {
}
