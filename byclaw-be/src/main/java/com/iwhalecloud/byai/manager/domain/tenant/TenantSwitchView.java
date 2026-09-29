package com.iwhalecloud.byai.manager.domain.tenant;

public record TenantSwitchView(String enterpriseId, String role, String tenantContextToken,
                               String expiresAt, int contextVersion) {
}
