package com.iwhalecloud.byai.manager.domain.tenant;

import org.junit.jupiter.api.Test;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class TenantModeServiceTest {
    @Test
    void readsTrialModeFromLocalTenantConfig() {
        TenantAdminTenantMapper tenants = mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(42L, "TENANT_MODE")).thenReturn("TRIAL");
        when(tenants.selectConfig(43L, "TENANT_MODE")).thenReturn("STANDARD");
        TenantModeService service = new TenantModeService(tenants);
        assertTrue(service.isTrialTenant(42L));
        assertFalse(service.isTrialTenant(43L));
        assertFalse(service.isTrialTenant(999L));
        assertFalse(service.isTrialTenant(0L));
        assertTrue(service.isSharedDataTenant(1L));
        assertTrue(service.isSharedDataTenant(42L));
        assertFalse(service.isSharedDataTenant(43L));
    }
}
