package com.iwhalecloud.byai.manager.domain.connector.authorization;

/** Optional capability for removing a credential created before its connector binding could be persisted. */
public interface ConnectorProvisionalCredentialCleaner {

    void cleanupProvisionalCredential(AuthorizationSessionContext session, String credentialReference);
}
