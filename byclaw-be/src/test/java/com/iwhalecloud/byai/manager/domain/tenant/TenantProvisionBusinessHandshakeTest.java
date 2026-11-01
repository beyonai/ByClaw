package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.TenantSandboxView;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow;
import org.junit.jupiter.api.Test;

class TenantProvisionBusinessHandshakeTest {
    @Test void durableReadyFollowsRedisReadyAndBusinessHandshake() throws Exception { verify(false); }
    @Test void failedBusinessHandshakeCannotMarkProvisionReady() throws Exception { verify(true); }

    private void verify(boolean timeout) throws Exception {
        var mapper = new ObjectMapper();
        Map<String,String> config = new HashMap<>(Map.of("PROVISION_REQUEST_ID", "fixture-request",
            "PROVISION_STATE", "{\"status\":\"FAILED\"}", "PACKAGE_CONTENT_SNAPSHOT", "{\"profileKey\":\"s\"}",
            "DB_PASSWORD", "fixture-envelope", "DB_CREDENTIAL_VERSION", "1"));
        var tenants = mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfigs(42L)).thenAnswer(i -> config.entrySet().stream().map(e -> {
            var row = new TenantConfigRow(); row.setParamsCode(e.getKey()); row.setParamsValue(e.getValue()); return row;
        }).toList());
        List<String> durableStates = new ArrayList<>();
        when(tenants.updateConfig(eq(42L), anyString(), anyString())).thenAnswer(i -> {
            String key = i.getArgument(1), value = i.getArgument(2); config.put(key,value);
            if (key.equals("PROVISION_STATE")) durableStates.add(mapper.readTree(value).path("status").asText());
            return 1;
        });
        var publisher = mock(TenantConfigPublisher.class);
        AtomicBoolean redisReady = new AtomicBoolean(), handshake = new AtomicBoolean();
        when(publisher.publish(eq(42L), anyMap())).thenAnswer(i -> {
            Map<String,String> published = i.getArgument(1);
            if (mapper.readTree(published.get("PROVISION_STATE")).path("status").asText().equals("READY")) redisReady.set(true);
            return true;
        });
        var schemas = mock(TenantNodeSchemaService.class, i -> {
            if (i.getMethod().getName().equals("initialized")) return true;
            if (i.getMethod().getName().equals("awaitBusinessReady")) {
                assertTrue(redisReady.get());
                assertFalse(durableStates.contains("READY"));
                assertEquals(42L, (long) i.getArgument(0)); assertEquals(1L, (long) i.getArgument(1)); assertEquals(7L, (long) i.getArgument(2));
                handshake.set(true);
                if (timeout) throw new IllegalStateException("tenant Node business health check timed out");
            }
            return org.mockito.Answers.RETURNS_DEFAULTS.answer(i);
        });
        var sandboxes = mock(TenantSandboxService.class);
        when(sandboxes.launchOpenGauss(eq(42L), eq("s"), anyString(), anyString(), anyString()))
            .thenReturn(new TenantSandboxView(7,"docker-db","tcp://127.0.0.1:15432"));
        when(sandboxes.launchDataNode(42L,"s",7L,1L)).thenReturn(new TenantSandboxView(8,"node","http://node"));
        var crypto = mock(TenantCredentialCrypto.class);
        when(crypto.decrypt(anyLong(), anyString(), anyString())).thenReturn("fixture-password");
        when(crypto.isOpenGaussCompatible(anyString())).thenReturn(true);
        var connection = mock(Connection.class); var statement = mock(Statement.class); var result = mock(ResultSet.class);
        when(connection.createStatement()).thenReturn(statement); when(statement.executeQuery(anyString())).thenReturn(result);
        when(result.next()).thenReturn(true); when(result.getString(1)).thenReturn("bc_t_42_admin"); when(result.getString(2)).thenReturn("byclaw_t_42");
        try (var driver = mockStatic(DriverManager.class)) {
            driver.when(() -> DriverManager.getConnection(anyString(), any(java.util.Properties.class))).thenReturn(connection);
            var service = new TenantDbProvisioningService(tenants,sandboxes,crypto,publisher,schemas,null,null,mapper,Runnable::run,"");
            var method = TenantDbProvisioningService.class.getDeclaredMethod("provisionLocked",long.class);
            method.setAccessible(true);
            if (timeout) assertThrows(java.lang.reflect.InvocationTargetException.class,()->method.invoke(service,42L));
            else method.invoke(service,42L);
        }
        assertTrue(handshake.get(), "Provisioning must await actual business readiness");
        assertEquals(!timeout, durableStates.contains("READY"));
    }
}
