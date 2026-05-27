package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.OffsetDateTime;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SandboxServiceTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

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
        record.setEndpoint("{\"openclaw\":\"http://host/proxy/18789/chat?token=stale-token\",\"ui\":\"http://host/proxy/3000?token=stale-token\"}");
        record.setGatewayToken("persisted-token");
        record.setSandboxId("sandbox-1");

        com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData result =
            ReflectionTestUtils.invokeMethod(sandboxService, "buildLaunchData", record);

        assertThat(result).isNotNull();
        assertThat(result.getEndpoint()).isEqualTo("http://host/proxy/18789/chat?token=persisted-token");
        assertThat(result.getEndpoints())
            .containsExactly("http://host/proxy/18789/chat?token=persisted-token");
        assertThat(result.getInstanceEndpoints())
            .containsEntry("openclaw", "http://host/proxy/18789/chat?token=persisted-token")
            .containsEntry("ui", "http://host/proxy/3000?token=persisted-token");
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
            eq("{\"openclaw\":\"http://host/proxy/18789/chat?token=persisted-token\"}"), eq("persisted-token"),
            any(Date.class), any(Date.class), eq(600), any(Date.class), any(Date.class), eq(3))).thenReturn(1);

        ReflectionTestUtils.invokeMethod(sandboxService, "reconcileRecordWithRemote", record, remoteInstance);

        assertThat(record.getGatewayToken()).isEqualTo("persisted-token");
        assertThat(record.getEndpoint()).isEqualTo(
            "{\"openclaw\":\"http://host/proxy/18789/chat?token=persisted-token\"}");
    }

    @Test
    void reconcileRecordWithRemote_preservesMalformedJsonEndpoint() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        String malformedEndpoint = "{\"openclaw\":\"{\\\"openclaw\\\":\\\"http://host/proxy/18789/chat?token=stale-token";
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setStatus("RUNNING");
        record.setUserCode("user001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setEndpoint(malformedEndpoint);
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

        when(sandboxRecordMapper.updateReconcileSuccess(eq(1L), eq("RUNNING"), eq(malformedEndpoint),
            eq("persisted-token"), any(Date.class), any(Date.class), eq(600), any(Date.class), any(Date.class),
            eq(3))).thenReturn(1);

        ReflectionTestUtils.invokeMethod(sandboxService, "reconcileRecordWithRemote", record, remoteInstance);

        assertThat(record.getEndpoint()).isEqualTo(malformedEndpoint);
        assertThat(record.getGatewayToken()).isEqualTo("persisted-token");
    }

    @Test
    void reconcileRecordWithRemote_preservesConfiguredTimeoutWhenRemoteExpirationExpands() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setStatus("RUNNING");
        record.setUserCode("user001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setEndpoint("http://host/proxy/18789/chat?token=token");
        record.setGatewayToken("token");
        record.setTimeoutSeconds(600);
        record.setLockVersion(3);
        record.setVersion(1);
        record.setCreateTime(new Date());

        SandboxRuntimeInstance remoteInstance = SandboxRuntimeInstance.builder()
            .sandboxId("sandbox-1")
            .state("running")
            .createdAt(OffsetDateTime.parse("2026-05-20T08:00:00Z"))
            .expiresAt(OffsetDateTime.parse("2026-05-20T09:00:00Z"))
            .metadata(Map.of("gateway_token", "token"))
            .build();

        when(sandboxRecordMapper.updateReconcileSuccess(eq(1L), eq("RUNNING"),
            eq("{\"openclaw\":\"http://host/proxy/18789/chat?token=token\"}"), eq("token"),
            any(Date.class), any(Date.class), eq(600), any(Date.class), any(Date.class), eq(3))).thenReturn(1);

        ReflectionTestUtils.invokeMethod(sandboxService, "reconcileRecordWithRemote", record, remoteInstance);

        assertThat(record.getTimeoutSeconds()).isEqualTo(600);
    }

    @Test
    void reconcileSandboxes_restartsMissingRemoteSandboxWithUserContext() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        LoginApplicationService loginApplicationService = mock(LoginApplicationService.class);
        SandboxUserContextRunner sandboxUserContextRunner = new SandboxUserContextRunner(loginApplicationService);
        SandboxService sandboxService = spy(new SandboxService());
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "sandboxUserContextRunner", sandboxUserContextRunner);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setUserCode("user001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setStatus("RUNNING");
        record.setSandboxId("sandbox-old");
        record.setEndpoint("http://host/proxy/18789/chat?token=old-token");
        record.setGatewayToken("old-token");
        record.setTimeoutSeconds(600);
        record.setLockVersion(0);
        record.setVersion(1);
        record.setCreateTime(new Date());
        record.setLastAccessTime(new Date());

        LoginInfo dbLoginInfo = new LoginInfo();
        dbLoginInfo.setUserCode("user001");
        dbLoginInfo.setUserName("User One");
        when(loginApplicationService.getLoginInfo("user001")).thenReturn(dbLoginInfo);
        when(sandboxRecordMapper.countReconcileSandboxes()).thenReturn(1);
        when(sandboxRecordMapper.selectReconcileSandboxesPage(isNull(), isNull(), eq(1)))
            .thenReturn(List.of(record));
        when(sandboxLifecycleFacade.getSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        when(sandboxRecordMapper.markReleased(eq(1L), eq("idle-timeout"), any(Date.class), eq(0))).thenReturn(1);

        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-new");
        launchData.setEndpoint("http://host/proxy/18789/chat?token=new-token");
        doAnswer(invocation -> {
            assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(dbLoginInfo);
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("user001");
            assertThat(CurrentUserHolder.getCurrentUserName()).isEqualTo("User One");
            return launchData;
        }).when(sandboxService).launchSandbox("user001", SandboxLaunchRouting.DEFAULT_RESOURCE_ID);

        SandboxLifecycleJobReport report = sandboxService.reconcileSandboxes();

        assertThat(report.getAffectedCount()).isEqualTo(1);
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(loginApplicationService).getLoginInfo("user001");
        verify(sandboxService).launchSandbox("user001", SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
    }

}
