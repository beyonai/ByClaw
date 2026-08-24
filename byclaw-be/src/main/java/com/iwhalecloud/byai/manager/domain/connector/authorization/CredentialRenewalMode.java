package com.iwhalecloud.byai.manager.domain.connector.authorization;

/** Mechanism used by a provider to renew short-lived connector credentials. */
public enum CredentialRenewalMode {
    REFRESH_TOKEN,
    CREDENTIAL_REISSUE,
    PROBE_ONLY,
    NONE
}
