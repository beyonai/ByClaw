package com.iwhalecloud.byai.manager.domain.connector.authorization;

public class ConnectorCredentialRenewalLeaseUnavailableException extends RuntimeException {
    public ConnectorCredentialRenewalLeaseUnavailableException() {
        super("Connector credential renewal lease backend unavailable");
    }
}
