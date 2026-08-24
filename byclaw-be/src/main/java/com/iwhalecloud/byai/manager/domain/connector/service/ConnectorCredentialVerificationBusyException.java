package com.iwhalecloud.byai.manager.domain.connector.service;

/** Stable, secret-free signal that process-local verification admission is unavailable. */
public class ConnectorCredentialVerificationBusyException extends RuntimeException {

    public static final String ERROR_CODE = "CONNECTOR_VERIFICATION_BUSY";
    public static final String PUBLIC_MESSAGE = "Connector credential verification is busy";

    public ConnectorCredentialVerificationBusyException() {
        super(PUBLIC_MESSAGE);
    }
}
