package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.client.model.ResizeSandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceProfileEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceProfileEntity;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxResizeRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxResizeRecordMapper;

class SandboxResizeServiceTest {

    @Test
    void handleResizeRequest_skipsRecentSameDirectionAlertDuringCooldown() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        record.setLastResizeSuccess(1);
        record.setLastResizeAt(new Date(System.currentTimeMillis() - Duration.ofSeconds(30).toMillis()));
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("s", "m"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "m"))
            .thenReturn(Optional.of(spec("m")));

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getId()).isNull();
        assertThat(result.getStatus()).isEqualTo("SKIPPED_COOLDOWN");
        verify(fixture.sandboxRecordMapper, never()).claimResize(any(), any(), any(), any(), any(), any(), any(),
            any(), any(), any(), any(), any());
        verify(fixture.resizeRecordMapper, never()).insert(any());
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handleResizeRequest_skipsWhenResizeClaimAlreadyTaken() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("s", "m"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "m"))
            .thenReturn(Optional.of(spec("m")));
        when(fixture.sandboxRecordMapper.claimResize(eq(1L), eq("s"), eq("m"), eq("PROCESSING"),
            any(Date.class), any(), isNull(), eq("s"), eq("m"), isNull(), any(Date.class), eq(3)))
            .thenReturn(0);

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getId()).isNull();
        assertThat(result.getStatus()).isEqualTo("SKIPPED_DUPLICATE");
        verify(fixture.resizeRecordMapper, never()).insert(any());
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handleResizeRequest_skipsBoundaryWhenAlreadyHighestProfile() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("l");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("m", "l"));

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getId()).isNull();
        assertThat(result.getStatus()).isEqualTo("SKIPPED_BOUNDARY");
        verify(fixture.specRepository, never()).findByServiceKeyAndProfile(any(), any());
        verify(fixture.resizeRecordMapper, never()).insert(any());
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handleResizeRequest_restartsNonRunningSandboxForScaleUpAlert() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("xs");
        record.setStatus("STARTING");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("xs", "s"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "s"))
            .thenReturn(Optional.of(spec("s")));
        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-2");
        when(fixture.sandboxService.restartSandboxAfterRemoteExitWithoutWait("user001", -1L, null, "openclaw"))
            .thenReturn(launchData);

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.oom_killed",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getStatus()).isEqualTo("SUCCESS");
        assertThat(result.getSuccess()).isEqualTo(1);
        verify(fixture.sandboxService).savePreferredServiceKey("user001", "openclaw-s");
        verify(fixture.sandboxService).restartSandboxAfterRemoteExitWithoutWait("user001", -1L, null, "openclaw");
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handlePrometheusAlert_routesAbnormalRecoveryToRestart() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("s", "m"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "m"))
            .thenReturn(Optional.of(spec("m")));
        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-2");
        when(fixture.sandboxService.restartSandboxAfterRemoteExitWithoutWait("user001", -1L, null, "openclaw"))
            .thenReturn(launchData);

        SsSandboxResizeRecord result = fixture.service.handlePrometheusAlert(prometheusPayload(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "alertname", "OpenClawSandboxOOMKilled",
            "reasonCode", "metrics.memory.oom_killed",
            "alertActionType", "ABNORMAL_RECOVERY"
        )));

        assertThat(result.getStatus()).isEqualTo("SUCCESS");
        assertThat(result.getResizeType()).isEqualTo("RECOVERY_RESTART");
        assertThat(result.getToProfileKey()).isEqualTo("m");
        verify(fixture.sandboxService).savePreferredServiceKey("user001", "openclaw-m");
        verify(fixture.sandboxService).restartSandboxAfterRemoteExitWithoutWait("user001", -1L, null, "openclaw");
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handlePrometheusAlert_marksRecoveryFailedWhenRestartReusesOldSandboxId() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("s", "m"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "m"))
            .thenReturn(Optional.of(spec("m")));
        SandboxLaunchData launchData = new SandboxLaunchData();
        launchData.setSandboxId("sandbox-1");
        when(fixture.sandboxService.restartSandboxAfterRemoteExitWithoutWait("user001", -1L, null, "openclaw"))
            .thenReturn(launchData);

        SsSandboxResizeRecord result = fixture.service.handlePrometheusAlert(prometheusPayload(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "alertname", "OpenClawSandboxOOMKilled",
            "reasonCode", "metrics.memory.oom_killed",
            "alertActionType", "ABNORMAL_RECOVERY"
        )));

        assertThat(result.getStatus()).isEqualTo("FAILED");
        assertThat(result.getSuccess()).isEqualTo(0);
        assertThat(result.getErrorMessage()).contains("reused the old sandbox id");
        verify(fixture.sandboxService).savePreferredServiceKey("user001", "openclaw-m");
        verify(fixture.sandboxService).restartSandboxAfterRemoteExitWithoutWait("user001", -1L, null, "openclaw");
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handleResizeRequest_cleansOldRemoteWhenResizeReturnsNewSandboxId() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("s", "m"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "m"))
            .thenReturn(Optional.of(spec("m")));
        when(fixture.sandboxRecordMapper.claimResize(eq(1L), eq("s"), eq("m"), eq("PROCESSING"),
            any(Date.class), any(), isNull(), eq("s"), eq("m"), isNull(), any(Date.class), eq(3)))
            .thenReturn(1);
        ResizeSandboxResponse response = new ResizeSandboxResponse();
        response.setSandboxId("sandbox-2");
        when(fixture.openSandboxClient.resizeSandbox(eq("sandbox-1"), any())).thenReturn(response);
        when(fixture.sandboxRecordMapper.updateResizeSuccess(eq(1L), eq("sandbox-2"), isNull(), isNull(), eq("m"),
            any(), any(), eq("SUCCESS"), any(Date.class), any(), any(), eq(1), eq("s"), eq("m"), isNull(), eq(3)))
            .thenReturn(1);

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getStatus()).isEqualTo("SUCCESS");
        verify(fixture.sandboxService).cleanupRemoteSandboxQuietly("user001", "openclaw", "sandbox-1",
            "resize-replaced");
    }

    @Test
    void handleResizeRequest_cleansReturnedRemoteWhenResizeWritebackIsStale() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("s", "m"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "m"))
            .thenReturn(Optional.of(spec("m")));
        when(fixture.sandboxRecordMapper.claimResize(eq(1L), eq("s"), eq("m"), eq("PROCESSING"),
            any(Date.class), any(), isNull(), eq("s"), eq("m"), isNull(), any(Date.class), eq(3)))
            .thenReturn(1);
        ResizeSandboxResponse response = new ResizeSandboxResponse();
        response.setSandboxId("sandbox-2");
        when(fixture.openSandboxClient.resizeSandbox(eq("sandbox-1"), any())).thenReturn(response);
        when(fixture.sandboxRecordMapper.updateResizeSuccess(eq(1L), eq("sandbox-2"), isNull(), isNull(), eq("m"),
            any(), any(), eq("SUCCESS"), any(Date.class), any(), any(), eq(1), eq("s"), eq("m"), isNull(), eq(3)))
            .thenReturn(0);

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getStatus()).isEqualTo("SKIPPED_STALE");
        verify(fixture.sandboxService).cleanupRemoteSandboxQuietly("user001", "openclaw", "sandbox-2",
            "resize-stale-writeback");
    }

    @Test
    void handleResizeRequest_reusesRecentSuccessfulIdempotencyHit() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("xs");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("xs", "s"));
        SsSandboxResizeRecord existing = new SsSandboxResizeRecord();
        existing.setId(99L);
        existing.setStatus("SUCCESS");
        existing.setFinishedAt(new Date());
        when(fixture.resizeRecordMapper.selectLatestByIdempotencyKey(any())).thenReturn(existing);

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getId()).isEqualTo(99L);
        verify(fixture.sandboxRecordMapper, never()).claimResize(any(), any(), any(), any(), any(), any(), any(),
            any(), any(), any(), any(), any());
        verify(fixture.resizeRecordMapper, never()).insert(any());
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void handleResizeRequest_doesNotReuseStaleSuccessfulIdempotencyHit() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("xs");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("xs", "s"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "s"))
            .thenReturn(Optional.of(spec("s")));
        SsSandboxResizeRecord existing = new SsSandboxResizeRecord();
        existing.setId(99L);
        existing.setStatus("SUCCESS");
        existing.setFinishedAt(new Date(System.currentTimeMillis() - Duration.ofMinutes(10).toMillis()));
        when(fixture.resizeRecordMapper.selectLatestByIdempotencyKey(any())).thenReturn(existing);
        when(fixture.sandboxRecordMapper.claimResize(eq(1L), eq("xs"), eq("s"), eq("PROCESSING"),
            any(Date.class), any(), isNull(), eq("xs"), eq("s"), isNull(), any(Date.class), eq(3)))
            .thenReturn(1);
        ResizeSandboxResponse response = new ResizeSandboxResponse();
        response.setSandboxId("sandbox-2");
        when(fixture.openSandboxClient.resizeSandbox(eq("sandbox-1"), any())).thenReturn(response);
        when(fixture.sandboxRecordMapper.updateResizeSuccess(eq(1L), eq("sandbox-2"), isNull(), isNull(), eq("s"),
            any(), any(), eq("SUCCESS"), any(Date.class), any(), any(), eq(1), eq("xs"), eq("s"), isNull(), eq(3)))
            .thenReturn(1);

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.memory.high",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getStatus()).isEqualTo("SUCCESS");
        verify(fixture.sandboxRecordMapper).claimResize(eq(1L), eq("xs"), eq("s"), eq("PROCESSING"),
            any(Date.class), any(), isNull(), eq("xs"), eq("s"), isNull(), any(Date.class), eq(3));
        verify(fixture.resizeRecordMapper).insert(any());
        verify(fixture.openSandboxClient).resizeSandbox(eq("sandbox-1"), any());
    }

    @Test
    void handlePrometheusAlert_recordsOpsIncidentWithoutRestartOrResize() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "s"))
            .thenReturn(Optional.of(spec("s")));
        ArgumentCaptor<SsSandboxResizeRecord> auditCaptor = ArgumentCaptor.forClass(SsSandboxResizeRecord.class);

        SsSandboxResizeRecord result = fixture.service.handlePrometheusAlert(prometheusPayload(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "pod", "sandbox-1-0",
            "alertname", "OpenClawSandboxImagePullFailed",
            "reasonCode", "ops.image_pull_failed",
            "alertActionType", "OPS_INCIDENT"
        )));

        assertThat(result.getStatus()).isEqualTo("RECORDED_OPS_INCIDENT");
        assertThat(result.getResizeType()).isEqualTo("OPS_INCIDENT");
        assertThat(result.getSkipReason()).isEqualTo("operations incident recorded only");
        verify(fixture.resizeRecordMapper).insert(auditCaptor.capture());
        assertThat(auditCaptor.getValue().getIdempotencyKey()).startsWith("sandbox-ops-incident:");
        verifyNoInteractions(fixture.openSandboxClient);
        verify(fixture.sandboxService, never()).savePreferredServiceKey(any(), any());
        verify(fixture.sandboxService, never()).restartSandboxAfterRemoteExitWithoutWait(any(), any(), any(), any());
    }

    @Test
    void handlePrometheusAlert_reusesExistingOpsIncidentForSamePayload() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord record = runningRecord("s");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        SsSandboxResizeRecord existing = new SsSandboxResizeRecord();
        existing.setId(99L);
        existing.setStatus("RECORDED_OPS_INCIDENT");
        existing.setResizeType("OPS_INCIDENT");
        existing.setFinishedAt(new Date());
        when(fixture.resizeRecordMapper.selectLatestByIdempotencyKey(any())).thenReturn(existing);

        SsSandboxResizeRecord result = fixture.service.handlePrometheusAlert(prometheusPayload(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "pod", "sandbox-1-0",
            "alertname", "OpenClawSandboxImagePullFailed",
            "reasonCode", "ops.image_pull_failed",
            "alertActionType", "OPS_INCIDENT"
        )));

        assertThat(result.getId()).isEqualTo(99L);
        verify(fixture.resizeRecordMapper, never()).insert(any());
        verifyNoInteractions(fixture.openSandboxClient);
        verify(fixture.sandboxService, never()).savePreferredServiceKey(any(), any());
        verify(fixture.sandboxService, never()).restartSandboxAfterRemoteExitWithoutWait(any(), any(), any(), any());
    }

    @Test
    void handleResizeRequest_skipsScaleDownAfterRecentScaleUpProtection() {
        SandboxFixture fixture = newFixture();
        fixture.properties.getTierAutoscale().setScaleDownAfterUpProtection(Duration.ofMinutes(15));
        SsSandboxRecord record = runningRecord("s");
        record.setLastResizeSuccess(1);
        record.setLastResizeAt(new Date(System.currentTimeMillis() - Duration.ofMinutes(10).toMillis()));
        record.setLastResizeFromProfile("xs");
        record.setLastResizeToProfile("s");
        record.setLastResizeReason("metrics.memory.high");
        when(fixture.sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("xs", "s"));
        when(fixture.specRepository.findByServiceKeyAndProfile("openclaw", "xs"))
            .thenReturn(Optional.of(spec("xs")));

        SsSandboxResizeRecord result = fixture.service.handleResizeRequest(Map.of(
            "userCode", "user001",
            "sandboxType", "openclaw",
            "sandboxId", "sandbox-1",
            "reasonCode", "metrics.low_usage",
            "triggerSource", "PROMETHEUS_ALERT"
        ));

        assertThat(result.getStatus()).isEqualTo("SKIPPED_COOLDOWN");
        assertThat(result.getSkipReason()).contains("protected after recent scale-up");
        verify(fixture.sandboxRecordMapper, never()).claimResize(any(), any(), any(), any(), any(), any(), any(),
            any(), any(), any(), any(), any());
        verify(fixture.openSandboxClient, never()).resizeSandbox(any(), any());
    }

    @Test
    void buildBoundaryBlacklistMetrics_outputsOnlyBoundaryDirections() {
        SandboxFixture fixture = newFixture();
        SsSandboxRecord lowest = runningRecord("xs");
        lowest.setId(1L);
        lowest.setSandboxId("sandbox-low");
        SsSandboxRecord middle = runningRecord("s");
        middle.setId(2L);
        middle.setSandboxId("sandbox-mid");
        SsSandboxRecord highest = runningRecord("l");
        highest.setId(3L);
        highest.setSandboxId("sandbox-high");
        when(fixture.sandboxRecordMapper.selectRunningAutoscaleRecords())
            .thenReturn(List.of(lowest, middle, highest));
        when(fixture.profileEntityMapper.selectEnabledProfiles("openclaw")).thenReturn(profiles("xs", "s", "l"));

        String metrics = fixture.service.buildBoundaryBlacklistMetrics();

        assertThat(metrics).contains(
            "byclaw_sandbox_autoscale_runtime_info",
            "sandboxId=\"sandbox-mid\"",
            "userCode=\"user001\"",
            "serviceType=\"openclaw\"",
            "byclaw_sandbox_autoscale_boundary_blacklist",
            "sandboxId=\"sandbox-low\"",
            "pod=\"sandbox-low-0\"",
            "profileKey=\"xs\"",
            "direction=\"down\"",
            "boundary=\"min\"",
            "sandboxId=\"sandbox-high\"",
            "pod=\"sandbox-high-0\"",
            "profileKey=\"l\"",
            "direction=\"up\"",
            "boundary=\"max\""
        );
        assertThat(metrics).doesNotContain("byclaw_sandbox_autoscale_boundary_blacklist{sandboxId=\"sandbox-mid\"");
    }

    private SandboxFixture newFixture() {
        SandboxProperties properties = new SandboxProperties();
        properties.getTierAutoscale().setEnabled(true);
        properties.getTierAutoscale().setScaleUpCooldown(Duration.ofMinutes(2));
        properties.getTierAutoscale().setScaleDownCooldown(Duration.ofMinutes(5));
        OpenSandboxClient openSandboxClient = mock(OpenSandboxClient.class);
        SandboxServiceSpecRepository specRepository = mock(SandboxServiceSpecRepository.class);
        SandboxServiceProfileEntityMapper profileEntityMapper = mock(SandboxServiceProfileEntityMapper.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SsSandboxResizeRecordMapper resizeRecordMapper = mock(SsSandboxResizeRecordMapper.class);
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxHealthCacheService sandboxHealthCacheService = mock(SandboxHealthCacheService.class);
        SandboxResizeService service = new SandboxResizeService(properties, openSandboxClient, specRepository,
            profileEntityMapper, sandboxRecordMapper, resizeRecordMapper, sandboxService, sandboxHealthCacheService);
        return new SandboxFixture(service, properties, openSandboxClient, specRepository, profileEntityMapper,
            sandboxRecordMapper, resizeRecordMapper, sandboxService);
    }

    private SsSandboxRecord runningRecord(String profileKey) {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setResourceId(-1L);
        record.setUserCode("user001");
        record.setSandboxType("openclaw");
        record.setServiceType("openclaw");
        record.setProfileKey(profileKey);
        record.setSandboxId("sandbox-1");
        record.setStatus("RUNNING");
        record.setLockVersion(3);
        return record;
    }

    private List<SandboxServiceProfileEntity> profiles(String... profileKeys) {
        return java.util.Arrays.stream(profileKeys)
            .map(this::profile)
            .toList();
    }

    private SandboxServiceProfileEntity profile(String profileKey) {
        SandboxServiceProfileEntity profile = new SandboxServiceProfileEntity();
        profile.setServiceType("openclaw");
        profile.setProfileKey(profileKey);
        profile.setResizeEnabled(1);
        profile.setEnabled(1);
        return profile;
    }

    private SandboxServiceSpec spec(String profileKey) {
        SandboxServiceSpec spec = new SandboxServiceSpec();
        spec.setServiceType("openclaw");
        spec.setProfileKey(profileKey);
        spec.setResourceRequests(Map.of("cpu", "1", "memory", "2Gi"));
        spec.setResourceLimits(Map.of("cpu", "2", "memory", "4Gi"));
        return spec;
    }

    private Map<String, Object> prometheusPayload(Map<String, String> labels) {
        return Map.of(
            "alerts", List.of(Map.of(
                "status", "firing",
                "labels", labels,
                "annotations", Map.of("reason_detail", "test alert")
            ))
        );
    }

    private record SandboxFixture(SandboxResizeService service,
                                  SandboxProperties properties,
                                  OpenSandboxClient openSandboxClient,
                                  SandboxServiceSpecRepository specRepository,
                                  SandboxServiceProfileEntityMapper profileEntityMapper,
                                  SsSandboxRecordMapper sandboxRecordMapper,
                                  SsSandboxResizeRecordMapper resizeRecordMapper,
                                  SandboxService sandboxService) {
    }
}
