package com.iwhalecloud.byai.common.integration.security;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Set;

/** Immutable authority derived exclusively from server-side service credentials. */
public record InternalServicePrincipal(String clientId, String sourceSystem, Set<String> scopes,
                                       Set<String> enterpriseIds, boolean allTenants) {
    public static final String ATTRIBUTE = InternalServicePrincipal.class.getName();
    public InternalServicePrincipal {
        scopes = Set.copyOf(scopes);
        enterpriseIds = Set.copyOf(enterpriseIds);
        if (clientId == null || clientId.isBlank() || sourceSystem == null || sourceSystem.isBlank()) {
            throw new IllegalArgumentException("Service identity is incomplete");
        }
    }
    public static InternalServicePrincipal require(HttpServletRequest request) {
        if (request.getAttribute(ATTRIBUTE) instanceof InternalServicePrincipal principal) return principal;
        throw new InternalServiceSecurityException(401, "SERVICE_AUTH_REQUIRED");
    }
    public void requireScope(String scope) {
        if (!scopes.contains(scope)) throw new InternalServiceSecurityException(403, "SERVICE_SCOPE_DENIED");
    }
    public void requireSource(String source) {
        if (!sourceSystem.equals(source)) throw new InternalServiceSecurityException(403, "SERVICE_SOURCE_DENIED");
    }
    public void requireTenant(String enterpriseId) {
        if (enterpriseId == null || !enterpriseId.matches("[1-9][0-9]*")
            || (!allTenants && !enterpriseIds.contains(enterpriseId))) {
            throw new InternalServiceSecurityException(403, "SERVICE_TENANT_DENIED");
        }
    }
}
