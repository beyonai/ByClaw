package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostClient.UserContext;

class SharedDshHostContextsTest {

    private final SharedDshHostClient client = mock(SharedDshHostClient.class);
    private final AtomicReference<Runnable> prewarmed = new AtomicReference<>();
    private final SharedDshHostContexts contexts = new SharedDshHostContexts(client, "https://dsh.example.com/",
        Set.of("u1")::contains, user -> Map.of("USER_CODE", user, "BEYOND_TOKEN", "jwt-" + user), prewarmed::set);

    private static UserContext context(String status, String webToken, String webPath) {
        UserContext context = new UserContext();
        context.setUserCode("u1");
        context.setStatus(status);
        context.setHostId("host-a");
        context.setWebToken(webToken);
        context.setWebPath(webPath);
        return context;
    }

    @Test
    void routesOnlyListedUsersDsh() {
        assertThat(contexts.routes("u1", "byclaw-dsh")).isTrue();
        assertThat(contexts.routes(" u1 ", "byclaw-dsh")).isTrue();
        assertThat(contexts.routes("u2", "byclaw-dsh")).isFalse();
        assertThat(contexts.routes("u1", "byclaw-dsh-tools")).isFalse();
        assertThat(contexts.routes("", "byclaw-dsh")).isFalse();
        assertThat(contexts.routes(null, "byclaw-dsh")).isFalse();
    }

    @Test
    void ensurePutsTheLaunchEnvironmentAndReturnsTheWebEndpointWithTheHostsToken() {
        when(client.ensureUser(eq("u1"), eq("byclaw-dsh-u1"), any())).thenReturn(context("ready", "wt", "/u/u1/"));

        SandboxLaunchData data = contexts.ensure("u1");

        verify(client).ensureUser("u1", "byclaw-dsh-u1", Map.of("USER_CODE", "u1", "BEYOND_TOKEN", "jwt-u1"));
        assertThat(data.getSandboxId()).isEqualTo("byclaw-dsh-u1");
        assertThat(data.getEndpoint()).isEqualTo("https://dsh.example.com/u/u1/chat?token=wt");
        assertThat(data.getEndpoints()).containsExactly("https://dsh.example.com/u/u1/chat?token=wt");
        assertThat(data.getInstanceEndpoints()).containsEntry("openclaw", "https://dsh.example.com/u/u1/chat?token=wt");
        assertThat(data.getGatewayToken()).isEqualTo("wt");
    }

    @Test
    void ensureRendersTheLaunchEnvironmentOnEveryPutSoARunningContextGetsTheCurrentToken() {
        java.util.concurrent.atomic.AtomicInteger minted = new java.util.concurrent.atomic.AtomicInteger();
        SharedDshHostContexts renewing = new SharedDshHostContexts(client, "https://dsh.example.com/", user -> true,
            user -> Map.of("USER_CODE", user, "BEYOND_TOKEN", "jwt-" + minted.incrementAndGet()), Runnable::run);
        when(client.ensureUser(eq("u1"), eq("byclaw-dsh-u1"), any())).thenReturn(context("ready", "wt", "/u/u1/"));

        renewing.ensure("u1");
        renewing.ensure("u1");

        verify(client).ensureUser("u1", "byclaw-dsh-u1", Map.of("USER_CODE", "u1", "BEYOND_TOKEN", "jwt-1"));
        verify(client).ensureUser("u1", "byclaw-dsh-u1", Map.of("USER_CODE", "u1", "BEYOND_TOKEN", "jwt-2"));
    }

    @Test
    void ensureBuildsTheWebPathWhenTheHostOmitsIt() {
        when(client.ensureUser(eq("u 1"), any(), any())).thenReturn(context("ready", "wt", null));
        assertThat(contexts.ensure("u 1").getEndpoint()).isEqualTo("https://dsh.example.com/u/u%201/chat?token=wt");
    }

    @Test
    void ensurePropagatesHostFailures() {
        when(client.ensureUser(any(), any(), any())).thenThrow(new IllegalStateException("host down"));
        assertThatThrownBy(() -> contexts.ensure("u1")).hasMessage("host down");
    }

    @Test
    void prewarmRunsEnsureOnTheExecutorAndSwallowsFailures() {
        when(client.ensureUser(any(), any(), any())).thenThrow(new IllegalStateException("host down"));
        contexts.prewarm("u1");
        verify(client, never()).ensureUser(any(), any(), any());
        prewarmed.get().run();
        verify(client).ensureUser(eq("u1"), eq("byclaw-dsh-u1"), any());
    }

    @Test
    void releaseDeletesTheContext() {
        contexts.release(" u1 ");
        verify(client).deleteUser("u1");
    }

    @Test
    void infoReadsTheHostWithoutBooting() {
        when(client.getUser("u1")).thenReturn(context("ready", "wt", "/u/u1/"));
        Optional<SandboxInfo> info = contexts.info("u1");
        verify(client, never()).ensureUser(any(), any(), any());
        assertThat(info).isPresent();
        assertThat(info.get().getSandboxId()).isEqualTo("byclaw-dsh-u1");
        assertThat(info.get().getSandboxType()).isEqualTo("byclaw-dsh");
        assertThat(info.get().getEndpoints()).isEqualTo(List.of("https://dsh.example.com/u/u1/chat?token=wt"));
        assertThat(info.get().getWorkerOnline()).isTrue();

        when(client.getUser("u1")).thenReturn(UserContext.absent());
        assertThat(contexts.info("u1")).isEmpty();
    }

    @Test
    void userFilterReadsTheParameterOnEveryDecisionAndDefaultsToNobody() {
        AtomicReference<String> value = new AtomicReference<>("u1, u2");
        var filter = SharedDshHostContexts.userFilter(value::get);
        assertThat(filter.test("u1")).isTrue();
        assertThat(filter.test("u3")).isFalse();
        value.set("*");
        assertThat(filter.test("u3")).isFalse();
        value.set(null);
        assertThat(filter.test("u3")).isFalse();
        assertThat(SharedDshHostContexts.userFilter(() -> { throw new IllegalStateException("db"); }).test("u9")).isFalse();
        assertThat(SharedDshHostContexts.allowsUser("a;b c", "b")).isTrue();
        assertThat(SharedDshHostContexts.allowsUser("a;b c", "d")).isFalse();
        assertThat(SharedDshHostContexts.allowsUser("a,a;; b", "a")).isTrue();
        assertThat(SharedDshHostContexts.allowsUser("user11", "user1")).isFalse();
    }
}
