package com.iwhalecloud.byai.gateway.sandbox.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxDetail;
import com.iwhalecloud.byai.gateway.sandbox.client.model.SandboxStatus;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class TenantSandboxRecoveryTest {
    @Test void strictMetadataAndConnectionEvidenceAreRequiredForAdoption() {
        var client=mock(OpenSandboxClient.class);var records=mock(SsSandboxRecordMapper.class);
        var service=new TenantSandboxService(mock(SandboxLifecycleFacade.class),client,mock(SandboxServiceSpecRepository.class),
            records,new ObjectMapper(),"/tmp","redis","6379","0","default","password","http://be","token","node");
        var remote=new SandboxDetail();remote.setId("original");
        var status=new SandboxStatus();status.setState("Running");remote.setStatus(status);
        remote.setMetadata(Map.of("enterpriseId","7","ownerScope","TENANT","serviceKey","tenant-opengauss",
            "providerRequestKey","command-6:DB_CREATE","recordId","8"));
        when(client.recoveryInventory(anyMap())).thenReturn(List.of(remote));
        assertEquals("RESOURCE_CONNECTION_DATA_UNAVAILABLE",service.inspectRecovery(7,"DB_CREATE","command-6:DB_CREATE").reasonCode());
        var row=new SsSandboxRecord();row.setId(8L);row.setEnterpriseId(7L);row.setResourceId(7L);row.setSandboxType("tenant-opengauss");row.setOwnerScope("TENANT");row.setServiceType("tenant-opengauss");
        row.setLockVersion(0);row.setSandboxId("original");row.setEndpoint("tcp://db:5432");row.setStatus("RUNNING");
        when(records.selectActiveTenantByResourceAndType(7L,"tenant-opengauss")).thenReturn(row);
        assertEquals("MATCHED",service.inspectRecovery(7,"DB_CREATE","command-6:DB_CREATE").reasonCode());
        assertEquals("RESOURCE_IDENTITY_MISMATCH",service.inspectRecovery(7,"DB_CREATE","command-99:DB_CREATE").reasonCode());
        when(client.recoveryInventory(anyMap())).thenReturn(List.of(remote,remote));
        assertEquals("MULTIPLE_PROVIDER_RESOURCES",service.inspectRecovery(7,"DB_CREATE","command-6:DB_CREATE").reasonCode());
        when(client.recoveryInventory(anyMap())).thenThrow(new OpenSandboxClient.OpenSandboxException("PROVIDER_QUERY_DISABLED"));
        assertEquals("PROVIDER_QUERY_DISABLED",service.inspectRecovery(7,"DB_CREATE","command-6:DB_CREATE").reasonCode());
    }
    @Test void filePreparationFailureIsPositiveNonCreationEvidence(@org.junit.jupiter.api.io.TempDir java.nio.file.Path root) throws Exception {
        var lifecycle=mock(SandboxLifecycleFacade.class);var specs=mock(SandboxServiceSpecRepository.class);
        var spec=new com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec();spec.setOwnerScope("TENANT");
        spec.setResourceLimits(Map.of("cpu","1","memory","1Gi"));
        when(specs.findByServiceKeyAndProfile("tenant-opengauss","s")).thenReturn(java.util.Optional.of(spec));
        var impossibleRoot=root.resolve("file");java.nio.file.Files.writeString(impossibleRoot,"not a directory");
        var service=new TenantSandboxService(lifecycle,mock(OpenSandboxClient.class),specs,mock(SsSandboxRecordMapper.class),
            new ObjectMapper(),impossibleRoot.toString(),"redis","6379","0","default","password","http://be","token","node");
        var failure=assertThrows(com.iwhalecloud.byai.manager.domain.tenant.integration.TenantCommandException.class,
            ()->service.launchOpenGauss(7,"s","byclaw_t_7","bc_t_7_admin","password","command-6:DB_CREATE"));
        assertEquals("PROVIDER_NOT_CALLED_FILE_PREPARATION",failure.getMessage());assertNotNull(failure.getCause());
        verifyNoInteractions(lifecycle);
    }

}
