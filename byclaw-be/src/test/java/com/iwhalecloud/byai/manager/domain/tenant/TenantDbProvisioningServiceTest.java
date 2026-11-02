package com.iwhalecloud.byai.manager.domain.tenant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.concurrent.atomic.AtomicInteger;

import org.junit.jupiter.api.Test;

class TenantDbProvisioningServiceTest {

    private static final String SANDBOX_ID = "803cfd04-ca9f-44f5-b2e1-85d8afeae0b2";

    @Test
    void privateMicrovmDatabaseEndpointUsesTlsGatewayWithoutBecomingNativeTcp() {
        String endpoint="https://15432-sbx-test.cn-beijing-vpc.sandbox.aliyuncs.com";
        var parsed=TenantDbProvisioningService.parseEndpoint(endpoint,"microvm--cn-beijing--sbx-test");
        assertEquals("15432-sbx-test.cn-beijing-vpc.sandbox.aliyuncs.com",parsed.host());
        assertEquals(443,parsed.port());
        assertThrows(IllegalArgumentException.class,()->TenantDbProvisioningService.parseEndpoint(
            "https://15432-sbx-test.cn-beijing.sandbox.aliyuncs.com","microvm--cn-beijing--sbx-test"));
        assertThrows(IllegalArgumentException.class,()->PrivateDatabaseSocketFactory.privateUrl(
            "wss://15432-sbx-test.cn-beijing.sandbox.aliyuncs.com/postgresql"));
    }

    @Test
    void renewsExpiredReadyLeaseWithoutChangingAuthorityVersions() throws Exception {
        verifyLeaseRenewal(false, true);
    }

    @Test
    void deletionRequestedTenantNeverRenewsItsLease() throws Exception {
        verifyLeaseRenewal(true, false);
    }

    @Test
    void concurrentStateChangePreventsPublishingStaleReadyLease() throws Exception {
        verifyLeaseRenewal(false, false);
    }

