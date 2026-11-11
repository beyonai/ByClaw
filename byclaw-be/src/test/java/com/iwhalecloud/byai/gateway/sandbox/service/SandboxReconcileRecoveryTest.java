package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.common.concurrent.SandboxReconcileCancellation;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimePage;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.entity.sandbox.SandboxReconcileGroup;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class SandboxReconcileRecoveryTest {
    private final SandboxService service = spy(new SandboxService());
    private final SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
    private final SandboxLifecycleFacade facade = mock(SandboxLifecycleFacade.class);
    private final SandboxMetadataCache cache = mock(SandboxMetadataCache.class);
    private final SandboxLaunchContextFactory contexts = mock(SandboxLaunchContextFactory.class);
    private final SandboxUserContextRunner users = new SandboxUserContextRunner(mock(LoginApplicationService.class));

    SandboxReconcileRecoveryTest() {
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(service, "sandboxTransactionManager",
            mock(org.springframework.jdbc.datasource.DataSourceTransactionManager.class));
        ReflectionTestUtils.setField(service, "sandboxLifecycleFacade", facade);
        ReflectionTestUtils.setField(service, "sandboxMetadataCache", cache);
        ReflectionTestUtils.setField(service, "sandboxLaunchContextFactory", contexts);
        ReflectionTestUtils.setField(service, "sandboxUserContextRunner", users);
        ReflectionTestUtils.setField(service, "byaiSystemConfigService", mock(ByaiSystemConfigService.class));
        ReflectionTestUtils.setField(service, "reconcileRecordLimitPerGroup", 10);
        ReflectionTestUtils.setField(service, "reconcileRemotePageSize", 200);
        when(contexts.buildContext("user001", -1L, "openclaw"))
            .thenReturn(new SandboxLaunchContext("openclaw", Map.of(), Map.of(), "token"));
        doAnswer(call -> { ((SsSandboxRecord) call.getArgument(0)).setId(99L); return 1; })
            .when(mapper).insert(any());
        when(mapper.updateLaunchSuccess(eq(99L), any(), any(), any(), any(), any(), any(), any(), any(), eq(0)))
            .thenAnswer(call -> {
                assertThat(Thread.currentThread().isInterrupted()).isFalse();
                return 1;
            });
    }

    @AfterEach
    void clearScope() {
        Thread.interrupted();
        SandboxReconcileCancellation.clear();
    }

    private SandboxLaunchData launched() {
        SandboxLaunchData data = new SandboxLaunchData();
        data.setSandboxId("remote-new");
        data.setEndpoint("http://host/proxy/18789/chat");
        data.setGatewayToken("token");
        return data;
    }

    private SandboxLaunchData launch() {
        return ReflectionTestUtils.invokeMethod(service, "doLaunchSandbox", "user001", -1L,
            new SandboxLaunchRouting("openclaw", -1L));
    }

    private SsSandboxRecord record(long id, String sandboxId) {
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(id);
        record.setUserCode("user001");
        record.setResourceId(-1L);
        record.setSandboxType("openclaw");
        record.setSandboxId(sandboxId);
        record.setStatus("RUNNING");
        record.setLockVersion(0);
        record.setVersion(0);
        record.setGatewayToken("token");
        record.setCreateTime(new Date(0));
        record.setUpdateTime(new Date(0));
        return record;
    }

    private SandboxReconcileGroup group(List<SsSandboxRecord> records, List<SandboxRuntimeInstance> remote) {
        SandboxReconcileGroup group = new SandboxReconcileGroup();
        group.setUserCode("user001");
        group.setSandboxType("openclaw");
        group.setRecordCount(records.size());
        when(mapper.selectReconcileSandboxesByGroup(eq("user001"), eq("openclaw"), isNull(), isNull(), eq(10)))
            .thenReturn(records);
        when(facade.listSandboxesByMetadata(anyMap(), eq(1), eq(200)))
            .thenReturn(SandboxResponse.success(new SandboxRuntimePage<>(remote, 1, 200, false)));
        return group;
    }

    private SandboxLifecycleJobReport run(SandboxReconcileGroup group) {
        return ReflectionTestUtils.invokeMethod(service, "runReconcileGroup", group, new AtomicInteger(10), Long.MAX_VALUE);
    }

    @Test
    void knownSuccessAfterDeadlineStillBindsDatabaseAndCache() {
        SandboxReconcileCancellation.setDeadline(Long.MAX_VALUE);
        when(facade.launchSandbox(any())).thenAnswer(call -> {
            SandboxReconcileCancellation.setDeadline(0);
            return SandboxResponse.success(launched());
        });
        assertThat(launch().getSandboxId()).isEqualTo("remote-new");
        verify(mapper).updateLaunchSuccess(eq(99L), eq("remote-new"), any(), eq("token"),
            any(), any(), any(), any(), any(), eq(0));
        verify(cache).put(argThat(info -> "remote-new".equals(info.getSandboxId())));
        verify(facade, never()).removeSandbox(any());
    }

    @Test
    void unknownResponseRetainsOriginalStartingAttempt() {
        SandboxReconcileCancellation.setDeadline(Long.MAX_VALUE);
        when(facade.launchSandbox(any())).thenReturn(null);
        assertThatThrownBy(this::launch).isInstanceOf(IllegalStateException.class).hasMessageContaining("unknown");
        verify(mapper).insert(any());
        verify(mapper, never()).updateStatusToFailed(any(), any(), any(), any());
    }

    @Test
    void knownFailureAfterDeadlineStillRecordsFailed() {
        SandboxReconcileCancellation.setDeadline(Long.MAX_VALUE);
        when(facade.launchSandbox(any())).thenAnswer(call -> {
            SandboxReconcileCancellation.setDeadline(0);
            return SandboxResponse.error("explicit rejection");
        });
        when(mapper.updateStatusToFailed(eq(99L), eq("explicit rejection"), any(), eq(0)))
            .thenAnswer(call -> { assertThat(Thread.currentThread().isInterrupted()).isFalse(); return 1; });
        assertThat(launch()).isNull();
        verify(mapper).updateStatusToFailed(eq(99L), eq("explicit rejection"), any(), eq(0));
    }

    @Test
    void interruptedCallerDoesNotInterruptKnownResultCompletion() throws Exception {
        CountDownLatch completed = new CountDownLatch(1);
        CountDownLatch allowCompletion = new CountDownLatch(1);
        when(mapper.updateLaunchSuccess(eq(99L), any(), any(), any(), any(), any(), any(), any(), any(), eq(0)))
            .thenAnswer(call -> {
                assertThat(Thread.currentThread().isInterrupted()).isFalse();
                assertThat(allowCompletion.await(5, TimeUnit.SECONDS)).isTrue();
                return 1;
            });
        doAnswer(call -> { completed.countDown(); return null; }).when(cache).put(any());
        SandboxReconcileCancellation.setDeadline(Long.MAX_VALUE);
        when(facade.launchSandbox(any())).thenAnswer(call -> {
            Thread.currentThread().interrupt();
            return SandboxResponse.success(launched());
        });
        try {
            assertThatThrownBy(this::launch).isInstanceOf(CancellationException.class);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        }
        finally {
            Thread.interrupted();
            allowCompletion.countDown();
        }
        assertThat(completed.await(5, TimeUnit.SECONDS)).isTrue();
        verify(mapper).updateLaunchSuccess(eq(99L), eq("remote-new"), any(), eq("token"),
            any(), any(), any(), any(), any(), eq(0));
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void cancellationAfterReleaseStillEvictsCacheAndKeepsRecoveryIntent(boolean interrupt) throws Exception {
        SsSandboxRecord record = record(1, "missing");
        SandboxReconcileGroup group = group(List.of(record), List.of());
        CountDownLatch evicted = new CountDownLatch(1);
        doAnswer(call -> {
            assertThat(Thread.currentThread().isInterrupted()).isFalse();
            evicted.countDown(); return null;
        }).when(cache).evict("user001", "openclaw");
        when(mapper.markReleased(eq(1L), eq("release.remote.missing"), any(), eq(0))).thenAnswer(call -> {
            if (interrupt) Thread.currentThread().interrupt();
            else SandboxReconcileCancellation.setDeadline(0);
            return 1;
        });
        SandboxLifecycleJobReport report = run(group);
        assertThat(report.getScannedCount()).isEqualTo(1);
        assertThat(report.getCancelledGroups()).isEqualTo(1);
        if (interrupt) assertThat(Thread.currentThread().isInterrupted()).isTrue();
        Thread.interrupted();
        assertThat(evicted.await(5, TimeUnit.SECONDS)).isTrue();
        verify(service, never()).launchPendingReconcileSandbox(any());
        verify(facade, never()).launchSandbox(any());
    }

    @Test
    void nextRoundResumesReleasedIntentInsteadOfReleasingItAgain() {
        SsSandboxRecord pending = record(1, "missing");
        pending.setStatus("RELEASED");
        pending.setReleaseReason("release.remote.missing");
        SandboxReconcileGroup group = group(List.of(pending), List.of());
        doReturn(launched()).when(service).launchPendingReconcileSandbox(pending);
        assertThat(run(group).getAffectedCount()).isEqualTo(1);
        verify(mapper, never()).markReleased(any(), any(), any(), any());
        verify(service).launchPendingReconcileSandbox(pending);
    }

    @Test
    void staleStartingReusesOriginalRecordAndCredentialsWithoutAnotherInsert() {
        SsSandboxRecord pending = record(99, null);
        pending.setStatus("STARTING");
        pending.setGatewayToken("original-token");
        SandboxReconcileGroup group = group(List.of(pending), List.of());
        when(mapper.selectActiveByUserAndResource("user001", "openclaw", -1L)).thenReturn(pending);
        when(facade.launchSandbox(any())).thenAnswer(call -> {
            com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest request = call.getArgument(0);
            assertThat(request.getMetadata().get("recordId")).isEqualTo("99");
            assertThat(request.getEnvs()).containsEntry("gateway_token", "original-token")
                .containsEntry("OPENCLAW_GATEWAY_TOKEN", "original-token");
            return SandboxResponse.success(launched());
        });
        try (var redis = mockStatic(RedisUtil.class)) {
            redis.when(() -> RedisUtil.lock(anyString(), anyString(), anyLong())).thenReturn(true);
            assertThat(run(group).getAffectedCount()).isEqualTo(1);
        }
        verify(mapper, never()).insert(any());
        verify(mapper, never()).markStartingReleased(any(), any(), any(), any());
    }

    @Test
    void replacementReservationRechecksManualCancellationInsideTransaction() {
        when(mapper.selectPendingReconcileRestart(1L)).thenReturn(null);
        Boolean inserted = ReflectionTestUtils.invokeMethod(service, "insertLaunchRecord", record(99, null), 1L);
        assertThat(inserted).isFalse();
        verify(mapper, never()).insert(any());
    }

    @Test
    void replacementReservationChecksIntentBeforeInsertingPlaceholder() {
        SsSandboxRecord old = record(1, "missing");
        when(mapper.selectPendingReconcileRestart(1L)).thenReturn(old);
        SsSandboxRecord replacement = record(99, null);
        Boolean inserted = ReflectionTestUtils.invokeMethod(service, "insertLaunchRecord", replacement, 1L);
        assertThat(inserted).isTrue();
        var ordered = inOrder(mapper);
        ordered.verify(mapper).selectPendingReconcileRestart(1L);
        ordered.verify(mapper).insert(replacement);
        verifyNoInteractions(facade);
    }

    @Test
    void manualStopCancelsDurableReleasedIntent() {
        SsSandboxRecord pending = record(1, "missing");
        pending.setStatus("RELEASED");
        when(mapper.selectById(1L)).thenReturn(pending);
        service.removeSandboxById(1L);
        verify(mapper).cancelPendingReconcileRestarts(eq("user001"), eq("openclaw"), isNull(), eq(1L),
            startsWith("release.manual"), any());
        verify(facade, never()).launchSandbox(any());
    }

    @Test
    void groupCancellationKeepsAlreadyCompletedProgress() {
        SsSandboxRecord first = record(1, "remote-first");
        SsSandboxRecord second = record(2, "remote-second");
        var remote = SandboxRuntimeInstance.builder().sandboxId("remote-first").state("Running").reusable(true).build();
        SandboxReconcileGroup group = group(List.of(first, second), List.of(remote));
        doAnswer(call -> { SandboxReconcileCancellation.setDeadline(0); return null; }).when(cache).put(any());
        SandboxLifecycleJobReport report = run(group);
        assertThat(report.getScannedCount()).isEqualTo(2);
        assertThat(report.getSkippedCount()).isEqualTo(1);
        assertThat(report.getCancelledGroups()).isEqualTo(1);
        verify(mapper, never()).markReleased(any(), any(), any(), any());
    }

    @Test
    void cancelledFutureStillContributesProgressAndReturnedReportIsFrozen() throws Exception {
        var first = record(1, "remote-first");
        var second = record(2, "missing");
        var remote = SandboxRuntimeInstance.builder().sandboxId("remote-first").state("Running").reusable(true).build();
        SandboxReconcileGroup group = group(List.of(first, second), List.of(remote));
        ReflectionTestUtils.setField(service, "reconcileJobLockEnabled", true);
        ReflectionTestUtils.setField(service, "reconcileGroupLimit", 10);
        ReflectionTestUtils.setField(service, "reconcileMaxRecordsPerRun", 10);
        ReflectionTestUtils.setField(service, "reconcileMaxDurationMs", 30000L);
        ReflectionTestUtils.setField(service, "reconcileRemoteConcurrency", 1);
        when(mapper.countReconcileSandboxes()).thenReturn(2);
        when(mapper.selectReconcileGroups(10)).thenReturn(List.of(group));
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch workerDone = new CountDownLatch(1);
        when(mapper.markReleased(any(), any(), any(), any())).thenAnswer(call -> {
            entered.countDown();
            while (true) {
                try { release.await(); break; }
                catch (InterruptedException ignored) { /* Simulate a client still in flight. */ }
            }
            Thread.currentThread().interrupt();
            workerDone.countDown();
            return 0;
        });
        AtomicReference<SandboxLifecycleJobReport> result = new AtomicReference<>();
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Thread caller = new Thread(() -> {
            try (var redis = mockStatic(RedisUtil.class)) {
                redis.when(() -> RedisUtil.lock(anyString(), anyString(), anyLong())).thenReturn(true);
                redis.when(() -> RedisUtil.releaseLock(anyString(), anyString()))
                    .thenThrow(new IllegalStateException("interrupted Redis release"));
                result.set(service.reconcileSandboxes());
            }
            catch (Throwable e) { failure.set(e); }
        });
        try {
            caller.start();
            assertThat(entered.await(5, TimeUnit.SECONDS)).isTrue();
            caller.interrupt();
            caller.join(5000);
            assertThat(caller.isAlive()).isFalse();
            assertThat(failure.get()).isNull();
            assertThat(result.get().getScannedCount()).isEqualTo(2);
            assertThat(result.get().getSkippedCount()).isEqualTo(1);
            assertThat(result.get().getCancelledGroups()).isEqualTo(1);
            assertThat(result.get().getInFlightGroups()).isEqualTo(1);
        }
        finally {
            release.countDown();
            caller.join(5000);
        }
        assertThat(workerDone.await(5, TimeUnit.SECONDS)).isTrue();
        assertThat(result.get().getSkippedCount()).isEqualTo(1);
    }
}
