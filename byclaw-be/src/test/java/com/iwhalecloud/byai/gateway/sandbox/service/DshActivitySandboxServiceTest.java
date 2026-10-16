package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;

/**
 * byclaw-dsh 沙箱按 DSH 活动 Stream 状态释放 / 续约的决策。markReleasing 返回 0 让 doRemoveSandbox 在远端调用前退出，
 * 只断言释放原因。
 */
class DshActivitySandboxServiceTest {

    private static final String WORKER_ID = "byclaw-dsh-user001";
    private static final long MINUTE = 60_000L;

    private SsSandboxRecordMapper mapper;
    private DshActivityStateStore store;
    private DshActivityStreamListener listener;
    private SandboxLifecycleFacade lifecycle;
    private SandboxMetadataCache metadata;
    private SandboxHealthWatchService health;
    private SandboxService service;

    @BeforeEach
    void setUp() {
        mapper = mock(SsSandboxRecordMapper.class);
        store = mock(DshActivityStateStore.class);
        listener = mock(DshActivityStreamListener.class);
        lifecycle = mock(SandboxLifecycleFacade.class);
        metadata = mock(SandboxMetadataCache.class);
        health = mock(SandboxHealthWatchService.class);
        service = new SandboxService();
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(service, "dshActivityStateStore", store);
        ReflectionTestUtils.setField(service, "dshActivityStreamListener", listener);
        ReflectionTestUtils.setField(service, "sandboxLifecycleFacade", lifecycle);
        ReflectionTestUtils.setField(service, "sandboxMetadataCache", metadata);
        ReflectionTestUtils.setField(service, "sandboxHealthWatchService", health);
        ReflectionTestUtils.setField(service, "idleTimeoutMinutes", 30);
        ReflectionTestUtils.setField(service, "renewAheadSeconds", 120L);
        ReflectionTestUtils.setField(service, "dshActivityEnabled", true);
        ReflectionTestUtils.setField(service, "dshActivitySilentSeconds", 90L);
        when(listener.isSilentCheckReady(anyLong())).thenReturn(true);
        when(mapper.markReleasing(anyLong(), anyString(), any(Date.class), anyInt())).thenReturn(0);
    }

    // ---- cleanup: frontend-idle candidates ----

