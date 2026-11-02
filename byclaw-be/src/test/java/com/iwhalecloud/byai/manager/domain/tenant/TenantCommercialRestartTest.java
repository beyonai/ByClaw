package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import java.util.ArrayList;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.web.server.ResponseStatusException;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** 商业租户维修重启保留资源身份与删除保护。 @author Codex @since 2026-10-29 */
class TenantCommercialRestartTest {
    @ParameterizedTest
    @CsvSource({"tenant-opengauss,RUNNING", "tenant-opengauss,FAILED",
        "tenant-data-node,RUNNING", "tenant-data-node,FAILED"})
    void acceptsCommercialRestartForCurrentRestartableResource(String type, String status) {
        var tenants = mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(42L, "COMMERCIAL_MANAGED")).thenReturn("true");
        var sandboxes = mock(TenantSandboxService.class);
        var record = new SsSandboxRecord();
        record.setId(7L);
        record.setStatus(status);
        when(sandboxes.latestRecord(42L, type)).thenReturn(record);
        // 只验证接口受理边界，队列中的真实 Provider 操作不在单元测试里执行。
        var queued = new ArrayList<Runnable>();
        var service = new TenantDbProvisioningService(tenants, sandboxes, null, null, null, null,
            null, new ObjectMapper(), queued::add, "");

        service.requestRestart(42L, type, 7L);

        assertEquals(1, queued.size());
    }

    @ParameterizedTest
    @CsvSource({"true,7,RUNNING,tenant.deletion.inProgress",
        "false,8,RUNNING,tenant.sandbox.notRestartable",
        "false,7,RELEASED,tenant.sandbox.notRestartable"})
    void rejectsDeletingOrStaleCommercialResource(String deleting, long recordId, String status, String reason) {
        var tenants = mock(TenantAdminTenantMapper.class);
        when(tenants.selectConfig(42L, "COMMERCIAL_MANAGED")).thenReturn("true");
        when(tenants.selectConfig(42L, "TENANT_DELETE_REQUESTED")).thenReturn(deleting);
        var sandboxes = mock(TenantSandboxService.class);
        var record = new SsSandboxRecord();
        record.setId(recordId);
        record.setStatus(status);
        when(sandboxes.latestRecord(42L, "tenant-data-node")).thenReturn(record);
        var queued = new ArrayList<Runnable>();
        var service = new TenantDbProvisioningService(tenants, sandboxes, null, null, null, null,
            null, new ObjectMapper(), queued::add, "");

        var error = assertThrows(ResponseStatusException.class,
            () -> service.requestRestart(42L, "tenant-data-node", 7L));

        assertEquals(reason, error.getReason());
        assertEquals(0, queued.size());
    }
}
