package com.iwhalecloud.byai.manager.domain.connector.authorization;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Optional capability for providers that can clear a user's stored connector credential. */
public interface ConnectorCredentialRevoker {

    void revoke(String userId, ConnectorInfo connector);
}
