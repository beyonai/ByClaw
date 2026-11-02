package com.iwhalecloud.byai.manager.domain.tenant;

/** Result of validating a tenant selection without issuing a browser-held tenant token. */
public record TenantSwitchView(String enterpriseId, String role) {
}
