package com.iwhalecloud.byai.manager.domain.connector.authorization;

public class ConnectorCredentialRenewalConflictException extends RuntimeException {
    public ConnectorCredentialRenewalConflictException() {
        super("Connector credential renewal conflict");
    }
}
