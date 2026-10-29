package com.iwhalecloud.byai.gateway.route;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformBackgroundExecution;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformControlClient;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLoginAutoStartService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;

class WorkerLoginStartupConcurrencyTest extends I18nTestSupport {

    @ParameterizedTest
    @NullSource
    @ValueSource(longs = {123L})
    void firstChatJoinsLoginLaunchThroughPlatformEvenFromAnotherBackend(Long chatResourceId) throws Exception {
        PlatformControlClient client = mock(PlatformControlClient.class);
        WorkerRegistry registry = mock(WorkerRegistry.class);
        AtomicBoolean online = new AtomicBoolean();
        when(registry.hasOnlineAgentType("BYCLAW_DSH_u1", true)).thenAnswer(invocation ->
            new WorkerRegistry.OnlineAgentCheckResult(online.get(), Collections.emptyList()));
        CountDownLatch loginEntered = new CountDownLatch(1);
        CountDownLatch chatEntered = new CountDownLatch(1);
        CountDownLatch releaseLaunch = new CountDownLatch(1);
        java.util.concurrent.atomic.AtomicInteger ensureCalls = new java.util.concurrent.atomic.AtomicInteger();
        when(client.call(eq("sandbox"), any(), any())).thenAnswer(invocation -> {
            String operation = invocation.getArgument(1);
            if (loginEntered.getCount() == 0) chatEntered.countDown();
            else loginEntered.countDown();
            assertThat(operation).isEqualTo("business/launch");
            Map<?, ?> params = invocation.getArgument(2);
            if (Boolean.TRUE.equals(params.get("verifyExisting"))) ensureCalls.incrementAndGet();
            Map<?, ?> routing = (Map<?, ?>) params.get("routing");
            assertThat(routing.get("sandboxType")).isEqualTo("byclaw-dsh");
            assertThat(((Number) routing.get("effectiveResourceId")).longValue()).isEqualTo(-1L);
            assertThat(releaseLaunch.await(5, TimeUnit.SECONDS)).isTrue();
            online.set(true);
            return Map.of("code", 0, "data", Map.of("sandboxId", "same-login-sandbox"));
        });
        SandboxServiceSpecEntityMapper specs = mock(SandboxServiceSpecEntityMapper.class);
        SandboxServiceSpecEntity spec = new SandboxServiceSpecEntity();
        spec.setServiceKey("byclaw-dsh");
        when(specs.selectAutoStartSpecs()).thenReturn(List.of(spec));
        TargetAgentResolver resolver = mock(TargetAgentResolver.class);
        when(resolver.isUserSandboxAgentType("BYCLAW_DSH_u1", "u1")).thenReturn(true);
        // Separate services model distinct BE nodes: correctness cannot depend on a shared local future.
        WorkerRouteReadinessService readiness = new WorkerRouteReadinessService(
            registry, remoteService(client, registry), resolver);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            new SandboxLoginAutoStartService(specs, remoteService(client, registry), executor).trigger("u1");
            assertThat(loginEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<?> chat = executor.submit(() -> readiness.ensureReady("u1", chatResourceId, "BYCLAW_DSH_u1", null));
            assertThat(chatEntered.await(5, TimeUnit.SECONDS)).isTrue();
            releaseLaunch.countDown();
            chat.get(5, TimeUnit.SECONDS);
            executor.shutdown();
            assertThat(executor.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
            verify(client, org.mockito.Mockito.times(2)).call(eq("sandbox"), eq("business/launch"), any());
            verify(client, never()).call(eq("sandbox"), eq("business/restart"), any());
            assertThat(ensureCalls).hasValue(1);
        }
        finally {
            releaseLaunch.countDown();
            executor.shutdownNow();
        }
    }

    @SuppressWarnings("unchecked")
    @org.junit.jupiter.api.Test
    void sharedLoginAndFirstChatUseTheSameAcquireContractWithoutRestartOrRelease() throws Exception {
        var client = mock(com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxPlatformClient.class);
        var policy = mock(com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxPolicy.class);
        var users = mock(com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserInfoFactory.class);
        ObjectProvider<com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxPlatformClient> clients = mock(ObjectProvider.class);
        when(clients.getIfAvailable()).thenReturn(client);
        when(policy.eligible("u1")).thenReturn(true);
        when(users.build("u1")).thenReturn(Map.of("userCode", "u1", "userId", 1L, "enterpriseId", 10L));
        when(client.call(eq("lookup"), any())).thenReturn(Map.of("code", 0));
        CountDownLatch firstEntered = new CountDownLatch(1), bothEntered = new CountDownLatch(2), release = new CountDownLatch(1);
        AtomicBoolean online = new AtomicBoolean();
        when(client.call(eq("acquire"), any())).thenAnswer(invocation -> {
            Map<?, ?> payload = invocation.getArgument(1);
            assertThat(payload.get("requestedServiceKey")).isEqualTo("byclaw-dsh");
            assertThat(payload.get("userCode")).isEqualTo("u1");
            assertThat(payload.get("enterpriseId")).isEqualTo(10L);
            firstEntered.countDown(); bothEntered.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            online.set(true);
            return Map.of("code", 0, "data", Map.of("sandboxId", "shared-instance", "mappingId", "same-member",
                "workerAgentType", "BYCLAW_DSH_SHARED_context", "isShared", true));
        });
        WorkerRegistry registry = mock(WorkerRegistry.class);
        when(registry.hasOnlineAgentType("BYCLAW_DSH_SHARED_context", true)).thenAnswer(invocation ->
            new WorkerRegistry.OnlineAgentCheckResult(online.get(), Collections.emptyList()));
        SandboxService loginSandbox = new SandboxService(), chatSandbox = new SandboxService();
        for (SandboxService service : List.of(loginSandbox, chatSandbox)) {
            ReflectionTestUtils.setField(service, "sharedSandboxGateway",
                new com.iwhalecloud.byai.gateway.sandbox.shared.SharedSandboxGateway(clients, policy, users, new ObjectMapper()));
            ReflectionTestUtils.setField(service, "gatewayWorkerRegistry", registry);
        }
        var specs = mock(SandboxServiceSpecEntityMapper.class);
        SandboxServiceSpecEntity spec = new SandboxServiceSpecEntity(); spec.setServiceKey("byclaw-dsh");
        when(specs.selectAutoStartSpecs()).thenReturn(List.of(spec));
        TargetAgentResolver resolver = mock(TargetAgentResolver.class);
        when(resolver.isUserSandboxAgentType("BYCLAW_DSH_SHARED_context", "u1")).thenReturn(true);
        WorkerRouteReadinessService readiness = new WorkerRouteReadinessService(registry, chatSandbox, resolver);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            new SandboxLoginAutoStartService(specs, loginSandbox, executor).trigger("u1");
            assertThat(firstEntered.await(2, TimeUnit.SECONDS)).isTrue();
            Future<?> chat = executor.submit(() -> readiness.ensureReady("u1", 123L, "BYCLAW_DSH_SHARED_context", null));
            assertThat(bothEntered.await(2, TimeUnit.SECONDS)).isTrue();
            release.countDown(); chat.get(2, TimeUnit.SECONDS);
            executor.shutdown(); assertThat(executor.awaitTermination(2, TimeUnit.SECONDS)).isTrue();
            verify(client, org.mockito.Mockito.times(2)).call(eq("acquire"), any());
            verify(client, never()).call(eq("releaseMember"), any());
            verify(client, never()).call(eq("releaseAll"), any());
        }
        finally { release.countDown(); executor.shutdownNow(); }
    }

    @SuppressWarnings("unchecked")
    private SandboxService remoteService(PlatformControlClient client, WorkerRegistry registry) {
        ObjectProvider<PlatformControlClient> clients = mock(ObjectProvider.class);
        when(clients.getObject()).thenReturn(client);
        PlatformRemoteGateway gateway = new PlatformRemoteGateway(mock(PlatformBackgroundExecution.class), clients,
            new ObjectMapper(), new MockEnvironment().withProperty("byclaw.platform.base-url", "http://platform"));
        ObjectProvider<PlatformRemoteGateway> gateways = mock(ObjectProvider.class);
        when(gateways.getObject()).thenReturn(gateway);
        SandboxService service = new SandboxService();
        ReflectionTestUtils.setField(service, "platformGatewayProvider", gateways);
        ReflectionTestUtils.setField(service, "gatewayWorkerRegistry", registry);
        return service;
    }
}
