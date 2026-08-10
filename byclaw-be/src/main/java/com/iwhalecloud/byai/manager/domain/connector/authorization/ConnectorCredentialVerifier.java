package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Verifies an existing connector CLI credential without starting authorization or mutating state. */
public interface ConnectorCredentialVerifier {

    String providerCode();

    AuthorizationStatusResult verify(Long userId, ConnectorInfo connector);
}
