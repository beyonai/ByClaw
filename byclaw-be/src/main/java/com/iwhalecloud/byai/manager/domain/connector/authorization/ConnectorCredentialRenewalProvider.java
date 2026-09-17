package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

public interface ConnectorCredentialRenewalProvider {
    String providerCode();

    AuthorizationStatusResult renew(Long userId, ConnectorInfo connector);
}
