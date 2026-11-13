package com.iwhalecloud.byai.gateway.sandbox.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.client.OpenSandboxClient;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SandboxRuntimeInstance;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import java.util.Date;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.server.ResponseStatusException;

class TenantSandboxHarnessTest {
    private static final String TYPE = TenantSandboxService.HARNESS_TYPE;
    private static final String KEY = "command-41:HARNESS_CREATE";
    private static final long ENTERPRISE = 1L;
    private static final long RECORD_ID = 31L;

    private final SandboxLifecycleFacade provider = mock(SandboxLifecycleFacade.class);
    private final SandboxServiceSpecRepository specs = mock(SandboxServiceSpecRepository.class);
    private final SsSandboxRecordMapper records = mock(SsSandboxRecordMapper.class);
    private final TenantSandboxService service = new TenantSandboxService(provider, mock(OpenSandboxClient.class),
        specs, records, new ObjectMapper(), "/tmp", "redis", "6379", "0", "default", "password",
        "", "", "");
    private final SandboxServiceSpec spec = new SandboxServiceSpec();

    @BeforeEach
    void configureSpec() {
        spec.setOwnerScope("TENANT");
        spec.setServiceType(TYPE);
        spec.setProfileKey("s");
        spec.setImage("harness-test");
        spec.setResourceLimits(Map.of("cpu", "1", "memory", "1Gi"));
        spec.setEnv(Map.of(
            "BYCLAW_HARNESS_TENANT_ID", "${envVars.BYCLAW_HARNESS_TENANT_ID}",
            "BYCLAW_HARNESS_WORKER_ID", "${envVars.BYCLAW_HARNESS_WORKER_ID}"));
        when(specs.findByServiceKeyAndProfile(TYPE, "s")).thenReturn(Optional.of(spec));
    }

    @Test
    void reservesTenantSlotBeforeLaunchingAndPersistsProviderExpiry() {
        generateIdOnInsert();
        SandboxLaunchData launched = stubSuccess(0);

        assertThat(service.ensureHarness(ENTERPRISE, "s", KEY))
            .isEqualTo(new TenantSandboxService.TenantSandboxView(RECORD_ID, "sandbox-new", null));

        var order = inOrder(records, provider);
        var record = ArgumentCaptor.forClass(SsSandboxRecord.class);
        var request = ArgumentCaptor.forClass(SandboxLaunchRequest.class);
        order.verify(records).insert(record.capture());
        order.verify(provider).launchSandbox(request.capture());
        order.verify(records).updateLaunchSuccess(eq(RECORD_ID), eq("sandbox-new"), isNull(), isNull(),
            eq(3600), eq(launched.getRemoteExpiresAt()), isNull(), isNull(), any(Date.class), eq(0));
        assertThat(record.getValue()).satisfies(row -> {
            assertThat(row.getOwnerScope()).isEqualTo("TENANT");
            assertThat(row.getEnterpriseId()).isEqualTo(ENTERPRISE);
            assertThat(row.getResourceId()).isEqualTo(ENTERPRISE);
            assertThat(row.getUserCode()).isEqualTo("tenant-harness-1");
            assertThat(row.getSandboxType()).isEqualTo(TYPE);
            assertThat(row.getStatus()).isEqualTo("STARTING");
            assertThat(row.getLeasePolicy()).isEqualTo("MANUAL");
        });
        assertThat(request.getValue().getUserInfo()).containsEntry("enterpriseId", "1");
        assertThat(request.getValue().getSkipReusableSandbox()).isTrue();
        assertThat(request.getValue().getMetadata()).containsEntry("providerRequestKey", KEY)
            .containsEntry("ownerScope", "TENANT").containsEntry("recordId", "31").containsEntry("resourceId", "1");
        assertThat(request.getValue().getEnvs()).containsEntry("BYCLAW_HARNESS_TENANT_ID", "1")
            .containsEntry("BYCLAW_HARNESS_WORKER_ID", "tenant-harness-1-31")
            .containsEntry("REDIS_MODE", "standalone").containsEntry("REDIS_HOST", "redis")
            .doesNotContainKeys("DB_NAME", "INTERNAL_API_TOKEN");
    }

    @Test
    void unknownProviderOutcomeKeepsReservationAndCannotLaunchAgain() {
        var starting = record("STARTING", null, 0);
        when(records.selectActiveTenantByResourceAndType(ENTERPRISE, TYPE)).thenReturn(null, starting);
        generateIdOnInsert();
        when(provider.launchSandbox(any())).thenReturn(SandboxResponse.error("timeout"));

        expectReason("tenant.harness.launch.outcomeUnknown");
        expectReason("tenant.harness.launch.inProgress");

        verify(records, never()).updateStatusToFailed(any(), any(), any(), any());
        verify(records, never()).updateStatusToReleased(any(), any(), any(), any());
        verify(records).insert(any());
        verify(provider).launchSandbox(any());
        verifyNoMoreInteractions(provider);
    }

