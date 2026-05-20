package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.List;
import java.util.Map;
import java.time.OffsetDateTime;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

class SandboxServiceTest {

    @Test
    void sandboxInfo_hydratesGatewayTokenFromCachedEndpoint() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        SandboxInfo cached = SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .userCode("user001")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .build();
        when(sandboxMetadataCache.listByUser("user001")).thenReturn(List.of(cached));

        List<SandboxInfo> result = sandboxService.sandboxInfo("user001");

        assertThat(result).hasSize(1);
        assertThat(result.get(0).getGatewayToken()).isEqualTo("0123456789abcdef0123456789abcdef");
    }

    @Test
    void renewSandbox_refreshesHeartbeatAndRemoteLease() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SandboxLaunchContextFactory sandboxLaunchContextFactory = mock(SandboxLaunchContextFactory.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "sandboxLaunchContextFactory", sandboxLaunchContextFactory);
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "renewAheadSeconds", 120L);

        SandboxLaunchRouting routing = new SandboxLaunchRouting("openclaw", SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        when(sandboxLaunchContextFactory.resolveRouting(123L)).thenReturn(routing);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setUserCode("user001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setStatus("RUNNING");
        record.setSandboxId("sandbox-1");
        record.setEndpoint("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef");
        record.setTimeoutSeconds(600);
        record.setLockVersion(3);
        record.setVersion(1);
        record.setCreateTime(new Date());
        when(sandboxRecordMapper.selectRunningByUserAndResource("user001", "openclaw",
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID)).thenReturn(record);
        when(sandboxRecordMapper.updateLastAccessTime(eq(1L), any(Date.class), eq(3))).thenReturn(1);
        when(sandboxLifecycleFacade.renewSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        when(sandboxRecordMapper.updateRenewSuccess(eq(1L), any(Date.class), any(Date.class), any(Date.class), eq(4)))
            .thenReturn(1);

        SandboxInfo result = sandboxService.renewSandbox("user001", 123L);

        assertThat(result).isNotNull();
        assertThat(result.getSandboxId()).isEqualTo("sandbox-1");
        assertThat(result.getGatewayToken()).isEqualTo("0123456789abcdef0123456789abcdef");
        assertThat(result.getRemoteExpiresAt()).isNotNull();
        verify(sandboxLifecycleFacade).renewSandbox(any(SandboxInfo.class));
        verify(sandboxMetadataCache).put(any(SandboxInfo.class));
    }

    @Test
    void buildLaunchData_normalizesEndpointWithPersistedGatewayToken() {
        SandboxService sandboxService = new SandboxService();
        SsSandboxRecord record = new SsSandboxRecord();
        record.setEndpoint("http://host/proxy/18789/chat?token=stale-token");
        record.setGatewayToken("persisted-token");
        record.setSandboxId("sandbox-1");

        com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData result =
            ReflectionTestUtils.invokeMethod(sandboxService, "buildLaunchData", record);

        assertThat(result).isNotNull();
        assertThat(result.getEndpoint()).isEqualTo("http://host/proxy/18789/chat?token=persisted-token");
        assertThat(result.getEndpoints())
            .containsExactly("http://host/proxy/18789/chat?token=persisted-token");
    }

    @Test
    void resolveLaunchGatewayToken_prefersHistoricalSandboxBinding() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        SsSandboxRecord historical = new SsSandboxRecord();
        historical.setSandboxId("sandbox-1");
        historical.setGatewayToken("persisted-token");
        when(sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1")).thenReturn(historical);

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "resolveLaunchGatewayToken",
            "user001", "openclaw", "sandbox-1", "fresh-token");

        assertThat(result).isEqualTo("persisted-token");
    }

    @Test
    void reconcileRecordWithRemote_overridesGatewayBindingFromRemoteMetadata() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setStatus("RUNNING");
        record.setUserCode("user001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setEndpoint("http://host/proxy/18789/chat?token=stale-token");
        record.setGatewayToken("stale-token");
        record.setTimeoutSeconds(600);
        record.setLockVersion(3);
        record.setVersion(1);
        Date createdAt = new Date();
        record.setCreateTime(createdAt);

        SandboxRuntimeInstance remoteInstance = SandboxRuntimeInstance.builder()
            .sandboxId("sandbox-1")
            .state("running")
            .createdAt(OffsetDateTime.parse("2026-05-20T08:00:00Z"))
            .expiresAt(OffsetDateTime.parse("2026-05-20T08:10:00Z"))
            .metadata(Map.of("gateway_token", "persisted-token"))
            .build();

        when(sandboxRecordMapper.updateReconcileSuccess(eq(1L), eq("RUNNING"),
            eq("http://host/proxy/18789/chat?token=persisted-token"), eq("persisted-token"),
            any(Date.class), any(Date.class), eq(600), any(Date.class), any(Date.class), eq(3))).thenReturn(1);

        ReflectionTestUtils.invokeMethod(sandboxService, "reconcileRecordWithRemote", record, remoteInstance);

        assertThat(record.getGatewayToken()).isEqualTo("persisted-token");
        assertThat(record.getEndpoint()).isEqualTo("http://host/proxy/18789/chat?token=persisted-token");
    }
}