    private void verifyLeaseRenewal(boolean deleting, boolean expectedPublish) throws Exception {
        var tenants = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper.class);
        var publisher = org.mockito.Mockito.mock(TenantConfigPublisher.class);
        var redis = org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        var values = org.mockito.Mockito.mock(org.springframework.data.redis.core.ValueOperations.class);
        org.mockito.Mockito.when(redis.opsForValue()).thenReturn(values);
        org.mockito.Mockito.when(values.setIfAbsent(org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(java.time.Duration.class))).thenReturn(true);
        var row = new com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow();
        row.setEnterpriseId(42L);
        org.mockito.Mockito.when(tenants.selectTenants(null, null, null, "createdAt", "asc")).thenReturn(java.util.List.of(row));
        org.mockito.Mockito.when(tenants.selectConfig(42L, "TENANT_DELETE_REQUESTED")).thenReturn(deleting ? "true" : null);
        var config = new com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow();
        config.setParamsCode("PROVISION_STATE");
        config.setParamsValue("{\"status\":\"READY\",\"generation\":\"7\",\"fencingToken\":\"9\",\"leaseUntil\":\"2000-01-01T00:00:00Z\"}");
        org.mockito.Mockito.when(tenants.selectConfigs(42L)).thenReturn(java.util.List.of(config));
        org.mockito.Mockito.when(tenants.renewReadyLease(org.mockito.ArgumentMatchers.eq(42L),
            org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString())).thenReturn(expectedPublish ? 1 : 0);
        org.mockito.Mockito.when(publisher.publish(org.mockito.ArgumentMatchers.eq(42L), org.mockito.ArgumentMatchers.anyMap())).thenReturn(true);
        var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
        var service = new TenantDbProvisioningService(tenants, null, null, publisher, null, null, redis, mapper, Runnable::run, "");
        var renew = TenantDbProvisioningService.class.getDeclaredMethod("renewReadyLeases");
        renew.invoke(service);
        if (expectedPublish) {
            var captured = org.mockito.ArgumentCaptor.forClass(java.util.Map.class);
            org.mockito.Mockito.verify(publisher).publish(org.mockito.ArgumentMatchers.eq(42L), captured.capture());
            var state = mapper.readTree((String) captured.getValue().get("PROVISION_STATE"));
            assertEquals("READY", state.path("status").asText());
            assertEquals("7", state.path("generation").asText());
            assertEquals("9", state.path("fencingToken").asText());
            assertTrue(java.time.Instant.parse(state.path("leaseUntil").asText()).isAfter(java.time.Instant.now()));
        } else {
            org.mockito.Mockito.verifyNoInteractions(publisher);
            org.mockito.Mockito.verify(tenants, org.mockito.Mockito.never()).updateConfig(
                org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString());
        }
    }

    @Test
    void idleCommercialTenantRenewsTechnicalReadLeaseWithoutReopeningBusiness() throws Exception {
        var tenants = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper.class);
        var publisher = org.mockito.Mockito.mock(TenantConfigPublisher.class);
        var commands = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.domain.tenant.integration.TenantCommandStore.class);
        var redis = org.mockito.Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class);
        var values = org.mockito.Mockito.mock(org.springframework.data.redis.core.ValueOperations.class);
        org.mockito.Mockito.when(redis.opsForValue()).thenReturn(values);
        org.mockito.Mockito.when(values.setIfAbsent(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any(java.time.Duration.class))).thenReturn(true);
        var row = new com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow(); row.setEnterpriseId(42L);
        org.mockito.Mockito.when(tenants.selectTenants(null, null, null, "createdAt", "asc")).thenReturn(java.util.List.of(row));
        org.mockito.Mockito.when(tenants.selectConfig(42L,"COMMERCIAL_MANAGED")).thenReturn("true");
        org.mockito.Mockito.when(commands.canRenewTechnicalLease(42L)).thenReturn(true);
        var config = new com.iwhalecloud.byai.manager.mapper.tenant.TenantConfigRow();
        config.setParamsCode("PROVISION_STATE");
        config.setParamsValue("{\"status\":\"READY\",\"generation\":\"1\",\"fencingToken\":\"2\",\"leaseUntil\":\"2000-01-01T00:00:00Z\",\"commandLeaseUntilEpochSeconds\":\"1\"}");
        org.mockito.Mockito.when(tenants.selectConfigs(42L)).thenReturn(java.util.List.of(config));
        org.mockito.Mockito.when(tenants.renewReadyLease(org.mockito.ArgumentMatchers.eq(42L),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString())).thenReturn(1);
        org.mockito.Mockito.when(publisher.publish(org.mockito.ArgumentMatchers.eq(42L),org.mockito.ArgumentMatchers.anyMap())).thenReturn(true);
        var service = new TenantDbProvisioningService(tenants,null,null,publisher,null,null,redis,new com.fasterxml.jackson.databind.ObjectMapper(),Runnable::run,"");
        service.setCommercialCommands(commands);
        service.renewReadyLeases();
        var captured = org.mockito.ArgumentCaptor.forClass(java.util.Map.class);
        org.mockito.Mockito.verify(publisher).publish(org.mockito.ArgumentMatchers.eq(42L),captured.capture());
        var state = new com.fasterxml.jackson.databind.ObjectMapper().readTree((String) captured.getValue().get("PROVISION_STATE"));
        assertEquals("READY",state.path("status").asText());
        assertTrue(state.path("commandLeaseUntilEpochSeconds").isMissingNode());
        org.mockito.Mockito.reset(publisher);
        org.mockito.Mockito.when(commands.canRenewTechnicalLease(42L)).thenReturn(false);
        service.renewReadyLeases();
        org.mockito.Mockito.verifyNoInteractions(publisher);
    }

    @Test
    void retriesTransientDatabaseStartupFailure() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        TenantDbProvisioningService.retryConnectionProbe(() -> {
            if (calls.incrementAndGet() < 3) throw new IllegalStateException("starting");
        }, 4, 0);
        assertEquals(3, calls.get());
    }

    @Test
    void retainsLastFailureWithoutSleepingAfterFinalAttempt() {
        AtomicInteger calls = new AtomicInteger();
        IllegalStateException cause = new IllegalStateException("not ready");
        IllegalStateException result = assertThrows(IllegalStateException.class,
            () -> TenantDbProvisioningService.retryConnectionProbe(() -> {
                calls.incrementAndGet();
                throw cause;
            }, 3, 0));
        assertEquals(3, calls.get());
        assertSame(cause, result.getCause());
    }

    @Test
    void dockerProxyEndpointUsesDatabaseContainerAddress() {
        TenantDbProvisioningService.HostPort endpoint = TenantDbProvisioningService.parseEndpoint(
            "tcp://192.168.0.83:57571/proxy/5432", SANDBOX_ID);

        assertEquals("sandbox-" + SANDBOX_ID, endpoint.host());
        assertEquals(5432, endpoint.port());
    }

    @Test
    void dockerProxyEndpointInJsonRecordUsesDatabaseContainerAddress() {
        TenantDbProvisioningService.HostPort endpoint = TenantDbProvisioningService.parseEndpoint(
            "{\"openclaw\":\"tcp://192.168.0.83:57571/proxy/5432\"}", SANDBOX_ID);

        assertEquals("sandbox-" + SANDBOX_ID, endpoint.host());
        assertEquals(5432, endpoint.port());
    }

    @Test
    void directTcpEndpointKeepsItsHostAndPort() {
        TenantDbProvisioningService.HostPort endpoint = TenantDbProvisioningService.parseEndpoint(
            "tcp://db.internal:15432", SANDBOX_ID);

        assertEquals("db.internal", endpoint.host());
        assertEquals(15432, endpoint.port());
    }

    @Test
    void unexpectedEndpointPathIsRejected() {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
            () -> TenantDbProvisioningService.parseEndpoint(
                "tcp://192.168.0.83:57571/other/5432", SANDBOX_ID));
        assertTrue(error.getMessage().contains("unsupported path"));
    }
}
