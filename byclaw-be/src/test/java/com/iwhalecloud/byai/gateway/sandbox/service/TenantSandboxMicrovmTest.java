package com.iwhalecloud.byai.gateway.sandbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class TenantSandboxMicrovmTest {
    @Test void repeatedLaunchReusesHealthyMicrovmDatabaseWithoutRetiringItsRecord() {
        var records=mock(SsSandboxRecordMapper.class);
        var lifecycle=mock(SandboxLifecycleFacade.class);
        var specs=mock(SandboxServiceSpecRepository.class);
        var record=new SsSandboxRecord();record.setId(31L);record.setStatus("RUNNING");
        record.setUserCode("tenant-42");record.setSandboxType("tenant-opengauss");record.setServiceType("tenant-opengauss");
        record.setSandboxId("microvm--cn-beijing--sbx-fixture");
        record.setEndpoint("https://15432-sbx-fixture.cn-beijing-vpc.sandbox.aliyuncs.com");
        when(records.selectActiveTenantByResourceAndType(42L,"tenant-opengauss")).thenReturn(record);
        when(lifecycle.getSandbox(any())).thenReturn(SandboxResponse.success(SandboxRuntimeInstance.builder()
            .sandboxId(record.getSandboxId()).state("running").build()));
        var service=new TenantSandboxService(lifecycle,mock(OpenSandboxClient.class),specs,records,new ObjectMapper(),
            "/workspace","redis","6379","0","default","fixture","http://be","token","");
        for(int attempt=0;attempt<2;attempt++) {
            var result=service.launchOpenGauss(42L,"s","byclaw_t_42","bc_t_42_admin","fixture");
            assertEquals(31L,result.recordId());assertEquals(record.getSandboxId(),result.sandboxId());
        }
        verify(lifecycle,never()).launchSandbox(any());
        verify(records,never()).updateStatusToFailed(anyLong(),anyString(),any(),anyInt());
        verify(records,never()).insert(any());
        verifyNoInteractions(specs);
    }

    @Test void clusterLaunchPassesCommonEnvironmentWithoutRequiringStandaloneHost() {
        var records=mock(SsSandboxRecordMapper.class);var lifecycle=mock(SandboxLifecycleFacade.class);
        var specs=mock(SandboxServiceSpecRepository.class);
        var service=new TenantSandboxService(lifecycle,mock(OpenSandboxClient.class),specs,records,new ObjectMapper(),
            "/workspace","","6379","0","default","fixture","http://be","token","");
        ReflectionTestUtils.setField(service,"redisMode","cluster");
        ReflectionTestUtils.setField(service,"redisClusterHost","redis-a:6379,redis-b:6379");
        var spec=new com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec();
        spec.setOwnerScope("TENANT");spec.setResourceLimits(java.util.Map.of("cpu","1","memory","2Gi"));
        when(specs.findByServiceKeyAndProfile("tenant-data-node","s")).thenReturn(java.util.Optional.of(spec));
        var tenants=mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper.class);
        ReflectionTestUtils.setField(service,"tenantPolicyConfigs",tenants);
        when(tenants.selectConfigs(42L)).thenReturn(java.util.List.of());
        doAnswer(invocation->{invocation.<SsSandboxRecord>getArgument(0).setId(32L);return 1;}).when(records).insert(any());
        assertThrows(org.springframework.web.server.ResponseStatusException.class,()->service.launchDataNode(42L,"s",31L,1L));
        var request=org.mockito.ArgumentCaptor.forClass(com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest.class);
        verify(lifecycle).launchSandbox(request.capture());
        assertEquals("cluster",request.getValue().getEnvs().get("REDIS_MODE"));
        assertEquals("redis-a:6379,redis-b:6379",request.getValue().getEnvs().get("REDIS_CLUSTER_HOST"));
        assertEquals("",request.getValue().getEnvs().get("REDIS_HOST"));
        assertTrue(request.getValue().getEnvs().keySet().stream().noneMatch(k->k.startsWith("BYCLAW_TENANT_REDIS_")));
    }
}
