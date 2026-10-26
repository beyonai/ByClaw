package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantCommercialLegacyGuardTest {
    @Test void oldOperationsCannotBypassDurableCommercialSlot() {
        var tenants=mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(42,"COMMERCIAL_MANAGED")).thenReturn("true");
        var service=new TenantDbProvisioningService(tenants,null,null,null,null,null,null,new ObjectMapper(),Runnable::run,"");
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.provision(42));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.request(42));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.requestRestart(42,"tenant-opengauss",1));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.recreateNode(42));
    }
}
