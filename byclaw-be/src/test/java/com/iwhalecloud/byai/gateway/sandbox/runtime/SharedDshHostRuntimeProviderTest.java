package com.iwhalecloud.byai.gateway.sandbox.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.SetOperations;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.request.sandbox.SandboxLaunchRequest;
import com.iwhalecloud.byai.gateway.sandbox.client.model.CreateSandboxRequest;
import com.iwhalecloud.byai.gateway.sandbox.config.SandboxProperties;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.runtime.SharedDshHostClient.UserContext;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpec;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxServiceSpecRepository;
import com.iwhalecloud.byai.gateway.sandbox.spec.SandboxSpecProcessor;

class SharedDshHostRuntimeProviderTest {

    private static final String DSH = "byclaw-dsh";

    private SandboxRuntimeProvider delegate;
    private SharedDshHostClient client;
    private SharedDshHostRuntimeProvider provider;

    @BeforeEach
    void setUp() {
        delegate = mock(SandboxRuntimeProvider.class);
        when(delegate.providerType()).thenReturn("opensandbox");
        client = mock(SharedDshHostClient.class);
        provider = new SharedDshHostRuntimeProvider(delegate, client, "https://dsh.example.com/");
    }

    @Test
    void createPutsUserContextAndReturnsWebEndpointWithWebTokenAsGatewayToken() {
        when(client.ensureUser(eq("u1"), eq("byclaw-dsh-u1"), anyMap())).thenReturn(ready("u1", "/u/u1/", "wt"));
        CreateSandboxRequest request = CreateSandboxRequest.builder()
            .env(Map.of("BYAI_WORKER_ID", "byclaw-dsh-u1", "USER_CODE", "u1"))
            .metadata(Map.of("recordId", "7"))
            .build();

        SandboxRuntimeInstance instance = provider.create(request, new SandboxServiceSpec(), "u1", DSH, "idem");

        assertThat(instance.getSandboxId()).isEqualTo("byclaw-dsh-u1");
        assertThat(instance.getEndpoints()).containsExactly("https://dsh.example.com/u/u1/");
        assertThat(instance.getReusable()).isTrue();
        assertThat(instance.getMetadata())
            .containsEntry("gateway_token", "wt")
            .containsEntry("recordId", "7")
            .containsEntry("userCode", "u1")
            .containsEntry("serviceKey", DSH)
            .containsEntry(SharedDshHostRuntimeProvider.METADATA_SHARED_HOST, "host-a");
        assertThat(SandboxRuntimeRequestFactory.resolveGatewayToken(instance, request)).isEqualTo("wt");
        assertThat(provider.resolveEndpoints(instance, null, request)).containsExactly("https://dsh.example.com/u/u1/");
        assertThat(provider.resolveEndpointHeaders(instance)).isNull();
        verify(client).ensureUser("u1", "byclaw-dsh-u1", request.getEnv());
        verify(delegate, never()).create(any(), any(), any(), any(), any());
        verify(delegate, never()).resolveEndpoints(any(), any(), any());
    }

    @Test
    void createBuildsWebPathWhenHostOmitsIt() {
        when(client.ensureUser(anyString(), anyString(), any())).thenReturn(ready("a b", null, "wt"));

        SandboxRuntimeInstance instance = provider.create(null, null, "a b", DSH, "idem");

        assertThat(instance.getEndpoints()).containsExactly("https://dsh.example.com/u/a%20b/");
    }

    @Test
    void createPropagatesHostFailure() {
        when(client.ensureUser(anyString(), anyString(), any())).thenThrow(new IllegalStateException("HTTP 503"));

        assertThatThrownBy(() -> provider.create(new CreateSandboxRequest(), null, "u1", DSH, "idem"))
            .hasMessageContaining("503");
    }

    @Test
    void otherSandboxTypesGoToDelegate() {
        CreateSandboxRequest request = new CreateSandboxRequest();
        SandboxRuntimeInstance created = SandboxRuntimeInstance.builder().sandboxId("os-1").build();
        when(delegate.create(request, null, "u1", "openclaw", "idem")).thenReturn(created);
        when(delegate.findReusable("u1", "openclaw")).thenReturn(Optional.of(created));
        when(delegate.resolveEndpoints(created, null, request)).thenReturn(List.of("http://os"));
        SandboxInfo info = info("u1", "openclaw", "os-1");

        assertThat(provider.create(request, null, "u1", "openclaw", "idem")).isSameAs(created);
        assertThat(provider.findReusable("u1", "openclaw")).contains(created);
        assertThat(provider.resolveEndpoints(created, null, request)).containsExactly("http://os");
        provider.remove("u1", "openclaw", info);
        provider.heartbeat("u1", "openclaw", info);
        provider.getSandbox("u1", "openclaw", info);

        verify(delegate).remove("u1", "openclaw", info);
        verify(delegate).heartbeat("u1", "openclaw", info);
        verify(delegate).getSandbox("u1", "openclaw", info);
        verifyNoInteractions(client);
    }

