package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Map;

import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

/** Verifies credentials supplied synchronously by a connector authorization form. */
public interface ConnectorCredentialFormProvider {

    String providerCode();

    CredentialFormVerification verify(String userId, ConnectorInfo connector, Map<String, String> credentials);
}
