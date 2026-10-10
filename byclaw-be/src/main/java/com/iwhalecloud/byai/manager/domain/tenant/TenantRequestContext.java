package com.iwhalecloud.byai.manager.domain.tenant;

public record TenantRequestContext(long userId, long enterpriseId, String role) {
}