    @Test
    void neverReusesThroughFindReusableForDsh() {
        assertThat(provider.findReusable("u1", DSH)).isEmpty();
        verify(delegate, never()).findReusable(any(), any());
    }

    @Test
    void removeDeletesSharedContextIncludingRecordsWithoutSandboxId() {
        provider.remove("u1", DSH, info("u1", DSH, "byclaw-dsh-u1"));
        provider.remove("u1", DSH, info("u1", DSH, null));

        verify(client, org.mockito.Mockito.times(2)).deleteUser("u1");
        verify(delegate, never()).remove(any(), any(), any());
    }

    @Test
    void preMigrationPerUserDshSandboxStaysOnDelegate() {
        SandboxInfo legacy = info("u1", DSH, "opensandbox-uuid");

        provider.remove("u1", DSH, legacy);
        provider.heartbeat("u1", DSH, legacy);
        provider.getSandbox("u1", DSH, legacy);
        provider.exists("u1", DSH, legacy);

        verify(delegate).remove("u1", DSH, legacy);
        verify(delegate).heartbeat("u1", DSH, legacy);
        verify(delegate).getSandbox("u1", DSH, legacy);
        verify(delegate).exists("u1", DSH, legacy);
        verifyNoInteractions(client);
    }

    @Test
    void heartbeatIsNoOpForSharedContext() {
        provider.heartbeat("u1", DSH, info("u1", DSH, "byclaw-dsh-u1"));

        verifyNoInteractions(client);
        verify(delegate, never()).heartbeat(any(), any(), any());
    }

    @Test
    void getSandboxMapsHostStatus() {
        SandboxInfo shared = info("u1", DSH, "byclaw-dsh-u1");
        when(client.getUser("u1")).thenReturn(status("ready"), status("starting"), status("failed"), status("absent"));

        assertThat(provider.getSandbox("u1", DSH, shared)).get()
            .satisfies(i -> {
                assertThat(i.getSandboxId()).isEqualTo("byclaw-dsh-u1");
                assertThat(i.getState()).isEqualTo("Running");
                assertThat(i.getReusable()).isTrue();
            });
        assertThat(provider.getSandbox("u1", DSH, shared)).get()
            .satisfies(i -> assertThat(i.getReusable()).isTrue());
        assertThat(provider.getSandbox("u1", DSH, shared)).get()
            .satisfies(i -> assertThat(i.getReusable()).isFalse());
        assertThat(provider.getSandbox("u1", DSH, shared)).isEmpty();
    }

    @Test
    void listMergesSharedContextIntoDshQueries() {
        SandboxRuntimeInstance legacy = SandboxRuntimeInstance.builder().sandboxId("os-old").reusable(true).build();
        when(delegate.listSandboxesByMetadata(anyMap(), anyInt(), anyInt())).thenReturn(
            SandboxRuntimePage.<SandboxRuntimeInstance>builder().items(List.of(legacy)).pageNo(1).pageSize(50).build());
        when(client.getUser("u1")).thenReturn(status("ready"));

        SandboxRuntimePage<SandboxRuntimeInstance> byKey = provider.listSandboxesByMetadata(
            Map.of("userCode", "u1", "serviceKey", DSH), 1, 50);
        SandboxRuntimePage<SandboxRuntimeInstance> byType = provider.listSandboxesByMetadata(
            Map.of("userCode", "u1", "serviceType", DSH), 1, 50);

        assertThat(byKey.safeItems()).extracting(SandboxRuntimeInstance::getSandboxId)
            .containsExactly("os-old", "byclaw-dsh-u1");
        assertThat(byKey.safeItems().get(1).getMetadata()).containsEntry("userCode", "u1");
        assertThat(byType.safeItems()).hasSize(2);
    }

    @Test
    void listLeavesOtherQueriesAloneAndSkipsAbsentContext() {
        SandboxRuntimePage<SandboxRuntimeInstance> empty = SandboxRuntimePage.empty(1, 50);
        when(delegate.listSandboxesByMetadata(anyMap(), anyInt(), anyInt())).thenReturn(empty);
        when(client.getUser("u2")).thenReturn(status("absent"));

        assertThat(provider.listSandboxesByMetadata(Map.of("userCode", "u1", "serviceKey", "openclaw"), 1, 50))
            .isSameAs(empty);
        assertThat(provider.listSandboxesByMetadata(Map.of("userCode", "u1", "serviceKey", DSH), 2, 50))
            .isSameAs(empty);
        assertThat(provider.listSandboxesByMetadata(Map.of("userCode", "u2", "serviceKey", DSH), 1, 50).safeItems())
            .isEmpty();
        verify(client, never()).getUser("u1");
    }

