package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.OffsetDateTime;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimePage;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.sandbox.SandboxReconcileGroup;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
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
        when(sandboxLaunchContextFactory.resolveRouting(123L, "user001")).thenReturn(routing);

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
    void buildLaunchMetadata_preservesResourceIdSemanticsAndAddsLabelSafeResourceKey() {
        SandboxService sandboxService = new SandboxService();
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(12L);
        record.setUserCode("0027019281");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);

        Map<String, String> metadata = ReflectionTestUtils.invokeMethod(sandboxService, "buildLaunchMetadata", record);

        assertThat(metadata)
            .doesNotContainKey("resourceId")
            .containsEntry("resourceKey", "openclaw_-1")
            .containsEntry("recordId", "12");
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
    void doLaunchSandbox_continuesWhenModelEnvsMissing() {
        SandboxLaunchContextFactory sandboxLaunchContextFactory = mock(SandboxLaunchContextFactory.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService systemConfigService =
            mock(com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxLaunchContextFactory", sandboxLaunchContextFactory);
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "byaiSystemConfigService", systemConfigService);

        SandboxLaunchRouting routing = new SandboxLaunchRouting("openclaw",
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        Map<String, String> envs = Map.of(
            "MODEL_BASE_URL", "https://model.example",
            "MODEL_ID", "glm-5.1",
            "MODEL_NAME", "glm-5.1",
            "MODEL_ALIAS", "glm-5.1"
        );
        SandboxLaunchContext launchContext = new SandboxLaunchContext("openclaw", envs, Map.of(), "gateway-token");
        when(sandboxLaunchContextFactory.buildContext("user001", 100L, "openclaw")).thenReturn(launchContext);
        doAnswer(invocation -> {
            SsSandboxRecord record = invocation.getArgument(0);
            record.setId(99L);
            return 1;
        }).when(sandboxRecordMapper).insert(any(SsSandboxRecord.class));
        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-1");
        launchData.setEndpoint("http://host/proxy/18789/chat?token=gateway-token");
        when(sandboxLifecycleFacade.launchSandbox(any())).thenReturn(SandboxResponse.success(launchData));
        when(sandboxRecordMapper.updateLaunchSuccess(eq(99L), eq("sandbox-1"), any(), eq("gateway-token"),
            any(), any(), any(), any(), any(), eq(0))).thenReturn(1);

        SandboxLaunchData result = ReflectionTestUtils.invokeMethod(sandboxService, "doLaunchSandbox",
            "user001", 100L, routing);

        assertThat(result).isNotNull();
        assertThat(result.getSandboxId()).isEqualTo("sandbox-1");
        verify(sandboxRecordMapper).insert(any(SsSandboxRecord.class));
        verify(sandboxRecordMapper, never()).updateStatusToFailed(any(), any(), any(), any());
        verify(sandboxLifecycleFacade).launchSandbox(any());
    }

    @Test
    void heartbeat_refreshesAllRunningSandboxesForCurrentUser() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxHealthWatchService sandboxHealthWatchService = mock(SandboxHealthWatchService.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "sandboxHealthWatchService", sandboxHealthWatchService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsSandboxRecord openclawRecord = new SsSandboxRecord();
        openclawRecord.setId(1L);
        openclawRecord.setUserCode("user001");
        openclawRecord.setSandboxType("openclaw");
        openclawRecord.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        openclawRecord.setStatus("RUNNING");
        openclawRecord.setSandboxId("sandbox-openclaw");
        openclawRecord.setLockVersion(3);
        openclawRecord.setVersion(1);

        SsSandboxRecord codeAgentRecord = new SsSandboxRecord();
        codeAgentRecord.setId(2L);
        codeAgentRecord.setUserCode("user001");
        codeAgentRecord.setSandboxType("byclaw-code-agent");
        codeAgentRecord.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        codeAgentRecord.setStatus("RUNNING");
        codeAgentRecord.setSandboxId("sandbox-code-agent");
        codeAgentRecord.setLockVersion(7);
        codeAgentRecord.setVersion(2);

        when(sandboxRecordMapper.selectRunningByUser("user001"))
            .thenReturn(List.of(openclawRecord, codeAgentRecord));
        when(sandboxRecordMapper.updateLastAccessTime(eq(1L), any(Date.class), eq(3))).thenReturn(1);
        when(sandboxRecordMapper.updateLastAccessTime(eq(2L), any(Date.class), eq(7))).thenReturn(1);

        boolean result = sandboxService.heartbeat(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);

        assertThat(result).isTrue();
        assertThat(openclawRecord.getLastAccessTime()).isNotNull();
        assertThat(codeAgentRecord.getLastAccessTime()).isNotNull();
        verify(sandboxRecordMapper).selectRunningByUser("user001");
        verify(sandboxRecordMapper).updateLastAccessTime(eq(1L), any(Date.class), eq(3));
        verify(sandboxRecordMapper).updateLastAccessTime(eq(2L), any(Date.class), eq(7));
        verify(sandboxMetadataCache, times(2)).put(any(SandboxInfo.class));
        verify(sandboxHealthWatchService).touch("user001", "openclaw");
        verify(sandboxHealthWatchService).touch("user001", "byclaw-code-agent");
    }

    @Test
    void heartbeatOpenclawSandbox_refreshesOnlyOpenclawRunningSandboxes() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxHealthWatchService sandboxHealthWatchService = mock(SandboxHealthWatchService.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "sandboxHealthWatchService", sandboxHealthWatchService);

        SsSandboxRecord openclawRecord = new SsSandboxRecord();
        openclawRecord.setId(1L);
        openclawRecord.setUserCode("user001");
        openclawRecord.setSandboxType("openclaw");
        openclawRecord.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        openclawRecord.setStatus("RUNNING");
        openclawRecord.setSandboxId("sandbox-openclaw");
        openclawRecord.setLockVersion(3);
        openclawRecord.setVersion(1);

        when(sandboxRecordMapper.selectRunningByUserAndSandboxType("user001", "openclaw"))
            .thenReturn(List.of(openclawRecord));
        when(sandboxRecordMapper.updateLastAccessTime(eq(1L), any(Date.class), eq(3))).thenReturn(1);

        boolean result = sandboxService.heartbeatOpenclawSandbox("user001");

        assertThat(result).isTrue();
        assertThat(openclawRecord.getLastAccessTime()).isNotNull();
        verify(sandboxRecordMapper).selectRunningByUserAndSandboxType("user001", "openclaw");
        verify(sandboxRecordMapper).updateLastAccessTime(eq(1L), any(Date.class), eq(3));
        verify(sandboxRecordMapper, never()).selectRunningByUser("user001");
        verify(sandboxMetadataCache).put(any(SandboxInfo.class));
        verify(sandboxHealthWatchService).touch("user001", "openclaw");
    }

    @Test
    void removeSandbox_recordsManualReleaseReasonWithCurrentOperator() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        LoginInfo operator = new LoginInfo();
        operator.setUserCode("operator001");
        CurrentUserHolder.setLoginInfo(operator);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setUserCode("owner001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setStatus("RUNNING");
        record.setLockVersion(3);

        when(sandboxRecordMapper.selectRunningByUserAndResources(eq("owner001"), isNull(), eq(List.of())))
            .thenReturn(List.of(record));
        when(sandboxRecordMapper.markReleasing(eq(1L), eq("release.manual:operator001"), any(Date.class), eq(3)))
            .thenReturn(0);

        sandboxService.removeSandbox("owner001", null);

        verify(sandboxRecordMapper).markReleasing(eq(1L), eq("release.manual:operator001"), any(Date.class), eq(3));
        verify(sandboxRecordMapper, never()).updateStatusToReleased(any(), any(), any(), any());
    }

    @Test
    void removeSandboxById_recordsManualReleaseReasonWithCurrentOperator() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        LoginInfo operator = new LoginInfo();
        operator.setUserCode("admin001");
        CurrentUserHolder.setLoginInfo(operator);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setUserCode("owner001");
        record.setSandboxType("openclaw");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setStatus("STARTING");
        record.setLockVersion(5);

        when(sandboxRecordMapper.selectById(1L)).thenReturn(record);
        when(sandboxRecordMapper.markStartingReleased(eq(1L), eq("release.manual:admin001"), any(Date.class), eq(5)))
            .thenReturn(0);

        sandboxService.removeSandboxById(1L);

        verify(sandboxRecordMapper).markStartingReleased(eq(1L), eq("release.manual:admin001"), any(Date.class), eq(5));
        verify(sandboxRecordMapper, never()).markReleasing(any(), any(), any(), any());
    }

    @Test
    void cleanupRemoteSandboxQuietly_removesRemoteBySandboxId() {
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        when(sandboxLifecycleFacade.removeSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        ArgumentCaptor<SandboxInfo> sandboxInfoCaptor = ArgumentCaptor.forClass(SandboxInfo.class);

        sandboxService.cleanupRemoteSandboxQuietly("user001", "openclaw", "sandbox-old", "test-cleanup");

        verify(sandboxLifecycleFacade).removeSandbox(sandboxInfoCaptor.capture());
        assertThat(sandboxInfoCaptor.getValue().getUserCode()).isEqualTo("user001");
        assertThat(sandboxInfoCaptor.getValue().getSandboxType()).isEqualTo("openclaw");
        assertThat(sandboxInfoCaptor.getValue().getSandboxId()).isEqualTo("sandbox-old");
        verify(sandboxMetadataCache, never()).evict("user001", "openclaw");
    }

    @Test
    void removeRemoteSandboxesForServiceTypeOrThrow_listsByServiceTypeAndRemovesAll() {
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "reconcileRemotePageSize", 200);
        SandboxRuntimeInstance oldXs = SandboxRuntimeInstance.builder().sandboxId("sandbox-xs").build();
        SandboxRuntimeInstance oldM = SandboxRuntimeInstance.builder().sandboxId("sandbox-m").build();
        SandboxRuntimePage<SandboxRuntimeInstance> page = SandboxRuntimePage.<SandboxRuntimeInstance>builder()
            .items(List.of(oldXs, oldM))
            .pageNo(1)
            .pageSize(200)
            .build();
        when(sandboxLifecycleFacade.listSandboxesByMetadata(eq(Map.of("userCode", "user001",
            "serviceType", "openclaw")), eq(1), eq(200))).thenReturn(SandboxResponse.success(page));
        when(sandboxLifecycleFacade.removeSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        ArgumentCaptor<SandboxInfo> sandboxInfoCaptor = ArgumentCaptor.forClass(SandboxInfo.class);

        ReflectionTestUtils.invokeMethod(sandboxService, "removeRemoteSandboxesForServiceTypeOrThrow",
            "user001", "openclaw", "openclaw", "sandbox-xs", "test-cleanup");

        verify(sandboxLifecycleFacade, times(2)).removeSandbox(sandboxInfoCaptor.capture());
        assertThat(sandboxInfoCaptor.getAllValues())
            .extracting(SandboxInfo::getSandboxId)
            .containsExactly("sandbox-xs", "sandbox-m");
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
        ReflectionTestUtils.setField(sandboxService, "reconcileJobLockEnabled", false);
        ReflectionTestUtils.setField(sandboxService, "reconcileGroupLimit", 50);
        ReflectionTestUtils.setField(sandboxService, "reconcileRecordLimitPerGroup", 500);
        ReflectionTestUtils.setField(sandboxService, "reconcileRemotePageSize", 200);
        ReflectionTestUtils.setField(sandboxService, "reconcileMaxRecordsPerRun", 3000);
        ReflectionTestUtils.setField(sandboxService, "reconcileMaxDurationMs", 30000L);
        ReflectionTestUtils.setField(sandboxService, "reconcileRemoteConcurrency", 1);

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
        SandboxReconcileGroup group = new SandboxReconcileGroup();
        group.setUserCode("user001");
        group.setSandboxType("openclaw");
        group.setRecordCount(1);
        when(sandboxRecordMapper.selectReconcileGroups(eq(50))).thenReturn(List.of(group));
        when(sandboxRecordMapper.selectReconcileSandboxesByGroup(eq("user001"), eq("openclaw"), isNull(), isNull(),
            eq(500)))
            .thenReturn(List.of(record));
        when(sandboxLifecycleFacade.listSandboxesByMetadata(eq(Map.of("userCode", "user001", "serviceKey", "openclaw")),
            eq(1), eq(200))).thenReturn(SandboxResponse.success(SandboxRuntimePage.empty(1, 200)));
        when(sandboxRecordMapper.markReleased(eq(1L), eq("release.remote.missing"), any(Date.class), eq(0)))
            .thenReturn(1);

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

    @Test
    void buildSandboxWorkerId_returnsServiceKeyDashUserCode() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            "user001", "openclaw");

        assertThat(result).isEqualTo("openclaw-user001");
    }

    @Test
    void buildSandboxWorkerId_worksForAnyServiceKey() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            "user002", "byclaw-code-agent");

        assertThat(result).isEqualTo("byclaw-code-agent-user002");
    }

    @Test
    void buildSandboxWorkerId_worksForCustomServiceKeys() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            "user003", "custom-service");

        assertThat(result).isEqualTo("custom-service-user003");
    }

    @Test
    void buildSandboxWorkerId_returnsNullWhenUserCodeIsNull() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            null, "openclaw");

        assertThat(result).isNull();
    }

    @Test
    void buildSandboxWorkerId_returnsNullWhenUserCodeIsBlank() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            "  ", "openclaw");

        assertThat(result).isNull();
    }

    @Test
    void buildSandboxWorkerId_returnsNullWhenServiceKeyIsNull() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            "user001", null);

        assertThat(result).isNull();
    }

    @Test
    void buildSandboxWorkerId_returnsNullWhenServiceKeyIsBlank() {
        SandboxService sandboxService = new SandboxService();

        String result = ReflectionTestUtils.invokeMethod(sandboxService, "buildSandboxWorkerId",
            "user001", "");

        assertThat(result).isNull();
    }

    @Test
    void doLaunchSandbox_injectsByaiWorkerIdIntoEnvs() {
        SandboxLaunchContextFactory sandboxLaunchContextFactory = mock(SandboxLaunchContextFactory.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService systemConfigService =
            mock(com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxLaunchContextFactory", sandboxLaunchContextFactory);
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "byaiSystemConfigService", systemConfigService);

        SandboxLaunchRouting routing = new SandboxLaunchRouting("openclaw",
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        Map<String, String> envs = new java.util.HashMap<>();
        envs.put("MODEL_BASE_URL", "https://model.example");
        SandboxLaunchContext launchContext = new SandboxLaunchContext("openclaw", envs, Map.of(), "gateway-token");
        when(sandboxLaunchContextFactory.buildContext("user001", 100L, "openclaw")).thenReturn(launchContext);
        doAnswer(invocation -> {
            SsSandboxRecord record = invocation.getArgument(0);
            record.setId(99L);
            return 1;
        }).when(sandboxRecordMapper).insert(any(SsSandboxRecord.class));

        ArgumentCaptor<com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest> requestCaptor =
            ArgumentCaptor.forClass(com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest.class);
        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-1");
        launchData.setEndpoint("http://host/proxy/18789/chat?token=gateway-token");
        when(sandboxLifecycleFacade.launchSandbox(requestCaptor.capture())).thenReturn(SandboxResponse.success(launchData));
        when(sandboxRecordMapper.updateLaunchSuccess(eq(99L), eq("sandbox-1"), any(), eq("gateway-token"),
            any(), any(), any(), any(), any(), eq(0))).thenReturn(1);

        ReflectionTestUtils.invokeMethod(sandboxService, "doLaunchSandbox",
            "user001", 100L, routing);

        com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest captured = requestCaptor.getValue();
        assertThat(captured.getEnvs())
            .containsEntry("BYAI_WORKER_ID", "openclaw-user001")
            .containsEntry("MODEL_BASE_URL", "https://model.example");
    }

    @Test
    void doLaunchSandbox_doesNotInjectByaiWorkerIdWhenUserCodeIsBlank() {
        SandboxLaunchContextFactory sandboxLaunchContextFactory = mock(SandboxLaunchContextFactory.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService systemConfigService =
            mock(com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxLaunchContextFactory", sandboxLaunchContextFactory);
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);
        ReflectionTestUtils.setField(sandboxService, "byaiSystemConfigService", systemConfigService);

        // Use blank userCode so buildSandboxWorkerId returns null
        SandboxLaunchRouting routing = new SandboxLaunchRouting("openclaw",
            SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        SandboxLaunchContext launchContext = new SandboxLaunchContext("openclaw", null, Map.of(), "gateway-token");
        when(sandboxLaunchContextFactory.buildContext("", 100L, "openclaw")).thenReturn(launchContext);
        doAnswer(invocation -> {
            SsSandboxRecord record = invocation.getArgument(0);
            record.setId(99L);
            return 1;
        }).when(sandboxRecordMapper).insert(any(SsSandboxRecord.class));

        ArgumentCaptor<com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest> requestCaptor =
            ArgumentCaptor.forClass(com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest.class);
        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-2");
        launchData.setEndpoint("http://host/proxy/18789/chat?token=gateway-token");
        when(sandboxLifecycleFacade.launchSandbox(requestCaptor.capture())).thenReturn(SandboxResponse.success(launchData));
        when(sandboxRecordMapper.updateLaunchSuccess(eq(99L), eq("sandbox-2"), any(), eq("gateway-token"),
            any(), any(), any(), any(), any(), eq(0))).thenReturn(1);

        ReflectionTestUtils.invokeMethod(sandboxService, "doLaunchSandbox",
            "", 100L, routing);

        com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest captured = requestCaptor.getValue();
        assertThat(captured.getEnvs()).doesNotContainKey("BYAI_WORKER_ID");
    }

}
