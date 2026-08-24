package com.iwhalecloud.byai.manager.domain.connector.authorization;

/** Sanitized runtime state of a connector credential. */
public enum CredentialState {
    READY,
    REFRESH_NEEDED,
    EXPIRING,
    REAUTH_REQUIRED,
    UNKNOWN
}
