package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.springframework.stereotype.Component;

@Component
public class AuthorizationProviderRegistry {

    private final Map<String, ConnectorAuthorizationProvider> providers;

    public AuthorizationProviderRegistry(List<ConnectorAuthorizationProvider> providers) {
        Map<String, ConnectorAuthorizationProvider> providersByCode = new HashMap<>();
        for (ConnectorAuthorizationProvider provider : providers) {
            String code = provider.providerCode();
            if (code == null || code.isBlank()) {
                throw new IllegalArgumentException("Authorization provider code must not be blank");
            }
            if (providersByCode.putIfAbsent(code, provider) != null) {
                throw new IllegalStateException("Duplicate authorization provider code: " + code);
            }
        }
        this.providers = Map.copyOf(providersByCode);
    }

    public ConnectorAuthorizationProvider get(String code) {
        ConnectorAuthorizationProvider provider = code == null ? null : providers.get(code);
        if (provider == null) {
            throw new IllegalArgumentException("Unknown authorization provider code: " + code);
        }
        return provider;
    }
}
