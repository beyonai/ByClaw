package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
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
        SandboxResizeService service = new SandboxResizeService(properties, openSandboxClient, specRepository,
            profileEntityMapper, sandboxRecordMapper, resizeRecordMapper, sandboxService);
        return new SandboxFixture(service, openSandboxClient, specRepository, profileEntityMapper,
            sandboxRecordMapper, resizeRecordMapper);
    }

    private SsSandboxRecord runningRecord(String profileKey) {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
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

    private record SandboxFixture(SandboxResizeService service,
                                  OpenSandboxClient openSandboxClient,
                                  SandboxServiceSpecRepository specRepository,
                                  SandboxServiceProfileEntityMapper profileEntityMapper,
                                  SsSandboxRecordMapper sandboxRecordMapper,
                                  SsSandboxResizeRecordMapper resizeRecordMapper) {
    }
}
