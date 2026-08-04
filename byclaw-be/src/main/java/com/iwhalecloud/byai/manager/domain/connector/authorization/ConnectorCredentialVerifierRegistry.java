package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

/** Immutable lookup of read-only credential verifiers by authorization provider code. */
@Component
public class ConnectorCredentialVerifierRegistry {

    private final Map<String, ConnectorCredentialVerifier> verifiers;

    public ConnectorCredentialVerifierRegistry(List<ConnectorCredentialVerifier> verifiers) {
        Map<String, ConnectorCredentialVerifier> verifiersByCode = new HashMap<>();
        for (ConnectorCredentialVerifier verifier : verifiers) {
            String code = verifier.providerCode();
            if (code == null || code.isBlank()) {
                throw new IllegalArgumentException("Connector credential verifier code must not be blank");
            }
            if (verifiersByCode.putIfAbsent(code, verifier) != null) {
                throw new IllegalStateException("Duplicate connector credential verifier code: " + code);
            }
        }
        this.verifiers = Map.copyOf(verifiersByCode);
    }

    public ConnectorCredentialVerifier get(String providerCode) {
        ConnectorCredentialVerifier verifier = providerCode == null ? null : verifiers.get(providerCode);
        if (verifier == null) {
            throw new IllegalArgumentException("Unknown connector credential verifier code: " + providerCode);
        }
        return verifier;
    }
}
