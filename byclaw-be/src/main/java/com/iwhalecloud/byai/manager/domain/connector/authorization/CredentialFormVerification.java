package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.Map;

/** Result of a synchronous credential-form verification. */
public record CredentialFormVerification(AuthorizationStatusResult status, Map<String, String> runtimeEnvironment) {

    public CredentialFormVerification {
        runtimeEnvironment = runtimeEnvironment == null ? Map.of() : Map.copyOf(runtimeEnvironment);
    }
}