    @Test
    void onlyTrustedTemplateWaitRetriesSameRecordAndCorrelation() {
        generateIdOnInsert();
        var waiting = record("STARTING", null, 1);
        String marker = TenantSandboxService.TemplatePreparingException.CODE + ":" + KEY;
        waiting.setReleaseReason(marker);
        when(records.selectActiveTenantByResourceAndType(ENTERPRISE, TYPE)).thenReturn(null, waiting);
        when(records.updateTenantTemplateWait(eq(RECORD_ID), isNull(), eq(marker), any(Date.class), eq(0)))
            .thenReturn(1);
        when(records.updateTenantTemplateWait(eq(RECORD_ID), eq(marker), isNull(), any(Date.class), eq(1)))
            .thenReturn(1);
        SandboxLaunchData launched = stubSuccess(2);
        when(provider.launchSandbox(any())).thenReturn(
            SandboxResponse.error(TenantSandboxService.TemplatePreparingException.CODE),
            SandboxResponse.success(launched));

        assertThatThrownBy(() -> service.ensureHarness(ENTERPRISE, "s", KEY))
            .isInstanceOf(TenantSandboxService.TemplatePreparingException.class);
        assertThat(service.ensureHarness(ENTERPRISE, "s", KEY).recordId()).isEqualTo(RECORD_ID);

        var order = inOrder(provider, records);
        var request = ArgumentCaptor.forClass(SandboxLaunchRequest.class);
        order.verify(provider).launchSandbox(request.capture());
        order.verify(records).updateTenantTemplateWait(eq(RECORD_ID), isNull(), eq(marker), any(Date.class), eq(0));
        order.verify(records).updateTenantTemplateWait(eq(RECORD_ID), eq(marker), isNull(), any(Date.class), eq(1));
        order.verify(provider).launchSandbox(request.capture());
        assertThat(request.getAllValues()).allSatisfy(value ->
            assertThat(value.getMetadata()).containsEntry("recordId", "31").containsEntry("providerRequestKey", KEY));
        verify(records).insert(any());
    }

    @Test
    void retainsLiveRecordAfterItsProfileIsDisabled() {
        when(specs.findByServiceKeyAndProfile(TYPE, "s")).thenReturn(Optional.empty());
        when(records.selectActiveTenantByResourceAndType(ENTERPRISE, TYPE))
            .thenReturn(record("RUNNING", "sandbox-old", 4));
        when(provider.getSandbox(any())).thenReturn(SandboxResponse.success(
            SandboxRuntimeInstance.builder().sandboxId("sandbox-old").state("Running").build()));

        assertThat(service.ensureHarness(ENTERPRISE, "s", KEY).sandboxId()).isEqualTo("sandbox-old");

        verify(records, never()).insert(any());
        verify(provider, never()).launchSandbox(any());
    }

    @Test
    void explicitlyAbsentProviderSandboxIsReleasedBeforeReplacement() {
        var prior = record("RUNNING", "sandbox-old", 4);
        prior.setId(30L);
        when(records.selectActiveTenantByResourceAndType(ENTERPRISE, TYPE)).thenReturn(prior);
        when(provider.getSandbox(any())).thenReturn(SandboxResponse.success(null));
        when(records.updateStatusToReleased(eq(30L), any(), any(Date.class), eq(4))).thenReturn(1);
        generateIdOnInsert();
        stubSuccess(0);

        assertThat(service.ensureHarness(ENTERPRISE, "s", KEY).sandboxId()).isEqualTo("sandbox-new");

        var order = inOrder(records, provider);
        order.verify(provider).getSandbox(any());
        order.verify(records).updateStatusToReleased(eq(30L), any(), any(Date.class), eq(4));
        order.verify(records).insert(any());
        order.verify(provider).launchSandbox(any());
    }

    @Test
    void concurrentReservationFailureNeverCallsProvider() {
        when(records.insert(any())).thenThrow(new DuplicateKeyException("active row exists"));

        expectReason("tenant.harness.launch.inProgress");

        verifyNoInteractions(provider);
    }

    @Test
    void missingIdentityPlaceholdersAreRejectedBeforeAnyResourceMutation() {
        spec.setEnv(Map.of("BYCLAW_HARNESS_WORKER_ID", "tenant-harness-1-31"));

        expectReason("tenant.harness.spec.identityEnvironmentMissing");

        verify(records).selectActiveTenantByResourceAndType(ENTERPRISE, TYPE);
        verifyNoMoreInteractions(records);
        verifyNoInteractions(provider);
    }

    private void expectReason(String reason) {
        assertThatThrownBy(() -> service.ensureHarness(ENTERPRISE, "s", KEY))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getReason()).isEqualTo(reason));
    }

    private void generateIdOnInsert() {
        doAnswer(call -> {
            call.<SsSandboxRecord>getArgument(0).setId(RECORD_ID);
            return 1;
        }).when(records).insert(any());
    }

    private SandboxLaunchData stubSuccess(int lockVersion) {
        var result = new SandboxLaunchData();
        result.setSandboxId("sandbox-new");
        result.setTimeoutSeconds(3600);
        result.setRemoteExpiresAt(new Date(2_000_000_000_000L));
        when(provider.launchSandbox(any())).thenReturn(SandboxResponse.success(result));
        when(records.updateLaunchSuccess(eq(RECORD_ID), eq("sandbox-new"), isNull(), isNull(),
            eq(3600), eq(result.getRemoteExpiresAt()), isNull(), isNull(), any(Date.class), eq(lockVersion)))
            .thenReturn(1);
        return result;
    }

    private SsSandboxRecord record(String status, String sandboxId, int lockVersion) {
        var row = new SsSandboxRecord();
        row.setId(RECORD_ID);
        row.setUserCode("tenant-harness-1");
        row.setSandboxType(TYPE);
        row.setServiceType(TYPE);
        row.setStatus(status);
        row.setProfileKey("s");
        row.setSandboxId(sandboxId);
        row.setLockVersion(lockVersion);
        return row;
    }
}
