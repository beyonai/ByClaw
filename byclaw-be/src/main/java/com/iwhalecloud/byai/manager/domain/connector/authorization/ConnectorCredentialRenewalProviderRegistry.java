package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

@Component
public class ConnectorCredentialRenewalProviderRegistry {
    private final Map<String, ConnectorCredentialRenewalProvider> providers;

    public ConnectorCredentialRenewalProviderRegistry(List<ConnectorCredentialRenewalProvider> providers) {
        if (providers == null) {
            throw new IllegalArgumentException("Connector renewal providers must not be null");
        }
        Map<String, ConnectorCredentialRenewalProvider> byCode = new HashMap<>();
        for (ConnectorCredentialRenewalProvider provider : providers) {
            if (provider == null || provider.providerCode() == null || provider.providerCode().isBlank()) {
                throw new IllegalArgumentException("Connector renewal provider code must not be blank");
            }
            if (byCode.putIfAbsent(provider.providerCode(), provider) != null) {
                throw new IllegalStateException("Duplicate connector renewal provider code: " + provider.providerCode());
            }
        }
        this.providers = Map.copyOf(byCode);
    }

    public ConnectorCredentialRenewalProvider get(String providerCode) {
        ConnectorCredentialRenewalProvider provider = providerCode == null ? null : providers.get(providerCode);
        if (provider == null) {
            throw new IllegalArgumentException("Unknown connector renewal provider code: " + providerCode);
        }
        return provider;
    }
}
