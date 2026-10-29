package com.iwhalecloud.byai.manager.domain.tenant.integration;

import com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantCommercialLegacyGuardTest {
    @Test void initialProvisioningCannotBypassDurableCommercialSlot() {
        var tenants=mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(42,"COMMERCIAL_MANAGED")).thenReturn("true");
        var service=new TenantDbProvisioningService(tenants,null,null,null,null,null,null,new ObjectMapper(),Runnable::run,"");
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.provision(42));
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.request(42));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.CsvSource({"READY,true", "STARTING,true", "READY,false"})
    void commercialNodeReplacementRetainsReadinessAndLockChecks(String status, boolean lockAvailable) {
        var tenants = mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(42, "COMMERCIAL_MANAGED")).thenReturn("true");
        var config = new java.util.HashMap<String, String>();
        config.put("COMMERCIAL_MANAGED", "true");
        config.put("PROVISION_STATE", "{\"status\":\"" + status + "\",\"generation\":\"7\"}");
        config.put("PACKAGE_CONTENT_SNAPSHOT", "{\"profileKey\":\"s\",\"nodeProfileKey\":\"node-s\"}");
        config.put("DB_SANDBOX_RECORD_ID", "12915");
        config.put("NODE_SANDBOX_RECORD_ID", "12916");
        when(tenants.selectConfigs(42)).thenAnswer(invocation -> config.entrySet().stream().map(entry -> {
            var row = new com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow();
            row.setParamsCode(entry.getKey());
            row.setParamsValue(entry.getValue());
            return row;
        }).toList());
        when(tenants.updateConfig(eq(42L), anyString(), anyString())).thenAnswer(invocation -> {
            config.put(invocation.getArgument(1), invocation.getArgument(2));
            return 1;
        });
        var redis = mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        var values = mock(org.springframework.data.redis.core.ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.setIfAbsent(anyString(), anyString(), any(java.time.Duration.class))).thenReturn(lockAvailable);
        var sandbox = mock(com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.class);
        var fresh = new com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView(
            12917L, "replacement-node", "http://node:3100");
        when(sandbox.recreateDataNode(42L, "node-s", 12915L, 7L)).thenReturn(fresh);
        var publisher = mock(com.iwhalecloud.byai.manager.domain.tenant.TenantConfigPublisher.class);
        when(publisher.publish(eq(42L), anyMap())).thenReturn(true);
        var service = new TenantDbProvisioningService(tenants, sandbox, null, publisher, null, null,
            redis, new ObjectMapper(), Runnable::run, "");
        if (!lockAvailable || !"READY".equals(status)) {
            var error = assertThrows(org.springframework.web.server.ResponseStatusException.class,
                () -> service.recreateNode(42));
            assertEquals(lockAvailable ? "tenant.notReady" : "tenant.provision.inProgress", error.getReason());
            verifyNoInteractions(sandbox, publisher);
        } else {
            assertSame(fresh, service.recreateNode(42));
            // Replacing only the Node preserves database identity and the current tenant generation.
            assertEquals("12915", config.get("DB_SANDBOX_RECORD_ID"));
            assertEquals("12917", config.get("NODE_SANDBOX_RECORD_ID"));
            assertEquals("{\"status\":\"READY\",\"generation\":\"7\"}", config.get("PROVISION_STATE"));
            verify(publisher).publish(42L, config);
            verify(sandbox).recreateDataNode(42L, "node-s", 12915L, 7L);
            verifyNoMoreInteractions(sandbox);
        }
    }
}