    @Test
    void listPropagatesHostErrorsSoReconcileDoesNotReleaseRecords() {
        when(delegate.listSandboxesByMetadata(anyMap(), anyInt(), anyInt())).thenReturn(SandboxRuntimePage.empty(1, 50));
        when(client.getUser("u1")).thenThrow(new IllegalStateException("host down"));

        assertThatThrownBy(() -> provider.listSandboxesByMetadata(Map.of("userCode", "u1", "serviceKey", DSH), 1, 50))
            .hasMessageContaining("host down");
    }

    /** Launch, status, renew and release through the real lifecycle service with a fake HTTP transport. */
    @Test
    @SuppressWarnings("unchecked")
    void lifecycleServiceDrivesSharedHostOverHttp() throws Exception {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(redis.opsForSet()).thenReturn(mock(SetOperations.class));
        when(values.setIfAbsent(any(), any(), any())).thenReturn(true);
        SandboxServiceSpecRepository specs = mock(SandboxServiceSpecRepository.class);
        SandboxServiceSpec spec = new SandboxServiceSpec();
        when(specs.findByServiceKeyAndProfile(DSH, null)).thenReturn(Optional.of(spec));
        SandboxSpecProcessor processor = mock(SandboxSpecProcessor.class);
        when(processor.buildCreateRequest(eq("u1"), eq(DSH), any(), any(), eq(spec)))
            .thenReturn(CreateSandboxRequest.builder().env(Map.of("gateway_token", "be-token")).build());

        SharedDshHostClientTest.FakeHttp http = new SharedDshHostClientTest.FakeHttp()
            .reply(200, "{\"status\":\"ready\",\"hostId\":\"host-a\",\"webPath\":\"/u/u1/\",\"webToken\":\"wt\"}")
            .reply(200, "{\"status\":\"ready\",\"busy\":false}")
            .reply(200, "");
        SharedDshHostRuntimeProvider realProvider = new SharedDshHostRuntimeProvider(delegate,
            new SharedDshHostClient(http, "http://10.0.0.5:7300", "secret"), "https://dsh.example.com");
        StandardSandboxLifecycleService lifecycle = new StandardSandboxLifecycleService(
            new SandboxProperties(), redis, specs, processor, realProvider);

        SandboxLaunchRequest launch = new SandboxLaunchRequest();
        launch.setUserCode("u1");
        launch.setSandboxType(DSH);
        launch.setEnvs(Map.of("BYAI_WORKER_ID", "byclaw-dsh-u1"));
        var launched = lifecycle.launchSandbox(launch);

        assertThat(launched.isSuccess()).isTrue();
        assertThat(launched.getData().getSandboxId()).isEqualTo("byclaw-dsh-u1");
        assertThat(launched.getData().getEndpoint()).isEqualTo("https://dsh.example.com/u/u1/");
        assertThat(launched.getData().getGatewayToken()).isEqualTo("wt");
        assertThat(launched.getData().getEndpointHeaders()).isNull();
        var putBody = new ObjectMapper().readTree(http.bodies.get(0));
        assertThat(putBody.path("sandboxId").asText()).isEqualTo("byclaw-dsh-u1");
        assertThat(putBody.path("env").path("BYAI_WORKER_ID").asText()).isEqualTo("byclaw-dsh-u1");

        SandboxInfo record = info("u1", DSH, "byclaw-dsh-u1");
        assertThat(lifecycle.sandboxExists(record).getData()).isTrue();
        assertThat(lifecycle.renewSandbox(record).isSuccess()).isTrue();
        assertThat(lifecycle.removeSandbox(record).isSuccess()).isTrue();

        assertThat(http.requests).extracting(r -> r.method() + " " + r.url().encodedPath())
            .containsExactly("PUT /v1/users/u1", "GET /v1/users/u1", "DELETE /v1/users/u1");
        verify(delegate, never()).create(any(), any(), any(), any(), any());
    }

    private static UserContext ready(String userCode, String webPath, String webToken) {
        UserContext context = new UserContext();
        context.setUserCode(userCode);
        context.setStatus("ready");
        context.setHostId("host-a");
        context.setWebPath(webPath);
        context.setWebToken(webToken);
        return context;
    }

    private static UserContext status(String status) {
        UserContext context = new UserContext();
        context.setStatus(status);
        context.setHostId("host-a");
        return context;
    }

    private static SandboxInfo info(String userCode, String sandboxType, String sandboxId) {
        return SandboxInfo.builder().userCode(userCode).sandboxType(sandboxType).sandboxId(sandboxId).build();
    }
}
