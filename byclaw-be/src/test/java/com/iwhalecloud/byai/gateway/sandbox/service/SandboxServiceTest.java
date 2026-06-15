package com.iwhalecloud.byai.gateway.sandbox.service;

import java.time.OffsetDateTime;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimePage;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.sandbox.SandboxReconcileGroup;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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

    private boolean i18nPrepared;

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        LocaleContextHolder.resetLocaleContext();
        if (i18nPrepared) {
            ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
            i18nPrepared = false;
        }
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
    void doLaunchSandbox_marksRecordFailedWhenRequiredModelEnvsMissing() {
        prepareI18n();
        SandboxLaunchContextFactory sandboxLaunchContextFactory = mock(SandboxLaunchContextFactory.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxLifecycleFacade sandboxLifecycleFacade = mock(SandboxLifecycleFacade.class);
        com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService systemConfigService =
            mock(com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxLaunchContextFactory", sandboxLaunchContextFactory);
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxLifecycleFacade", sandboxLifecycleFacade);
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
        when(sandboxRecordMapper.updateStatusToFailed(eq(99L), eq("launch.model-env.missing"),
            any(Date.class), eq(0))).thenReturn(1);

        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(sandboxService, "doLaunchSandbox",
            "user001", 100L, routing))
            .isInstanceOf(BdpRuntimeException.class)
            .hasMessage("Sandbox startup failed because model parameters are incomplete.");

        verify(sandboxRecordMapper).insert(any(SsSandboxRecord.class));
        verify(sandboxRecordMapper).updateStatusToFailed(eq(99L), eq("launch.model-env.missing"),
            any(Date.class), eq(0));
        verify(sandboxLifecycleFacade, never()).launchSandbox(any());
    }

    @Test
    void validateRequiredModelEnvs_skipsByclawCodeAgentSandbox() {
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(99L);
        record.setSandboxType(SandboxLaunchRouting.BYCLAW_CODE_AGENT_SANDBOX_TYPE);

        ReflectionTestUtils.invokeMethod(sandboxService, "validateRequiredModelEnvs", record, Map.of());

        verify(sandboxRecordMapper, never()).updateStatusToFailed(any(), any(), any(), any());
    }

    @Test
    void heartbeat_refreshesAllRunningSandboxesForCurrentUser() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);

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
    }

    @Test
    void heartbeatOpenclawSandbox_refreshesOnlyOpenclawRunningSandboxes() {
        SandboxMetadataCache sandboxMetadataCache = mock(SandboxMetadataCache.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxService sandboxService = new SandboxService();
        ReflectionTestUtils.setField(sandboxService, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(sandboxService, "sandboxMetadataCache", sandboxMetadataCache);

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

    private void prepareI18n() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("sandbox.launch.model.config.required", Locale.US,
            "Sandbox startup failed because model parameters are incomplete.");
        LocaleContextHolder.setLocale(Locale.US);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        i18nPrepared = true;
    }

}