    @Test
    void releasableAndFrontendIdleIsReleasedAsDshReleasable() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);
        reported(activity("releasable", 5_000L, 1));

        service.cleanupExpiredSandboxes();

        verify(mapper).markReleasing(eq(7L), eq("release.dsh.releasable"), any(Date.class), eq(3));
    }

    @Test
    void busyAndFrontendIdleIsKeptByCleanupAndRenewed() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);
        reported(activity("busy", 5_000L, 1));

        SandboxLifecycleJobReport cleanup = service.cleanupExpiredSandboxes();

        assertThat(cleanup.getSkippedCount()).isEqualTo(1);
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());

        dueForRenew(record);
        SandboxLifecycleJobReport renew = service.renewDueSandboxes();

        assertThat(renew.getAffectedCount()).isEqualTo(1);
        verify(lifecycle).renewSandbox(any(SandboxInfo.class));
    }

    @Test
    void silentEntryInCleanupIsReleasedOnlyOnceTheStreamGateIsOpen() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);
        reported(activity("busy", 120_000L, 1));
        when(listener.isSilentCheckReady(anyLong())).thenReturn(false);

        service.cleanupExpiredSandboxes();
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());

        when(listener.isSilentCheckReady(anyLong())).thenReturn(true);
        service.cleanupExpiredSandboxes();
        verify(mapper).markReleasing(eq(7L), eq("release.dsh.silent"), any(Date.class), eq(3));
    }

    @Test
    void neverReportedSandboxKeepsTodaysIdleTimeoutRelease() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);

        service.cleanupExpiredSandboxes();

        verify(mapper).markReleasing(eq(7L), eq("release.auto.idle-timeout"), any(Date.class), eq(3));
    }

    @Test
    void stateFromAPreviousSandboxIsIgnored() {
        SsSandboxRecord record = dshRecord(1 * MINUTE);
        frontendIdleCandidates(record);
        // received five minutes ago, before this record was created a minute ago
        reported(activity("busy", 5 * MINUTE, 1));

        service.cleanupExpiredSandboxes();
        verify(mapper).markReleasing(eq(7L), eq("release.auto.idle-timeout"), any(Date.class), eq(3));

        DshActivity stale = activity("busy", 5 * MINUTE, 1);
        when(store.entries()).thenReturn(Map.of(WORKER_ID, stale));
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(record));
        when(store.removeIfUnchanged(WORKER_ID, stale)).thenReturn(true);

        service.releaseSilentDshSandboxes();

        verify(mapper, never()).markReleasing(anyLong(), eq("release.dsh.silent"), any(Date.class), anyInt());
        verify(store).removeIfUnchanged(WORKER_ID, stale);
    }

    @Test
    void otherSandboxTypesNeverConsultTheStore() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        record.setSandboxType("openclaw");
        frontendIdleCandidates(record);

        service.cleanupExpiredSandboxes();

        verify(mapper).markReleasing(eq(7L), eq("release.auto.idle-timeout"), any(Date.class), eq(3));
        verifyNoInteractions(store);
    }

    @Test
    void storeFailureNeverReleasesAReportingCandidate() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);
        when(store.find(WORKER_ID)).thenThrow(new IllegalStateException("redis down"));

        SandboxLifecycleJobReport report = service.cleanupExpiredSandboxes();

        assertThat(report.getFailedCount()).isEqualTo(1);
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());
    }

    // ---- silent check ----

    @Test
    void silentSandboxIsReleasedEvenWithAnActivePage() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        record.setLastAccessTime(new Date());
        DshActivity silent = activity("busy", 91_000L, 1);
        when(store.entries()).thenReturn(Map.of(WORKER_ID, silent));
        reported(silent);
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(record));

        SandboxLifecycleJobReport report = service.releaseSilentDshSandboxes();

        assertThat(report.getTotalCandidates()).isEqualTo(1);
        verify(mapper).markReleasing(eq(7L), eq("release.dsh.silent"), any(Date.class), eq(3));
    }

    @Test
    void resizingOrJustResizedSandboxIsNotReleasedOnSilence() {
        SsSandboxRecord resizing = dshRecord(10 * MINUTE);
        resizing.setResizeStatus("PROCESSING");
        DshActivity silent = activity("busy", 5 * MINUTE, 1);
        when(store.entries()).thenReturn(Map.of(WORKER_ID, silent));
        reported(silent);
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(resizing));
        frontendIdleCandidates(resizing);

        service.releaseSilentDshSandboxes();
        service.cleanupExpiredSandboxes();
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());

        resizing.setResizeStatus("SUCCESS");
        resizing.setLastResizeAt(new Date(System.currentTimeMillis() - 30_000L));
        service.releaseSilentDshSandboxes();
        service.cleanupExpiredSandboxes();
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());

        resizing.setLastResizeAt(new Date(System.currentTimeMillis() - 2 * MINUTE));
        service.releaseSilentDshSandboxes();
        verify(mapper).markReleasing(eq(7L), eq("release.dsh.silent"), any(Date.class), eq(3));
    }

    @Test
    void freshEntriesAndClosedGateNeverReleaseOnSilence() {
        Map<String, DshActivity> entries = new LinkedHashMap<>();
        entries.put(WORKER_ID, activity("releasable", 10_000L, 1));
        when(store.entries()).thenReturn(entries);

        service.releaseSilentDshSandboxes();
        verify(mapper, never()).selectRunningByUserAndSandboxType(anyString(), anyString());

        entries.put(WORKER_ID, activity("busy", 10 * MINUTE, 1));
        when(listener.isSilentCheckReady(anyLong())).thenReturn(false);
        service.releaseSilentDshSandboxes();
        verify(store, times(1)).entries();
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());
    }

    @Test
    void silentCheckSkipsManualRecordsAndEntriesThatTurnFreshBeforeRelease() {
        SsSandboxRecord manual = dshRecord(10 * MINUTE);
        manual.setAutoRelease(0);
        DshActivity silent = activity("busy", 2 * MINUTE, 1);
        when(store.entries()).thenReturn(Map.of(WORKER_ID, silent));
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(manual));

        service.releaseSilentDshSandboxes();
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());

        SsSandboxRecord auto = dshRecord(10 * MINUTE);
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(auto));
        reported(activity("busy", 1_000L, 2));

        SandboxLifecycleJobReport report = service.releaseSilentDshSandboxes();

        assertThat(report.getSkippedCount()).isEqualTo(1);
        verify(mapper, never()).markReleasing(anyLong(), anyString(), any(Date.class), anyInt());
    }

    @Test
    void entryWhoseIdentityIsNotTheUsersWorkerIdIsOnlyGarbageCollected() {
        DshActivity hostnameKeyed = activity("busy", 5 * MINUTE, 1);
        when(store.entries()).thenReturn(Map.of("sandbox-host-abc", hostnameKeyed));

        service.releaseSilentDshSandboxes();

        verify(mapper, never()).selectRunningByUserAndSandboxType(anyString(), anyString());
        verify(store).removeIfUnchanged("sandbox-host-abc", hostnameKeyed);
    }

    // ---- renew ----

    @Test
    void frontendIdleNeverReportedOrReleasableIsNotRenewed() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        dueForRenew(record);

        service.renewDueSandboxes();
        reported(activity("releasable", 5_000L, 1));
        service.renewDueSandboxes();
        reported(activity("busy", 91_000L, 2));
        service.renewDueSandboxes();

        verifyNoInteractions(lifecycle);
    }

    @Test
    void frontendActiveRecordIsRenewedRegardlessOfDshState() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        record.setLastAccessTime(new Date());
        dueForRenew(record);
        reported(activity("releasable", 5_000L, 1));

        service.renewDueSandboxes();

        verify(lifecycle).renewSandbox(any(SandboxInfo.class));
    }

    // ---- old pub/sub busy heartbeat ----

    @Test
    void oldDshHeartbeatIsIgnoredOnlyForReportingSandboxes() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(record));
        when(mapper.updateLastAccessTime(eq(7L), any(Date.class), eq(3))).thenReturn(1);

        assertThat(service.heartbeatDshSandbox("user001")).isTrue();
        verify(mapper).updateLastAccessTime(eq(7L), any(Date.class), eq(3));

        reported(activity("busy", 1_000L, 1));
        SsSandboxRecord reporting = dshRecord(10 * MINUTE);
        Date frontendAccess = reporting.getLastAccessTime();
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(reporting));

        assertThat(service.heartbeatDshSandbox("user001")).isTrue();
        assertThat(reporting.getLastAccessTime()).isEqualTo(frontendAccess);
        verify(mapper).updateLastAccessTime(anyLong(), any(Date.class), anyInt());
        // health watch keeps following the busy signal for both
        verify(health, times(2)).touch(eq("user001"), anyString());
    }

    @Test
    void openclawHeartbeatNeverConsultsTheStore() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        record.setSandboxType("openclaw");
        when(mapper.selectRunningByUserAndSandboxType("user001", "openclaw")).thenReturn(List.of(record));
        when(mapper.updateLastAccessTime(eq(7L), any(Date.class), eq(3))).thenReturn(1);

        assertThat(service.heartbeatOpenclawSandbox("user001")).isTrue();
        verifyNoInteractions(store);
    }

    // ---- release clean-up and feature flag ----

    @Test
    void releasingADshSandboxRemovesItsActivityState() {
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);
        reported(activity("releasable", 5_000L, 1));
        when(mapper.markReleasing(eq(7L), eq("release.dsh.releasable"), any(Date.class), eq(3))).thenReturn(1);
        when(lifecycle.removeSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        when(mapper.updateStatusToReleased(eq(7L), eq("release.dsh.releasable"), any(Date.class), eq(4)))
            .thenReturn(1);

        service.cleanupExpiredSandboxes();

        verify(mapper).updateStatusToReleased(eq(7L), eq("release.dsh.releasable"), any(Date.class), eq(4));
        verify(store).remove(WORKER_ID);
    }

    @Test
    void disabledFlagRestoresTodaysBehaviourEverywhere() {
        ReflectionTestUtils.setField(service, "dshActivityEnabled", false);
        SsSandboxRecord record = dshRecord(10 * MINUTE);
        frontendIdleCandidates(record);
        dueForRenew(record);
        when(mapper.selectRunningByUserAndSandboxType("user001", "byclaw-dsh")).thenReturn(List.of(record));
        when(mapper.updateLastAccessTime(eq(7L), any(Date.class), eq(3))).thenReturn(1);

        service.releaseSilentDshSandboxes();
        service.renewDueSandboxes();
        assertThat(service.heartbeatDshSandbox("user001")).isTrue();
        service.cleanupExpiredSandboxes();

        verify(mapper).markReleasing(eq(7L), eq("release.auto.idle-timeout"), any(Date.class), anyInt());
        verifyNoInteractions(store, listener, lifecycle);
    }

    private SsSandboxRecord dshRecord(long createdAgoMillis) {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(7L);
        record.setUserCode("user001");
        record.setSandboxType("byclaw-dsh");
        record.setResourceId(SandboxLaunchRouting.DEFAULT_RESOURCE_ID);
        record.setStatus("RUNNING");
        record.setSandboxId("sandbox-dsh");
        record.setOwnerScope("USER");
        record.setAutoRelease(1);
        record.setTimeoutSeconds(600);
        record.setLockVersion(3);
        record.setVersion(1);
        record.setCreateTime(new Date(System.currentTimeMillis() - createdAgoMillis));
        record.setLastAccessTime(new Date(System.currentTimeMillis() - 31 * MINUTE));
        return record;
    }

    private DshActivity activity(String state, long receivedAgoMillis, int seq) {
        return new DshActivity("user001", state, System.currentTimeMillis() - receivedAgoMillis, "1700000000000-" + seq,
            null, null);
    }

    private void reported(DshActivity activity) {
        when(store.find(WORKER_ID)).thenReturn(activity);
    }

    private void frontendIdleCandidates(SsSandboxRecord record) {
        when(mapper.countExpiredSandboxes(30)).thenReturn(1);
        when(mapper.selectExpiredSandboxesPage(eq(30), isNull(), isNull(), eq(1))).thenReturn(List.of(record));
    }

    private void dueForRenew(SsSandboxRecord record) {
        when(mapper.countDueRenewSandboxes(any(Date.class))).thenReturn(1);
        when(mapper.selectDueRenewSandboxesPage(any(Date.class), isNull(), isNull(), eq(1))).thenReturn(List.of(record));
        when(lifecycle.renewSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        when(mapper.updateRenewSuccess(eq(7L), any(Date.class), any(Date.class), any(Date.class), eq(3))).thenReturn(1);
    }
}
