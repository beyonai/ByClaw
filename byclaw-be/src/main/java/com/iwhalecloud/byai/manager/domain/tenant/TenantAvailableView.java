package com.iwhalecloud.byai.manager.domain.tenant;

/** Tenant identity remains a decimal string at the HTTP boundary. */
public record TenantAvailableView(String enterpriseId, String enterpriseName, String role,
                                  String provisionState) {
}
