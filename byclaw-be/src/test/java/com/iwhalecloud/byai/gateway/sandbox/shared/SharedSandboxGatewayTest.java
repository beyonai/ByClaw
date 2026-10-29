package com.iwhalecloud.byai.gateway.sandbox.shared;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.util.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserInfoFactory;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

class SharedSandboxGatewayTest {
    private final SharedSandboxPlatformClient client = mock(SharedSandboxPlatformClient.class);
    private final SharedSandboxPolicy policy = mock(SharedSandboxPolicy.class);
    private final SandboxUserInfoFactory users = mock(SandboxUserInfoFactory.class);
    @SuppressWarnings("unchecked")
    private final ObjectProvider<SharedSandboxPlatformClient> provider = mock(ObjectProvider.class);

    private SharedSandboxGateway gateway() {
        when(provider.getIfAvailable()).thenReturn(client);
        when(users.build("alice")).thenReturn(Map.of("userCode", "alice", "userId", 1L, "enterpriseId", 10L));
        return new SharedSandboxGateway(provider, policy, users, new ObjectMapper());
    }

    @Test
    void eligibleUserReusesMappingOnlyAfterCheckingCurrentPolicy() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(client.call(eq("lookup"), anyMap())).thenReturn(Map.of("code", 0, "data", Map.of("sandboxId", "pool1", "endpoint", "https://example.test/u/context/", "mappingId", "m1", "isShared", true)));
        var launch = gateway.tryAcquire("alice", "byclaw-dsh");
        assertThat(launch.getSandboxId()).isEqualTo("pool1");
        assertThat(launch.getIsShared()).isTrue();
        var order = inOrder(policy, client);
        order.verify(policy).eligible("alice");
        order.verify(client).call(eq("lookup"), anyMap());
        verify(client, never()).call(eq("acquire"), anyMap());
    }

    @Test
    void revokedUserCannotReuseAnExistingMappingOnTheNextRequest() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true, false);
        when(client.call(eq("lookup"), anyMap())).thenReturn(Map.of("code", 0, "data",
            Map.of("sandboxId", "pool1", "workerAgentType", "BYCLAW_DSH_SHARED_context_1")));

        assertThat(gateway.tryAcquire("alice", "byclaw-dsh").getWorkerAgentType())
            .isEqualTo("BYCLAW_DSH_SHARED_context_1");
        clearInvocations(client, users);
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0, "data", 1));

        assertThat(gateway.tryAcquire("alice", "byclaw-dsh")).isNull();
        verify(policy, times(2)).eligible("alice");
        verify(client).call(eq("releaseAll"), argThat(p -> !p.containsKey("requestedServiceKey")
            && Long.valueOf(10).equals(p.get("enterpriseId")) && "eligibility.revoked".equals(p.get("reason"))));
        verify(client, never()).call(eq("lookup"), anyMap());
        verify(client, never()).call(eq("acquire"), anyMap());
    }

    @Test
    void revokedUserAfterBeRestartMustFinishCleanupBeforeExclusiveFallback() {
        var gateway = gateway();
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", -1, "msg", "context is busy; draining"));
        assertThatThrownBy(() -> gateway.tryAcquire("alice", "byclaw-dsh")).hasMessageContaining("draining");
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0, "data", 1));
        assertThat(gateway.tryAcquire("alice", "byclaw-dsh")).isNull();
    }

    @Test
    void userWithoutSharedMappingContinuesExclusivePathAfterNoopCleanup() {
        var gateway = gateway();
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0, "data", 0));
        assertThat(gateway.tryAcquire("alice", "byclaw-dsh")).isNull();
        verify(client).call(eq("releaseAll"), anyMap());
    }

    @Test
    void unknownCleanupAcknowledgementCannotEnableExclusiveFallback() {
        var gateway = gateway();
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0));
        assertThatThrownBy(() -> gateway.tryAcquire("alice", "byclaw-dsh")).hasMessageContaining("共享释放响应格式错误");
    }

    @Test
    void revokedWorkerLookupDoesNotReturnTheOldSharedTarget() {
        var gateway = gateway();
        when(client.call(eq("lookup"), anyMap())).thenReturn(Map.of("code", 0, "data",
            Map.of("workerAgentType", "BYCLAW_DSH_SHARED_old_1")));
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0, "data", 1));
        assertThat(gateway.currentWorkerTarget("alice")).isNull();
        verify(client, never()).call(eq("lookup"), anyMap());
    }

    @Test
    void observedRevokedUserHeartbeatReleasesInsteadOfRenewing() {
        var gateway = gateway();
        when(client.call(eq("lookupAll"), anyMap())).thenReturn(Map.of("code", 0, "data", List.of(Map.of("sandboxId", "old"))));
        gateway.infos("alice");
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0, "data", 1));
        assertThat(gateway.heartbeat("alice")).isFalse();
        verify(client).call(eq("releaseAll"), argThat(p -> "eligibility.revoked".equals(p.get("reason"))));
        verify(client, never()).call(eq("heartbeatAll"), anyMap());
    }

    @Test
    void unreadablePolicyCannotBeBypassedByAnExistingMapping() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenThrow(new IllegalStateException("configuration unavailable"));
        when(client.call(eq("lookup"), anyMap())).thenReturn(Map.of("code", 0, "data", Map.of("sandboxId", "pool1")));

        assertThatThrownBy(() -> gateway.tryAcquire("alice", "byclaw-dsh"))
            .hasMessage("configuration unavailable");
        verifyNoInteractions(client, users);
    }

    @Test
    void ineligibleUserDoesNotNeedASharedPlatformClient() {
        when(provider.getIfAvailable()).thenReturn(null);
        var gateway = new SharedSandboxGateway(provider, policy, users, new ObjectMapper());

        assertThat(gateway.tryAcquire("alice", "byclaw-dsh")).isNull();
        verify(policy).eligible("alice");
        verifyNoInteractions(client, users);
    }

    @Test
    void quotaPendingBlocksOnlyNewAcquisition() {
        var gateway=gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(policy.userNasEnabled("alice","byclaw-dsh")).thenReturn(true);
        when(client.call(eq("lookup"),anyMap())).thenReturn(Map.of("code",0));
        when(client.call(eq("prepareUserStorage"),anyMap())).thenReturn(Map.of("code",0,"data",
            Map.of("enabled",true,"ready",false,"state","WAITING_QUOTA")));
        assertThatThrownBy(()->gateway.tryAcquire("alice","byclaw-dsh"))
            .isInstanceOfSatisfying(com.iwhalecloud.byai.state.common.exception.BdpRuntimeException.class, error -> {
                assertThat(error.getErrorService()).isEqualTo("SHARED_USER_NAS_WAITING_QUOTA");
                assertThat(error.getMessage()).doesNotContain("SHARED_USER_NAS");
            });
        verify(client).call(eq("lookup"),anyMap());
        verify(client,never()).call(eq("acquire"),anyMap());
    }

    @Test
    void activeMappingBypassesNewQuotaPreparation() {
        var gateway=gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(policy.userNasEnabled("alice","byclaw-dsh")).thenReturn(true);
        when(client.call(eq("lookup"),anyMap())).thenReturn(Map.of("code",0,"data",Map.of("sandboxId","existing")));
        assertThat(gateway.tryAcquire("alice","byclaw-dsh").getSandboxId()).isEqualTo("existing");
        verify(client,never()).call(eq("prepareUserStorage"),anyMap());
    }

    @Test
    void eligibleUserUsesTrustedTenantAndSharedHostSpec() {
        var gateway = gateway();
        when(client.call(eq("lookup"), anyMap())).thenReturn(Collections.singletonMap("code", 0));
        when(policy.eligible("alice")).thenReturn(true);
        when(policy.byTenant()).thenReturn(true);
        when(client.call(eq("acquire"), anyMap())).thenReturn(Map.of("code", 0, "data", Map.of("sandboxId", "pool2")));
        assertThat(gateway.tryAcquire("alice", "byclaw-dsh").getSandboxId()).isEqualTo("pool2");
        verify(client).call(eq("acquire"), argThat(p -> Long.valueOf(10).equals(p.get("enterpriseId"))
            && Boolean.TRUE.equals(p.get("byTenant")) && Boolean.TRUE.equals(p.get("replaceExclusive"))
            && "byclaw-dsh".equals(p.get("requestedServiceKey"))));
    }

    @Test
    void newlyEligibleWorkerRoutingAcquiresSharedEvenWhileOldExclusiveWorkerIsOnline() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(client.call(eq("lookup"), anyMap())).thenReturn(Map.of("code", 0));
        when(client.call(eq("acquire"), anyMap())).thenReturn(Map.of("code", 0, "data",
            Map.of("workerAgentType", "BYCLAW_DSH_SHARED_new_2")));
        assertThat(gateway.currentWorkerTarget("alice")).isEqualTo("BYCLAW_DSH_SHARED_new_2");
        verify(client).call(eq("acquire"), argThat(p -> Boolean.TRUE.equals(p.get("replaceExclusive"))));
    }

    @Test
    void genericServiceDelegatesAliasResolutionToPlatform() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(client.call(anyString(), anyMap())).thenReturn(Collections.singletonMap("code", 0));
        assertThat(gateway.tryAcquire("alice", "custom-service")).isNull();
        verify(client).call(eq("acquire"), argThat(p -> "custom-service".equals(p.get("requestedServiceKey"))));
    }

    @Test
    void allOperationsPreserveEveryServiceMappingForTheCurrentTenant() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true);
        var launches = List.of(Map.of("sandboxId", "one", "requestedServiceKey", "byclaw-dsh"),
            Map.of("sandboxId", "two", "requestedServiceKey", "custom-service"));
        when(client.call(eq("lookupAll"), anyMap())).thenReturn(Map.of("code", 0, "data", launches));
        when(client.call(eq("heartbeatAll"), anyMap())).thenReturn(Map.of("code", 0, "data", launches));
        when(client.call(eq("releaseAll"), anyMap())).thenReturn(Map.of("code", 0, "data", 2));
        assertThat(gateway.infos("alice")).extracting(i -> i.getSandboxType()).containsExactly("byclaw-dsh", "custom-service");
        assertThat(gateway.heartbeat("alice")).isTrue();
        assertThat(gateway.release("alice")).isTrue();
        verify(client).call(eq("releaseAll"), argThat(p -> Long.valueOf(10).equals(p.get("enterpriseId")) && !p.containsKey("serviceKey")));
    }

    @Test
    void unrelatedUserHeartbeatDoesNotCallTheSharedPlatform() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(false);
        assertThat(gateway.heartbeat("alice")).isFalse();
        assertThat(gateway.heartbeat("alice", "byclaw-dsh")).isFalse();
        verifyNoInteractions(client, users);
    }

    @Test
    void policyOutageLeavesUnrelatedUsersLegacyHeartbeatAvailable() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenThrow(new IllegalStateException("configuration unavailable"));
        assertThat(gateway.heartbeat("alice")).isFalse();
        assertThat(gateway.heartbeat("alice", "byclaw-dsh")).isFalse();
        verifyNoInteractions(client, users);
    }

    @Test
    void infoPreservesTheGenerationScopedWorkerRoute() {
        var gateway = gateway();
        when(client.call(eq("lookupAll"), anyMap())).thenReturn(Map.of("code", 0, "data", List.of(
            Map.of("sandboxId", "shared-1", "requestedServiceKey", "custom-assistant", "serviceKey", "shared-host",
                "isShared", true, "workerAgentType", "BYCLAW_DSH_SHARED_context_9"))));
        Map<?, ?> info = new ObjectMapper().convertValue(gateway.infos("alice").get(0), Map.class);
        assertThat(info.get("workerAgentType")).isEqualTo("BYCLAW_DSH_SHARED_context_9");
    }

    @Test
    void singleHeartbeatAcceptsThePlatformsReadyLaunchResponse() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(client.call(eq("heartbeat"), anyMap())).thenReturn(Map.of("code", 0, "data", Map.of("sandboxId", "one")));
        assertThat(gateway.heartbeat("alice", "custom-service")).isTrue();
        verify(client).call(eq("heartbeat"), argThat(p -> "custom-service".equals(p.get("requestedServiceKey"))));
    }

    @Test
    void wrongIdentityCannotBeSentToPlatform() {
        var gateway = gateway();
        when(policy.eligible("alice")).thenReturn(true);
        when(users.build("alice")).thenReturn(Map.of("userCode", "bob", "userId", 2L, "enterpriseId", 20L));
        assertThatThrownBy(() -> gateway.tryAcquire("alice", "byclaw-dsh")).isInstanceOf(IllegalStateException.class);
        verifyNoInteractions(client);
    }
}
