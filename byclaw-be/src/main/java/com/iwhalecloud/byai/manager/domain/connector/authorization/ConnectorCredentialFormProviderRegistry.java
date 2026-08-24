package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

/** Immutable lookup of synchronous connector credential-form providers. */
@Component
public class ConnectorCredentialFormProviderRegistry {

    private final Map<String, ConnectorCredentialFormProvider> providers;

    public ConnectorCredentialFormProviderRegistry(List<ConnectorCredentialFormProvider> providers) {
        Map<String, ConnectorCredentialFormProvider> providersByCode = new HashMap<>();
        for (ConnectorCredentialFormProvider provider : providers) {
            String code = provider.providerCode();
            if (code == null || code.isBlank()) {
                throw new IllegalArgumentException("Connector credential form provider code must not be blank");
            }
            if (providersByCode.putIfAbsent(code, provider) != null) {
                throw new IllegalStateException("Duplicate connector credential form provider code: " + code);
            }
        }
        this.providers = Map.copyOf(providersByCode);
    }

    public ConnectorCredentialFormProvider get(String providerCode) {
        ConnectorCredentialFormProvider provider = providerCode == null ? null : providers.get(providerCode);
        if (provider == null) {
            throw new IllegalArgumentException("Unknown connector credential form provider code: " + providerCode);
        }
        return provider;
    }
}
