package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.anyLong;
import static org.mockito.Mockito.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatusResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService.ConnectorCliWorkspace;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class WecomCliAuthorizationProviderTest {

    private static final List<String> INIT_COMMAND =
        List.of("wecom-cli", "init", "--noninteractive", "--no-open");
    private static final List<String> CACHE_STATUS_COMMAND =
        List.of("wecom-cli", "cache", "status");
    private static final List<String> PROBE_COMMAND =
        List.of("wecom-cli", "contact", "get_userlist", "{}");
    private static final String VALID_CACHE_OUTPUT = "[{\"account\":\"wecom-user\"}]";
    private static final String VALID_DIRECT_PROBE_OUTPUT = """
        {"errcode":0,"errmsg":"ok","userlist":[
          {"userid":"zhangsan","name":"张三","alias":"Sam"},
          {"userid":"lisi","name":"李四","alias":""}
        ]}
        """;
    private static final String VALID_JSON_RPC_PROBE_OUTPUT = """
        {"jsonrpc":"2.0","id":1,"result":{"content":[
          {"type":"text","text":"{\\\"errcode\\\":0,\\\"errmsg\\\":\\\"ok\\\",\\\"userlist\\\":[]} "}
        ],"isError":false}}
        """;
    private static final String VALID_PROVIDER_STATE = """
        {"authorizationTimeoutSeconds":120,
         "probeCommand":["wecom-cli","contact","get_userlist","{}"]}
        """;
    private static final Map<String, String> ENVIRONMENT = Map.of("HOME", "/tmp/wecom-cli-test");
    private static final ConnectorCliWorkspace WORKSPACE = new ConnectorCliWorkspace(
        Path.of("/tmp/wecom-cli-test"), ENVIRONMENT);

    private final ConnectorCliRunner cliRunner = mock(ConnectorCliRunner.class);
    private final ConnectorCredentialWorkspaceService workspaceService =
        mock(ConnectorCredentialWorkspaceService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final MutableClock clock = new MutableClock(Instant.parse("2026-08-02T08:00:00Z"));
    private final ScheduledExecutorService cleanupExecutor = mock(ScheduledExecutorService.class);
    private final ScheduledFuture<?> cleanupFuture = mock(ScheduledFuture.class);

    private WecomCliAuthorizationProvider provider;
    private Runnable cleanupTask;

    @BeforeEach
    void setUp() {
        when(cleanupExecutor.scheduleWithFixedDelay(
            any(Runnable.class), anyLong(), anyLong(), eq(TimeUnit.MILLISECONDS)))
            .thenAnswer(invocation -> {
                cleanupTask = invocation.getArgument(0);
                return cleanupFuture;
            });
        provider = new WecomCliAuthorizationProvider(
            cliRunner,
            workspaceService,
            objectMapper,
            Duration.ofMillis(50),
            Duration.ofMillis(1),
            clock,
            cleanupExecutor
        );
    }

    @AfterEach
    void tearDown() {
        provider.shutdown();
    }

    @Test
    void verifiesExistingWecomCredentialWithTrustedBusinessProbe() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(eq(CACHE_STATUS_COMMAND), eq(ENVIRONMENT), eq(null), any(Duration.class)))
            .thenReturn(new CliResult(0, VALID_CACHE_OUTPUT));
        when(cliRunner.run(eq(PROBE_COMMAND), eq(ENVIRONMENT), eq(null), any(Duration.class)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStatusResult result = provider.verify("42", connector(VALID_PROVIDER_STATE));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).run(eq(PROBE_COMMAND), eq(ENVIRONMENT), eq(null), any(Duration.class));
    }

    @Test
    void rejectsWecomInitializationWithoutValidBusinessProbe() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(eq(CACHE_STATUS_COMMAND), eq(ENVIRONMENT), eq(null), any(Duration.class)))
            .thenReturn(new CliResult(0, VALID_CACHE_OUTPUT));
        when(cliRunner.run(eq(PROBE_COMMAND), eq(ENVIRONMENT), eq(null), any(Duration.class)))
            .thenReturn(new CliResult(0, "{\"errcode\":40014,\"errmsg\":\"invalid token\"}"));

        AuthorizationStatusResult result = provider.verify("42", connector(VALID_PROVIDER_STATE));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("CONNECTOR_CREDENTIAL_INVALID");
    }

    @Test
    void mapsWecomCredentialVerificationTimeoutToRetryableErrorCode() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(eq(CACHE_STATUS_COMMAND), eq(ENVIRONMENT), eq(null), any(Duration.class)))
            .thenReturn(new CliResult(124, "partial cache status"));

        AuthorizationStatusResult result = provider.verify("42", connector(VALID_PROVIDER_STATE));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("CONNECTOR_VERIFICATION_TIMEOUT");
        assertThat(result.errorMessage()).doesNotContain("partial cache status");
    }

    private ConnectorInfo connector(String authConfig) {
        ConnectorInfo connector = new ConnectorInfo();
        connector.setAuthConfig(authConfig);
        return connector;
    }

    @Test
    void productionDependencyConstructorIsTheOnlyAutowiredConstructor() {
        assertThat(WecomCliAuthorizationProvider.class.getDeclaredConstructors())
            .filteredOn(constructor -> constructor.isAnnotationPresent(Autowired.class))
            .singleElement()
            .satisfies(constructor -> assertThat(constructor.getParameterTypes()).containsExactly(
                ConnectorCliRunner.class,
                ConnectorCredentialWorkspaceService.class,
                ObjectMapper.class
            ));
    }

    @Test
    void startUsesIsolatedHomeAndReturnsFirstSanitizedAuthorizationUrl() throws Exception {
        AuthorizationStartContext context = startContext(Map.of(
            "authorizationTimeoutSeconds", 120,
            "probeCommand", PROBE_COMMAND
        ));
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive(
            "\u001B[32m请扫码\u001B[0m https://open.work.weixin.qq.com/wwopen/sso/qrConnect?state=abc\n"
                + "https://ignored.example.com"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult result = provider.start(context);

        assertThat(provider.providerCode()).isEqualTo("wecom-cli");
        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl())
            .isEqualTo("https://open.work.weixin.qq.com/wwopen/sso/qrConnect?state=abc");
        assertThat(result.expiresAt()).isNotNull();
        assertThat(result.expiresAt().getTime()).isEqualTo(clock.millis() + 120_000L);
        assertThat(result.providerSessionId()).isNull();
        JsonNode expectedState = objectMapper.valueToTree(Map.of(
            "authorizationTimeoutSeconds", 120,
            "probeCommand", PROBE_COMMAND
        ));
        assertThat(objectMapper.readTree(result.providerState())).isEqualTo(expectedState);
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        assertThat(process.destroyed).isFalse();
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).start(INIT_COMMAND, ENVIRONMENT, null);
    }

    @Test
    void startWaitsForCompleteLineBeforeReturningAuthorizationUrl() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.aliveSnapshots(
            "请扫码 https://auth.example.com/com",
            "请扫码 https://auth.example.com/complete\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://auth.example.com/complete");
    }

    @Test
    void startWaitsForExitedProcessOutputToFinishDraining() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.exitedWhileOutputDrains(
            "请扫码 https://auth.example.com/com",
            "请扫码 https://auth.example.com/complete\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://auth.example.com/complete");
        assertThat(result.errorCode()).isNull();
    }

    @Test
    void startRejectsOutOfRangeTimeoutBeforeResolvingWorkspace() {
        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "authorizationTimeoutSeconds", Long.MAX_VALUE
        )));

        assertFailedStart(
            result,
            "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration"
        );
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @ParameterizedTest
    @ValueSource(longs = {89L, 901L})
    void startRejectsTimeoutOutsideInclusiveRangeBeforeResolvingWorkspace(long timeoutSeconds) {
        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "authorizationTimeoutSeconds", timeoutSeconds
        )));

        assertFailedStart(
            result,
            "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration"
        );
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @ParameterizedTest
    @ValueSource(longs = {90L, 900L})
    void startAcceptsInclusiveTimeoutBoundariesAndUsesDefaultProbeCommand(long timeoutSeconds) throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive("https://auth.example.com/boundary\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "authorizationTimeoutSeconds", timeoutSeconds
        )));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://auth.example.com/boundary");
        assertThat(result.expiresAt().getTime())
            .isEqualTo(clock.millis() + timeoutSeconds * 1_000L);
        JsonNode providerState = objectMapper.readTree(result.providerState());
        assertThat(providerState.path("authorizationTimeoutSeconds").asLong()).isEqualTo(timeoutSeconds);
        assertThat(providerState.path("probeCommand")).isEqualTo(objectMapper.valueToTree(PROBE_COMMAND));
    }

    @Test
    void startRejectsArbitraryProbeCommandBeforeResolvingWorkspace() {
        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "probeCommand", List.of("sh", "-c", "printenv")
        )));

        assertFailedStart(
            result,
            "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration"
        );
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidProbeCommands")
    void startRejectsInvalidProbeCommandBeforeResolvingWorkspace(String caseName, Object probeCommand) {
        AuthorizationStartResult result = provider.start(startContext(providerConfigWithProbeCommand(probeCommand)));

        assertFailedStart(
            result,
            "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration"
        );
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidUserIds")
    void startRejectsInvalidUserBeforeResolvingWorkspace(String caseName, String userId) {
        AuthorizationStartResult result = provider.start(startContext(userId, Map.of()));

        assertFailedStart(result, "INVALID_USER", "Invalid user");
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @Test
    void startSanitizesWorkspaceResolutionException() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenThrow(new IllegalStateException(
            "workspace=/tmp/private token=secret-value command=printenv url=https://private.example.com"
        ));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(
            result,
            "PROVIDER_WORKSPACE_ERROR",
            "Unable to prepare the WeCom credential workspace"
        );
        verify(workspaceService).resolve(42L, "wecom-cli");
        verifyNoInteractions(cliRunner);
    }

    @Test
    void startSanitizesRunnerStartException() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenThrow(new IllegalStateException(
            "workspace=/tmp/private token=secret-value command=wecom-cli url=https://private.example.com"
        ));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "PROVIDER_START_FAILED", "Unable to start WeCom authorization");
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).start(INIT_COMMAND, ENVIRONMENT, null);
    }

    @Test
    void startRejectsNullProcessFromRunner() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(null);

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "PROVIDER_START_FAILED", "Unable to start WeCom authorization");
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).start(INIT_COMMAND, ENVIRONMENT, null);
    }

    @Test
    void startRejectsTruncatedOutputAndRemovesProcess() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess truncatedProcess = FakeManagedProcess.truncated(
            "token=secret-value https://private.example.com/authorize\n"
        );
        FakeManagedProcess retryProcess = FakeManagedProcess.alive("https://auth.example.com/retry\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(truncatedProcess, retryProcess);

        AuthorizationStartResult failed = provider.start(startContext(Map.of()));
        AuthorizationStartResult retried = provider.start(startContext(Map.of()));

        assertFailedStart(failed, "PROVIDER_START_FAILED", "Unable to start WeCom authorization");
        assertThat(truncatedProcess.destroyed).isTrue();
        assertThat(retried.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(retried.authorizationUrl()).isEqualTo("https://auth.example.com/retry");
    }

    @Test
    void startSanitizesMissingUrlFromCompletedProcessAndRemovesIt() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess completedProcess = FakeManagedProcess.exited(
            17,
            "token=secret-value workspace=/tmp/private command=printenv https://)\n"
        );
        FakeManagedProcess retryProcess = FakeManagedProcess.alive("https://auth.example.com/retry\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(completedProcess, retryProcess);
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStartResult failed = provider.start(startContext(Map.of()));
        AuthorizationStartResult retried = provider.start(startContext(Map.of()));

        assertFailedStart(
            failed,
            "PROVIDER_AUTH_URL_MISSING",
            "WeCom authorization URL was not provided"
        );
        assertThat(completedProcess.destroyed).isTrue();
        assertThat(retried.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(retried.authorizationUrl()).isEqualTo("https://auth.example.com/retry");
        verifyNoCliRuns();
    }

    @Test
    void startConnectsWhenSuccessfulInitWithoutUrlHasValidCredentials() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.exited(0, "authorization already initialized\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.authorizationUrl()).isNull();
        assertThat(result.expiresAt()).isNotNull();
        assertThat(result.expiresAt().getTime()).isEqualTo(clock.millis() + 120_000L);
        assertThat(result.providerSessionId()).isNull();
        assertThat(objectMapper.readTree(result.providerState())).isEqualTo(objectMapper.readTree(
            VALID_PROVIDER_STATE
        ));
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        assertThat(process.destroyed).isTrue();
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void startReturnsProbeFailureWhenSuccessfulInitCompletesWithoutUrl() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.exited(
            0,
            "token=secret-value workspace=/tmp/private https://)\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "[]"));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "{\"errcode\":40014,\"errmsg\":\"invalid token\"}"));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(
            result,
            "PROVIDER_PROBE_FAILED",
            "WeCom authorization probe failed"
        );
        assertThat(process.destroyed).isTrue();
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void startIgnoresUrlsHiddenInsideOscSequences() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive(
            "\u001B]8;;https://hidden-bel.example.com\u0007BEL link\u001B]8;;\u0007 "
                + "\u001B]8;;https://hidden-st.example.com\u001B\\ST link\u001B]8;;\u001B\\ "
                + "https://visible.example.com/authorize\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://visible.example.com/authorize");
    }

    @Test
    void startSkipsMalformedAuthorizationUrlCandidates() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive(
            "https://)\nhttps://valid.example.com/authorize\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://valid.example.com/authorize");
    }

    @Test
    void queryStatusRejectsMissingProviderStateWithoutProcessHandle() {
        AuthorizationStatusResult result = provider.queryStatus(sessionContext());

        assertFailedStatus(result, "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration");
    }

    @Test
    void queryStatusKeepsRegisteredAliveInitializationPendingWithoutRunningProbes() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive("https://auth.example.com/authorize\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult started = provider.start(startContext(Map.of()));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(started));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).start(INIT_COMMAND, ENVIRONMENT, null);
        verifyNoCliRuns();
        verifyNoMoreInteractions(workspaceService, cliRunner);
    }

    @Test
    void queryStatusRunsExactCacheCheckAfterSuccessfulInitializationCompletes() {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(1, "token=secret-value https://private.example.com"));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
        assertThat(authorization.process().destroyed).isTrue();
        verify(workspaceService, times(2)).resolve(42L, "wecom-cli");
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner, never()).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidCacheResults")
    void queryStatusRejectsInvalidCacheStatusBeforeBusinessProbe(String caseName, CliResult cacheResult) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(cacheResult);

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
        verify(cliRunner, never()).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void queryStatusAcceptsEmptyServiceDiscoveryCacheBeforeBusinessProbe() {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "[]"));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void queryStatusRunsSnapshottedProviderStateProbeAfterValidCacheStatus() {
        List<String> snapshottedProbe =
            List.of("wecom-cli", "contact", "get_userlist", "{\"department_id\":1}");
        StartedAuthorization authorization = startCompletedAuthorization(Map.of(
            "probeCommand", snapshottedProbe
        ));
        stubValidCacheStatus();
        when(cliRunner.run(snapshottedProbe, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(7, "token=secret-value https://private.example.com"));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
        verify(cliRunner).run(snapshottedProbe, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("successfulBusinessProbeOutputs")
    void queryStatusConnectsAfterValidCacheAndBusinessProbe(String caseName, String probeOutput) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, probeOutput));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        assertThat(authorization.process().destroyed).isTrue();
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void concurrentPollsShareSingleProbeAndTerminalResult() throws Exception {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        CountDownLatch cacheEntered = new CountDownLatch(1);
        CountDownLatch releaseCache = new CountDownLatch(1);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                cacheEntered.countDown();
                if (!releaseCache.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release cache probe");
                }
                return new CliResult(0, VALID_CACHE_OUTPUT);
            });
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "{\"errcode\":0,\"errmsg\":\"ok\",\"userlist\":[]}"));
        AuthorizationSessionContext session = sessionContext(authorization.result());
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch concurrentPollStarted = new CountDownLatch(1);

        try {
            Future<AuthorizationStatusResult> firstPoll = executor.submit(() -> provider.queryStatus(session));
            assertThat(cacheEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<AuthorizationStatusResult> concurrentPoll = executor.submit(() -> {
                concurrentPollStarted.countDown();
                return provider.queryStatus(session);
            });

            assertThat(concurrentPollStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(concurrentPoll.isDone()).isFalse();
            releaseCache.countDown();
            AuthorizationStatusResult firstResult = firstPoll.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult concurrentResult = concurrentPoll.get(5, TimeUnit.SECONDS);

            assertThat(firstResult.status()).isEqualTo(AuthorizationStatus.CONNECTED);
            assertThat(concurrentResult).isEqualTo(firstResult);
            verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
            verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        } finally {
            releaseCache.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void concurrentPollsShareSingleProbeFailureAndTerminalResult() throws Exception {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        CountDownLatch probeEntered = new CountDownLatch(1);
        CountDownLatch releaseProbe = new CountDownLatch(1);
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                probeEntered.countDown();
                if (!releaseProbe.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release business probe");
                }
                return new CliResult(0, "{\"errcode\":40013,\"errmsg\":\"secret-value\",\"userlist\":[]}");
            });
        AuthorizationSessionContext session = sessionContext(authorization.result());
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch concurrentPollStarted = new CountDownLatch(1);

        try {
            Future<AuthorizationStatusResult> firstPoll = executor.submit(() -> provider.queryStatus(session));
            assertThat(probeEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<AuthorizationStatusResult> concurrentPoll = executor.submit(() -> {
                concurrentPollStarted.countDown();
                return provider.queryStatus(session);
            });

            assertThat(concurrentPollStarted.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(concurrentPoll.isDone()).isFalse();
            releaseProbe.countDown();
            AuthorizationStatusResult firstResult = firstPoll.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult concurrentResult = concurrentPoll.get(5, TimeUnit.SECONDS);

            assertFailedStatus(firstResult, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
            assertThat(concurrentResult).isEqualTo(firstResult);
            verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
            verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        } finally {
            releaseProbe.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void cancelReturnsWhileSameAuthorizationProbeIsBlocked() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        CountDownLatch cacheEntered = new CountDownLatch(1);
        CountDownLatch releaseCache = new CountDownLatch(1);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                cacheEntered.countDown();
                if (!releaseCache.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release cache probe");
                }
                return new CliResult(0, VALID_CACHE_OUTPUT);
            });
        AuthorizationSessionContext session = recoverySession("auth-cancel-during-probe");
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<AuthorizationStatusResult> poll = executor.submit(() -> provider.queryStatus(session));
            assertThat(cacheEntered.await(5, TimeUnit.SECONDS)).isTrue();
            CountDownLatch cancelReturned = new CountDownLatch(1);
            executor.submit(() -> {
                provider.cancel(session);
                cancelReturned.countDown();
            });

            assertThat(cancelReturned.await(1, TimeUnit.SECONDS)).isTrue();
            AuthorizationStatusResult cancelled = provider.queryStatus(session);
            assertFailedStatus(cancelled, "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
            releaseCache.countDown();
            assertThat(poll.get(5, TimeUnit.SECONDS)).isEqualTo(cancelled);
        } finally {
            releaseCache.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void cancellationWinsAndLateSuccessfulProbeCannotOverwriteTerminalResult() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        CountDownLatch cacheEntered = new CountDownLatch(1);
        CountDownLatch releaseCache = new CountDownLatch(1);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                cacheEntered.countDown();
                if (!releaseCache.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release cache probe");
                }
                return new CliResult(0, VALID_CACHE_OUTPUT);
            });
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = recoverySession("auth-cancel-wins");
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            Future<AuthorizationStatusResult> poll = executor.submit(() -> provider.queryStatus(session));
            assertThat(cacheEntered.await(5, TimeUnit.SECONDS)).isTrue();

            provider.cancel(session);
            releaseCache.countDown();

            AuthorizationStatusResult completedPoll = poll.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult laterPoll = provider.queryStatus(session);
            assertFailedStatus(completedPoll,
                "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
            assertThat(laterPoll).isEqualTo(completedPoll);
        } finally {
            releaseCache.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void collidingAuthorizationCanValidateWhileAnotherAuthorizationProbeIsBlocked() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        CountDownLatch cacheEntered = new CountDownLatch(1);
        CountDownLatch releaseCache = new CountDownLatch(1);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                cacheEntered.countDown();
                if (!releaseCache.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release cache probe");
                }
                return new CliResult(0, VALID_CACHE_OUTPUT);
            });
        String blockedAuthorizationId = "auth-blocked-stripe";
        String collidingAuthorizationId = collidingAuthorizationId(blockedAuthorizationId);
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<AuthorizationStatusResult> blockedPoll = executor.submit(() ->
                provider.queryStatus(recoverySession(blockedAuthorizationId)));
            assertThat(cacheEntered.await(5, TimeUnit.SECONDS)).isTrue();
            CountDownLatch collidingPollReturned = new CountDownLatch(1);
            AtomicReference<AuthorizationStatusResult> collidingResult = new AtomicReference<>();
            executor.submit(() -> {
                collidingResult.set(provider.queryStatus(sessionContext(
                    collidingAuthorizationId, "42", "{not-json", futureExpiry())));
                collidingPollReturned.countDown();
            });

            assertThat(collidingPollReturned.await(1, TimeUnit.SECONDS)).isTrue();
            AuthorizationStatusResult result = collidingResult.get();
            assertFailedStatus(result, "PROVIDER_CONFIG_INVALID",
                "Invalid WeCom authorization configuration");
            releaseCache.countDown();
            blockedPoll.get(5, TimeUnit.SECONDS);
        } finally {
            releaseCache.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void concurrentWaitersCompleteWithSameFailureWhenProbeThrows() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        CountDownLatch cacheEntered = new CountDownLatch(1);
        CountDownLatch releaseCache = new CountDownLatch(1);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                cacheEntered.countDown();
                if (!releaseCache.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("secret-value");
                }
                throw new IllegalStateException("secret-value");
            });
        AuthorizationSessionContext session = recoverySession("auth-shared-exception");
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<AuthorizationStatusResult> first = executor.submit(() -> provider.queryStatus(session));
            assertThat(cacheEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<AuthorizationStatusResult> waiter = executor.submit(() -> provider.queryStatus(session));
            releaseCache.countDown();

            AuthorizationStatusResult firstResult = first.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult waiterResult = waiter.get(5, TimeUnit.SECONDS);
            assertFailedStatus(firstResult,
                "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
            assertThat(waiterResult).isEqualTo(firstResult);
            verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        } finally {
            releaseCache.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void queryStatusRecoversConnectedWhenProcessHandleIsMissingButProbesPass() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStatusResult result = provider.queryStatus(recoverySession("auth-recovered"));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.errorCode()).isNull();
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void queryStatusReturnsStableCacheFailureWithoutRerunningRecoveryProbes() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "{\"unexpected\":true}"));
        AuthorizationSessionContext session = recoverySession("auth-invalid-cache");

        AuthorizationStatusResult first = provider.queryStatus(session);
        AuthorizationStatusResult second = provider.queryStatus(session);

        assertFailedStatus(first, "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
        assertThat(second).isEqualTo(first);
        verify(workspaceService).resolve(42L, "wecom-cli");
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner, never()).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void terminalResultExpiresNoLaterThanSessionExpiry() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "{\"unexpected\":true}"))
            .thenReturn(new CliResult(0, VALID_CACHE_OUTPUT));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = sessionContext(
            "auth-short-session",
            "42",
            VALID_PROVIDER_STATE,
            new Date(clock.millis() + 50L)
        );

        AuthorizationStatusResult first = provider.queryStatus(session);
        clock.advance(Duration.ofMillis(51));
        AuthorizationStatusResult afterExpiry = provider.queryStatus(session);

        assertFailedStatus(first, "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
        assertThat(afterExpiry.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        verify(cliRunner, times(2)).run(
            CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void terminalResultExpiresAfterMaximumFifteenMinuteTtl() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "{\"unexpected\":true}"))
            .thenReturn(new CliResult(0, VALID_CACHE_OUTPUT));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = sessionContext(
            "auth-max-terminal-ttl",
            "42",
            VALID_PROVIDER_STATE,
            new Date(clock.millis() + Duration.ofMinutes(30).toMillis())
        );

        AuthorizationStatusResult first = provider.queryStatus(session);
        clock.advance(Duration.ofMinutes(15).plusMillis(1));
        AuthorizationStatusResult afterTtl = provider.queryStatus(session);

        assertFailedStatus(first, "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
        assertThat(afterTtl.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        verify(cliRunner, times(2)).run(
            CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void terminalTtlSaturatesInsteadOfOverflowingNearMaximumEpochMillis() {
        clock.setMillis(Long.MAX_VALUE - 100L);
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenThrow(new IllegalStateException("private workspace failure"));
        AuthorizationSessionContext session = sessionContext(
            "auth-terminal-overflow", "42", VALID_PROVIDER_STATE, new Date(Long.MAX_VALUE));

        AuthorizationStatusResult first = provider.queryStatus(session);
        AuthorizationStatusResult second = provider.queryStatus(session);

        assertFailedStatus(first, "PROVIDER_WORKSPACE_ERROR",
            "Unable to prepare the WeCom credential workspace");
        assertThat(second).isEqualTo(first);
        verify(workspaceService).resolve(42L, "wecom-cli");
    }

    @Test
    void terminalCacheEvictsOldestResultWhenCapacityIsExceeded() {
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenThrow(new IllegalStateException("private workspace failure"));

        for (int index = 0; index < 256; index++) {
            AuthorizationStatusResult result = provider.queryStatus(
                recoverySession("auth-capacity-" + index));
            assertFailedStatus(result, "PROVIDER_WORKSPACE_ERROR",
                "Unable to prepare the WeCom credential workspace");
        }
        assertFailedStatus(
            provider.queryStatus(recoverySession("auth-capacity-rejected")),
            "PROVIDER_CAPACITY_EXCEEDED",
            "WeCom authorization capacity is unavailable"
        );
        clock.advance(Duration.ofSeconds(6));
        cleanupTask.run();
        provider.queryStatus(recoverySession("auth-capacity-0"));

        verify(workspaceService, times(257)).resolve(42L, "wecom-cli");
    }

    @Test
    void concurrentStartsRespectActiveLifecycleCapacityWithoutEvictingAcceptedProcesses() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        ConcurrentLinkedQueue<FakeManagedProcess> processes = new ConcurrentLinkedQueue<>();
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenAnswer(invocation -> {
            FakeManagedProcess process = FakeManagedProcess.alive(
                "https://auth.example.com/capacity\n");
            processes.add(process);
            return process;
        });
        ExecutorService executor = Executors.newFixedThreadPool(32);
        List<Future<AuthorizationStartResult>> starts = new ArrayList<>();

        try {
            for (int index = 0; index < 300; index++) {
                String authorizationId = "auth-start-capacity-" + index;
                starts.add(executor.submit(() -> provider.start(startContext(
                    authorizationId, "42", Map.of()))));
            }
            List<AuthorizationStartResult> results = new ArrayList<>();
            for (Future<AuthorizationStartResult> start : starts) {
                results.add(start.get(10, TimeUnit.SECONDS));
            }

            assertThat(results).filteredOn(result -> result.status() == AuthorizationStatus.PENDING)
                .hasSize(256);
            assertThat(results).filteredOn(result ->
                "PROVIDER_CAPACITY_EXCEEDED".equals(result.errorCode()))
                .hasSize(44)
                .allSatisfy(result -> assertThat(result.errorMessage())
                    .isEqualTo("WeCom authorization capacity is unavailable"));
            assertThat(processes).hasSize(256)
                .allSatisfy(process -> assertThat(process.destroyed).isFalse());
            verify(cliRunner, times(256)).start(INIT_COMMAND, ENVIRONMENT, null);
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void capacityRejectedStartNeverCreatesAProcess() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        ConcurrentLinkedQueue<FakeManagedProcess> processes = new ConcurrentLinkedQueue<>();
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenAnswer(invocation -> {
            FakeManagedProcess process = FakeManagedProcess.alive(
                "https://auth.example.com/capacity-reserved\n");
            processes.add(process);
            return process;
        });
        for (int index = 0; index < 256; index++) {
            assertThat(provider.start(startContext(
                "auth-start-reserved-" + index, "42", Map.of())).status())
                .isEqualTo(AuthorizationStatus.PENDING);
        }

        AuthorizationStartResult rejected = provider.start(startContext(
            "auth-start-reserved-rejected", "42", Map.of()));

        assertFailedStart(rejected,
            "PROVIDER_CAPACITY_EXCEEDED", "WeCom authorization capacity is unavailable");
        assertThat(processes).hasSize(256)
            .allSatisfy(process -> assertThat(process.destroyed).isFalse());
        verify(cliRunner, times(256)).start(INIT_COMMAND, ENVIRONMENT, null);
    }

    @Test
    void concurrentRecoveryProbesRespectActiveLifecycleCapacity() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenThrow(new IllegalStateException("private workspace failure"));
        ExecutorService executor = Executors.newFixedThreadPool(32);
        List<Future<AuthorizationStatusResult>> polls = new ArrayList<>();

        try {
            for (int index = 0; index < 300; index++) {
                String authorizationId = "auth-recovery-capacity-" + index;
                polls.add(executor.submit(() -> provider.queryStatus(
                    recoverySession(authorizationId))));
            }
            List<AuthorizationStatusResult> results = new ArrayList<>();
            for (Future<AuthorizationStatusResult> poll : polls) {
                results.add(poll.get(10, TimeUnit.SECONDS));
            }

            assertThat(results).filteredOn(result ->
                "PROVIDER_WORKSPACE_ERROR".equals(result.errorCode())).hasSize(256);
            assertThat(results).filteredOn(result ->
                "PROVIDER_CAPACITY_EXCEEDED".equals(result.errorCode()))
                .hasSize(44)
                .allSatisfy(result -> assertThat(result.errorMessage())
                    .isEqualTo("WeCom authorization capacity is unavailable"));
        } finally {
            executor.shutdownNow();
        }
    }

    @Test
    void admissionPrunesCompletedHandoffOnlyAfterShortProtectionExpires() {
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenThrow(new IllegalStateException("private workspace failure"));
        for (int index = 0; index < 256; index++) {
            AuthorizationStatusResult result = provider.queryStatus(
                recoverySession("auth-protected-capacity-" + index));
            assertThat(result.errorCode()).isEqualTo("PROVIDER_WORKSPACE_ERROR");
        }

        AuthorizationStatusResult protectedCapacity = provider.queryStatus(
            recoverySession("auth-protected-capacity-rejected"));
        clock.advance(Duration.ofSeconds(6));
        AuthorizationStatusResult afterProtection = provider.queryStatus(
            recoverySession("auth-protected-capacity-after-expiry"));

        assertFailedStatus(protectedCapacity,
            "PROVIDER_CAPACITY_EXCEEDED", "WeCom authorization capacity is unavailable");
        assertFailedStatus(afterProtection,
            "PROVIDER_WORKSPACE_ERROR", "Unable to prepare the WeCom credential workspace");
    }

    @Test
    void scheduledCleanupDestroysExpiredInitializationProcess() {
        StartedAuthorization authorization = startAliveAuthorization("auth-cleanup-expired");
        clock.advance(Duration.ofSeconds(121));

        cleanupTask.run();

        assertThat(authorization.process().destroyed).isTrue();
    }

    @Test
    void scheduledCleanupDrainsMoreThanSixtyFourExpiredLifecyclesInOnePass() {
        List<FakeManagedProcess> processes = new ArrayList<>();
        for (int index = 0; index < 80; index++) {
            StartedAuthorization authorization = startAliveAuthorization(
                "auth-cleanup-batch-" + index);
            processes.add(authorization.process());
        }
        clock.advance(Duration.ofSeconds(121));

        cleanupTask.run();

        assertThat(processes).allSatisfy(process -> assertThat(process.destroyed).isTrue());
    }

    @Test
    void scheduledCleanupRetainsNonExpiredInitializationProcess() {
        StartedAuthorization authorization = startAliveAuthorization("auth-cleanup-active");
        clock.advance(Duration.ofSeconds(119));

        cleanupTask.run();

        assertThat(authorization.process().destroyed).isFalse();
        assertThat(provider.queryStatus(sessionContext(
            "auth-cleanup-active",
            "42",
            authorization.result().providerState(),
            authorization.result().expiresAt()
        )).status()).isEqualTo(AuthorizationStatus.PENDING);
    }

    @Test
    void scheduledCleanupCannotRemoveReplacementLifecycleWhileOldDestroyBlocks() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess expiredProcess = FakeManagedProcess.alive(
            "https://auth.example.com/expired\n");
        expiredProcess.blockDestroy();
        FakeManagedProcess replacementProcess = FakeManagedProcess.alive(
            "https://auth.example.com/replacement\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null))
            .thenReturn(expiredProcess, replacementProcess);
        AuthorizationStartResult expired = provider.start(startContext(
            "auth-cleanup-race", "42", Map.of()));
        clock.setMillis(expired.expiresAt().getTime() + 1L);
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            Future<?> cleanup = executor.submit(cleanupTask);
            assertThat(expiredProcess.destroyEntered.await(5, TimeUnit.SECONDS)).isTrue();

            AuthorizationStartResult replacement = provider.start(startContext(
                "auth-cleanup-race", "42", Map.of()));
            assertThat(replacement.status()).isEqualTo(AuthorizationStatus.PENDING);
            expiredProcess.releaseDestroy.countDown();
            cleanup.get(5, TimeUnit.SECONDS);

            assertThat(replacementProcess.destroyed).isFalse();
            assertThat(provider.queryStatus(sessionContext(
                "auth-cleanup-race", "42", replacement.providerState(), replacement.expiresAt()
            )).status()).isEqualTo(AuthorizationStatus.PENDING);
        } finally {
            expiredProcess.releaseDestroy.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void shutdownStopsCleanupSchedulerIdempotently() {
        provider.shutdown();
        provider.shutdown();

        verify(cleanupFuture).cancel(false);
        verify(cleanupExecutor).shutdownNow();
    }

    @Test
    void shutdownWaitsForStartedProcessCreationThenDrainsItBeforeReturning() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        CountDownLatch startEntered = new CountDownLatch(1);
        CountDownLatch releaseStart = new CountDownLatch(1);
        CountDownLatch shutdownEntered = new CountDownLatch(1);
        CountDownLatch shutdownReturned = new CountDownLatch(1);
        FakeManagedProcess process = FakeManagedProcess.alive("");
        process.blockInspection();
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenAnswer(invocation -> {
            startEntered.countDown();
            if (!releaseStart.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out waiting to release start");
            }
            return process;
        });
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<AuthorizationStartResult> start = executor.submit(() -> provider.start(
                startContext("auth-start-shutdown-race", "42", Map.of())));
            assertThat(startEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<?> shutdown = executor.submit(() -> {
                shutdownEntered.countDown();
                provider.shutdown();
                shutdownReturned.countDown();
            });
            assertThat(shutdownEntered.await(5, TimeUnit.SECONDS)).isTrue();

            assertThat(shutdownReturned.await(500, TimeUnit.MILLISECONDS)).isFalse();
            releaseStart.countDown();
            shutdown.get(5, TimeUnit.SECONDS);
            process.releaseInspection.countDown();

            assertFailedStart(start.get(5, TimeUnit.SECONDS),
                "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
            assertThat(process.destroyed).isTrue();
            assertThat(process.destroyCalls).isEqualTo(1);
            assertThat(activeLifecycleCount()).isZero();
        } finally {
            releaseStart.countDown();
            process.releaseInspection.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void shutdownReturningWhileWorkspaceResolutionIsBlockedPreventsProcessCreation() throws Exception {
        CountDownLatch workspaceEntered = new CountDownLatch(1);
        CountDownLatch releaseWorkspace = new CountDownLatch(1);
        when(workspaceService.resolve(42L, "wecom-cli")).thenAnswer(invocation -> {
            workspaceEntered.countDown();
            if (!releaseWorkspace.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out waiting to release workspace");
            }
            return WORKSPACE;
        });
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            Future<AuthorizationStartResult> start = executor.submit(() -> provider.start(
                startContext("auth-workspace-shutdown-race", "42", Map.of())));
            assertThat(workspaceEntered.await(5, TimeUnit.SECONDS)).isTrue();

            provider.shutdown();
            assertThat(activeLifecycleCount()).isZero();
            releaseWorkspace.countDown();

            assertFailedStart(start.get(5, TimeUnit.SECONDS),
                "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
            verify(cliRunner, never()).start(INIT_COMMAND, ENVIRONMENT, null);
            assertThat(activeLifecycleCount()).isZero();
        } finally {
            releaseWorkspace.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void recoveryProbeBlockedDuringShutdownReturnsCancelledWithoutLateBusinessProbe() throws Exception {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        CountDownLatch cacheProbeEntered = new CountDownLatch(1);
        CountDownLatch releaseCacheProbe = new CountDownLatch(1);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenAnswer(invocation -> {
                cacheProbeEntered.countDown();
                if (!releaseCacheProbe.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release cache probe");
                }
                return new CliResult(0, VALID_CACHE_OUTPUT);
            });
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = recoverySession("auth-recovery-shutdown-race");
        ExecutorService executor = Executors.newSingleThreadExecutor();

        try {
            Future<AuthorizationStatusResult> poll = executor.submit(() -> provider.queryStatus(session));
            assertThat(cacheProbeEntered.await(5, TimeUnit.SECONDS)).isTrue();

            provider.shutdown();
            releaseCacheProbe.countDown();

            AuthorizationStatusResult result = poll.get(5, TimeUnit.SECONDS);
            assertFailedStatus(result,
                "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
            assertThat(provider.queryStatus(session)).isEqualTo(result);
            verify(cliRunner, never()).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        } finally {
            releaseCacheProbe.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void shutdownRejectsNewStartAndRecoveryWithoutExternalCalls() {
        provider.shutdown();

        AuthorizationStartResult start = provider.start(startContext(
            "auth-start-after-shutdown", "42", Map.of()));
        AuthorizationStatusResult recovery = provider.queryStatus(
            recoverySession("auth-recovery-after-shutdown"));

        assertFailedStart(start,
            "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
        assertFailedStatus(recovery,
            "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @Test
    void terminalHandoffRemainsStableWhileCompletedProcessDestroyBlocks() throws Exception {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        authorization.process().blockDestroy();
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = sessionContext(authorization.result());
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<AuthorizationStatusResult> firstPoll = executor.submit(() -> provider.queryStatus(session));
            assertThat(authorization.process().destroyEntered.await(5, TimeUnit.SECONDS)).isTrue();

            Future<AuthorizationStatusResult> handoffPoll = executor.submit(() -> provider.queryStatus(session));
            authorization.process().releaseDestroy.countDown();

            AuthorizationStatusResult firstResult = firstPoll.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult handoffResult = handoffPoll.get(5, TimeUnit.SECONDS);
            assertThat(firstResult.status()).isEqualTo(AuthorizationStatus.CONNECTED);
            assertThat(handoffResult).isEqualTo(firstResult);
            verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
            verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        } finally {
            authorization.process().releaseDestroy.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void terminalHandoffSurvivesCapacityEvictionWhileCompletedProcessDestroyBlocks() throws Exception {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        authorization.process().blockDestroy();
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = sessionContext(authorization.result());
        ExecutorService executor = Executors.newFixedThreadPool(2);

        try {
            Future<AuthorizationStatusResult> firstPoll = executor.submit(() -> provider.queryStatus(session));
            assertThat(authorization.process().destroyEntered.await(5, TimeUnit.SECONDS)).isTrue();
            when(workspaceService.resolve(42L, "wecom-cli"))
                .thenThrow(new IllegalStateException("private workspace failure"));
            int index = 0;
            int inserted = 0;
            while (inserted <= 256) {
                String fillerAuthorizationId = "auth-handoff-fill-" + index++;
                if (authorizationStripe(fillerAuthorizationId) == authorizationStripe("auth-wecom-1")) {
                    continue;
                }
                provider.queryStatus(recoverySession(fillerAuthorizationId));
                inserted++;
            }

            Future<AuthorizationStatusResult> handoffPoll = executor.submit(() -> provider.queryStatus(session));
            authorization.process().releaseDestroy.countDown();

            AuthorizationStatusResult firstResult = firstPoll.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult handoffResult = handoffPoll.get(5, TimeUnit.SECONDS);
            assertThat(firstResult.status()).isEqualTo(AuthorizationStatus.CONNECTED);
            assertThat(handoffResult).isEqualTo(firstResult);
            verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
            verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        } finally {
            authorization.process().releaseDestroy.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void terminalHandoffSurvivesCacheEvictionAfterProviderReturnsWithoutReprobing() {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));
        AuthorizationSessionContext session = sessionContext(authorization.result());

        AuthorizationStatusResult firstResult = provider.queryStatus(session);
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenThrow(new IllegalStateException("private workspace failure"));
        for (int index = 0; index <= 256; index++) {
            provider.queryStatus(recoverySession("auth-post-return-fill-" + index));
        }

        AuthorizationStatusResult handoffResult = provider.queryStatus(session);

        assertThat(firstResult.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(handoffResult).isEqualTo(firstResult);
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void cancelledHandoffSurvivesCacheEvictionBeforeFirstPollWithoutProbing() {
        StartedAuthorization authorization = startAliveAuthorization("auth-cancel-handoff");
        AuthorizationSessionContext session = sessionContext(
            "auth-cancel-handoff",
            "42",
            authorization.result().providerState(),
            authorization.result().expiresAt()
        );

        provider.cancel(session);
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenThrow(new IllegalStateException("private workspace failure"));
        for (int index = 0; index <= 256; index++) {
            provider.queryStatus(recoverySession("auth-cancel-handoff-fill-" + index));
        }

        AuthorizationStatusResult result = provider.queryStatus(session);

        assertFailedStatus(result,
            "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
        assertThat(authorization.process().destroyed).isTrue();
        verify(cliRunner, never()).run(org.mockito.ArgumentMatchers.anyList(),
            org.mockito.ArgumentMatchers.anyMap(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(Duration.class));
    }

    @Test
    void cancelDestroysOnlyOwnedProcessAndReturnsStableCancelledFailure() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess cancelledProcess = FakeManagedProcess.alive(
            "https://auth.example.com/cancelled\n");
        FakeManagedProcess otherProcess = FakeManagedProcess.alive(
            "https://auth.example.com/other\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null))
            .thenReturn(cancelledProcess, otherProcess);
        AuthorizationStartResult cancelledStart = provider.start(startContext(
            "auth-cancelled", "42", Map.of()));
        AuthorizationStartResult otherStart = provider.start(startContext(
            "auth-other", "42", Map.of()));
        AuthorizationSessionContext cancelledSession = sessionContext(
            "auth-cancelled", "42", cancelledStart.providerState(), cancelledStart.expiresAt());
        AuthorizationSessionContext otherSession = sessionContext(
            "auth-other", "42", otherStart.providerState(), otherStart.expiresAt());

        provider.cancel(cancelledSession);
        provider.cancel(cancelledSession);
        AuthorizationStatusResult first = provider.queryStatus(cancelledSession);
        AuthorizationStatusResult second = provider.queryStatus(cancelledSession);
        AuthorizationStatusResult other = provider.queryStatus(otherSession);

        assertThat(cancelledProcess.destroyed).isTrue();
        assertThat(otherProcess.destroyed).isFalse();
        assertFailedStatus(first, "PROVIDER_AUTH_CANCELLED", "WeCom authorization was cancelled");
        assertThat(second).isEqualTo(first);
        assertThat(other.status()).isEqualTo(AuthorizationStatus.PENDING);
        verifyNoCliRuns();
    }

    @Test
    void queryStatusRejectsMalformedProviderStateDuringRecovery() {
        AuthorizationStatusResult result = provider.queryStatus(sessionContext(
            "auth-malformed-state", "42", "{not-json", futureExpiry()));

        assertFailedStatus(result, "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration");
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @Test
    void queryStatusRejectsInvalidUserDuringRecovery() {
        AuthorizationStatusResult result = provider.queryStatus(sessionContext(
            "auth-invalid-user", "0", VALID_PROVIDER_STATE, futureExpiry()));

        assertFailedStatus(result, "INVALID_USER", "Invalid user");
        verifyNoInteractions(workspaceService, cliRunner);
    }

    @Test
    void queryStatusSanitizesWorkspaceFailureDuringRecovery() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenThrow(new IllegalStateException(
            "workspace=/tmp/private token=secret-value https://private.example.com"));

        AuthorizationStatusResult result = provider.queryStatus(recoverySession("auth-workspace-failure"));

        assertFailedStatus(result, "PROVIDER_WORKSPACE_ERROR",
            "Unable to prepare the WeCom credential workspace");
        verifyNoCliRuns();
    }

    @Test
    void queryStatusRejectsNonzeroCacheResultDuringRecovery() {
        assertRecoveryCacheFailure("auth-cache-nonzero", new CliResult(7, VALID_CACHE_OUTPUT));
    }

    @Test
    void queryStatusRejectsTruncatedCacheResultDuringRecovery() {
        assertRecoveryCacheFailure("auth-cache-truncated", new CliResult(0, VALID_CACHE_OUTPUT, true));
    }

    @Test
    void queryStatusAcceptsEmptyServiceDiscoveryCacheDuringRecovery() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "[]"));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStatusResult result = provider.queryStatus(recoverySession("auth-cache-empty"));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
    }

    @Test
    void queryStatusRejectsBusinessErrcodeDuringRecovery() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0,
                "{\"errcode\":40013,\"errmsg\":\"secret-value\",\"userlist\":[]}"));

        AuthorizationStatusResult result = provider.queryStatus(recoverySession("auth-probe-errcode"));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @Test
    void queryStatusSanitizesProbeExceptionDuringRecovery() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenThrow(new IllegalStateException(
                "token=secret-value workspace=/tmp/private https://private.example.com"));

        AuthorizationStatusResult result = provider.queryStatus(recoverySession("auth-probe-exception"));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @Test
    void queryStatusKeepsInitializationFailureWhenNonzeroProcessAndProbesFail() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.exited(
            7, "https://auth.example.com/failed-init\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult started = provider.start(startContext(Map.of()));
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "[]"));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, "{\"errcode\":40014,\"errmsg\":\"invalid token\"}"));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(started));

        assertFailedStatus(result, "PROVIDER_AUTH_FAILED", "Unable to complete WeCom authorization");
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void queryStatusTrustsSuccessfulProbesAfterNonzeroInitializationExit() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.exited(
            7,
            "https://auth.example.com/completed-with-warning\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult started = provider.start(startContext(Map.of()));
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_DIRECT_PROBE_OUTPUT));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(started));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
        verify(cliRunner, times(1)).run(
            CACHE_STATUS_COMMAND,
            ENVIRONMENT,
            null,
            Duration.ofSeconds(30)
        );
        verify(cliRunner, times(1)).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidBusinessProbeResults")
    void queryStatusRejectsInvalidBusinessProbeResult(String caseName, CliResult probeResult) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(probeResult);

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidDirectBusinessOutputs")
    void queryStatusRejectsNonExactDirectBusinessPayload(String caseName, String probeOutput) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, probeOutput));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidJsonRpcEnvelopes")
    void queryStatusRejectsInvalidJsonRpcEnvelopeDespiteValidBusinessText(
        String caseName,
        String probeOutput) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, probeOutput));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("malformedJsonRpcProbeEnvelopes")
    void queryStatusRejectsMalformedJsonRpcProbeEnvelope(String caseName, String probeOutput) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, probeOutput));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("duplicateKeyProbeOutputs")
    void queryStatusRejectsDuplicateKeysInProbePayload(String caseName, String probeOutput) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, probeOutput));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("malformedEnvelopeCandidates")
    void queryStatusRejectsMalformedEnvelopeCandidateInsteadOfTreatingItAsDirectBusinessJson(
        String caseName,
        String probeOutput) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());
        stubValidCacheStatus();
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, probeOutput));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(authorization.result()));

        assertFailedStatus(result, "PROVIDER_PROBE_FAILED", "WeCom authorization probe failed");
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidUserIds")
    void queryStatusRejectsInvalidUserBeforeResolvingWorkspaceOrRunningProbes(String caseName, String userId) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(
            authorization.result(),
            userId,
            authorization.result().providerState()
        ));

        assertFailedStatus(result, "INVALID_USER", "Invalid user");
        verify(workspaceService).resolve(42L, "wecom-cli");
        verifyNoCliRuns();
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("invalidProviderStates")
    void queryStatusRejectsMalformedOrUnvalidatedProviderStateBeforeWorkspaceAndProbes(
        String caseName,
        String providerState) {
        StartedAuthorization authorization = startCompletedAuthorization(Map.of());

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(
            authorization.result(),
            "42",
            providerState
        ));

        assertFailedStatus(
            result,
            "PROVIDER_CONFIG_INVALID",
            "Invalid WeCom authorization configuration"
        );
        assertThat(authorization.process().destroyed).isTrue();
        verify(workspaceService).resolve(42L, "wecom-cli");
        verifyNoCliRuns();
    }

    @Test
    void queryStatusSanitizesWorkspaceResolutionException() {
        when(workspaceService.resolve(42L, "wecom-cli"))
            .thenReturn(WORKSPACE)
            .thenThrow(new IllegalStateException(
                "workspace=/tmp/private token=secret-value command=printenv url=https://private.example.com"
            ));
        FakeManagedProcess process = FakeManagedProcess.exited(
            0,
            "https://auth.example.com/authorize\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult started = provider.start(startContext(Map.of()));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(started));

        assertFailedStatus(
            result,
            "PROVIDER_WORKSPACE_ERROR",
            "Unable to prepare the WeCom credential workspace"
        );
        assertThat(process.destroyed).isTrue();
        verifyNoCliRuns();
    }

    @Test
    void queryStatusSanitizesCacheAndBusinessProbeRunnerExceptions() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess cacheFailureProcess = FakeManagedProcess.exited(
            0,
            "https://auth.example.com/cache-failure\n"
        );
        FakeManagedProcess probeFailureProcess = FakeManagedProcess.exited(
            0,
            "https://auth.example.com/probe-failure\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null))
            .thenReturn(cacheFailureProcess, probeFailureProcess);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenThrow(new IllegalStateException(
                "cache token=secret-value workspace=/tmp/private https://private.example.com"
            ))
            .thenReturn(new CliResult(0, "[{\"account\":\"wecom-user\"}]"));
        when(cliRunner.run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenThrow(new IllegalStateException(
                "probe token=secret-value workspace=/tmp/private https://private.example.com"
            ));

        AuthorizationStartResult cacheFailureStart = provider.start(startContext(Map.of()));
        AuthorizationStatusResult cacheFailure = provider.queryStatus(sessionContext(cacheFailureStart));
        AuthorizationStartResult probeFailureStart = provider.start(startContext(Map.of()));
        AuthorizationStatusResult probeFailure = provider.queryStatus(sessionContext(probeFailureStart));

        assertFailedStatus(
            cacheFailure,
            "PROVIDER_CACHE_INVALID",
            "WeCom credential cache is unavailable"
        );
        assertFailedStatus(
            probeFailure,
            "PROVIDER_PROBE_FAILED",
            "WeCom authorization probe failed"
        );
        assertThat(cacheFailureProcess.destroyed).isTrue();
        assertThat(probeFailureProcess.destroyed).isTrue();
    }

    @Test
    void queryStatusSanitizesFailedInitializationProcessAndRemovesIt() {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive("https://auth.example.com/authorize\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        AuthorizationStartResult started = provider.start(startContext(Map.of()));
        process.alive = false;
        process.exitCode = 7;
        process.outputSnapshots = List.of(
            "token=secret-value workspace=/tmp/private https://private.example.com"
        );
        process.outputCompleteAtSnapshot = 0;

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(started));

        assertFailedStatus(result, "PROVIDER_AUTH_FAILED", "Unable to complete WeCom authorization");
        assertThat(process.destroyed).isTrue();
        verify(cliRunner).run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
        verify(cliRunner, never()).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    @Test
    void cancelIsNoOp() {
        assertThatCode(() -> provider.cancel(sessionContext())).doesNotThrowAnyException();
    }

    private AuthorizationStartContext startContext(Map<String, Object> providerConfig) {
        return startContext("42", providerConfig);
    }

    private AuthorizationStartContext startContext(String userId, Map<String, Object> providerConfig) {
        return startContext("auth-wecom-1", userId, providerConfig);
    }

    private AuthorizationStartContext startContext(
        String authorizationId,
        String userId,
        Map<String, Object> providerConfig) {
        return new AuthorizationStartContext(
            authorizationId,
            userId,
            1002L,
            "wecom",
            "wecom-cli",
            null,
            providerConfig
        );
    }

    private static Stream<Arguments> invalidUserIds() {
        return Stream.of(
            Arguments.of("null", null),
            Arguments.of("blank", " "),
            Arguments.of("zero", "0"),
            Arguments.of("negative", "-1"),
            Arguments.of("non-numeric", "user-42"),
            Arguments.of("decimal", "42.5"),
            Arguments.of("overflow", "9223372036854775808")
        );
    }

    private static Stream<Arguments> invalidProbeCommands() {
        return Stream.of(
            Arguments.of("explicit null", null),
            Arguments.of("empty array", List.of()),
            Arguments.of("wrong value type", "wecom-cli contact get_userlist {}"),
            Arguments.of("non-string element", List.of("wecom-cli", "contact", 7, "{}")),
            Arguments.of("null element", java.util.Arrays.asList("wecom-cli", "contact", null, "{}")),
            Arguments.of("too few elements", List.of("wecom-cli", "contact", "get_userlist")),
            Arguments.of("too many elements", List.of("wecom-cli", "contact", "get_userlist", "{}", "extra")),
            Arguments.of("other executable", List.of("other-cli", "contact", "get_userlist", "{}")),
            Arguments.of("other tool", List.of("wecom-cli", "message", "get_userlist", "{}")),
            Arguments.of("other operation", List.of("wecom-cli", "contact", "get_department", "{}")),
            Arguments.of("control character", List.of("wecom-cli", "contact", "get_userlist", "{}\n")),
            Arguments.of("malformed JSON", List.of("wecom-cli", "contact", "get_userlist", "not-json")),
            Arguments.of("trailing JSON", List.of("wecom-cli", "contact", "get_userlist", "{} []")),
            Arguments.of("JSON array", List.of("wecom-cli", "contact", "get_userlist", "[]")),
            Arguments.of("JSON string", List.of("wecom-cli", "contact", "get_userlist", "\"value\"")),
            Arguments.of("JSON number", List.of("wecom-cli", "contact", "get_userlist", "1")),
            Arguments.of("JSON null", List.of("wecom-cli", "contact", "get_userlist", "null"))
        );
    }

    private static Stream<Arguments> invalidCacheResults() {
        return Stream.of(
            Arguments.of("null result", null),
            Arguments.of("non-zero exit", new CliResult(7, "[{\"account\":\"secret-value\"}]")),
            Arguments.of("truncated output", new CliResult(0, "[{\"account\":\"secret-value\"}]", true)),
            Arguments.of("null output", new CliResult(0, null)),
            Arguments.of("blank output", new CliResult(0, " \n")),
            Arguments.of("malformed JSON", new CliResult(0, "[secret-value")),
            Arguments.of("JSON object", new CliResult(0, "{\"account\":\"secret-value\"}")),
            Arguments.of("trailing JSON", new CliResult(0, "[{\"account\":1}] []"))
        );
    }

    private static Stream<Arguments> successfulBusinessProbeOutputs() {
        return Stream.of(
            Arguments.of("realistic direct CLI response", VALID_DIRECT_PROBE_OUTPUT),
            Arguments.of("realistic JSON-RPC CLI response", VALID_JSON_RPC_PROBE_OUTPUT),
            Arguments.of("realistic JSON-RPC CLI response with string ID", """
                {"jsonrpc":"2.0","id":"wecom-cli-contact-request-001","result":{"content":[
                  {"type":"text","text":"{\\"errcode\\":0,\\"errmsg\\":\\"ok\\",\\"userlist\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("JSON-RPC skips malformed text before valid business text", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"diagnostic output"},
                  {"type":"text","text":"{\\"errcode\\":0,\\"errmsg\\":\\"ok\\",\\"userlist\\":[]} "}
                ],"isError":false}}
                """)
        );
    }

    private static Stream<Arguments> invalidDirectBusinessOutputs() {
        return Stream.of(
            Arguments.of("array", "[]"),
            Arguments.of("empty object", "{}"),
            Arguments.of("errmsg only", "{\"errmsg\":\"ok\"}"),
            Arguments.of("unrelated result object", "{\"result\":{\"value\":1}}"),
            Arguments.of("decimal zero errcode", "{\"errcode\":0.0,\"userlist\":[]}"),
            Arguments.of("missing userlist", "{\"errcode\":0,\"errmsg\":\"ok\"}"),
            Arguments.of("non-array userlist", "{\"errcode\":0,\"userlist\":{}}"),
            Arguments.of("error object", "{\"error\":{\"code\":-1},\"userlist\":[]}" )
        );
    }

    private static Stream<Arguments> invalidBusinessProbeResults() {
        return Stream.of(
            Arguments.of("null result", null),
            Arguments.of("non-zero exit", new CliResult(7, "{\"secret\":\"secret-value\"}")),
            Arguments.of("truncated output", new CliResult(0, "{\"secret\":\"secret-value\"}", true)),
            Arguments.of("null output", new CliResult(0, null)),
            Arguments.of("blank output", new CliResult(0, " \n")),
            Arguments.of("malformed JSON", new CliResult(0, "{secret-value")),
            Arguments.of("JSON string", new CliResult(0, "\"secret-value\"")),
            Arguments.of("JSON number", new CliResult(0, "1")),
            Arguments.of("JSON null", new CliResult(0, "null")),
            Arguments.of("trailing JSON", new CliResult(0, "{\"userlist\":[]} []")),
            Arguments.of("non-zero errcode", new CliResult(0, "{\"errcode\":40013}")),
            Arguments.of("text errcode", new CliResult(0, "{\"errcode\":\"0\"}")),
            Arguments.of("direct error envelope", new CliResult(0,
                "{\"error\":{\"code\":-32000,\"message\":\"secret-value\"}}")),
            Arguments.of("JSON-RPC error envelope", new CliResult(0,
                "{\"jsonrpc\":\"2.0\",\"error\":{\"code\":-32000,\"message\":\"secret-value\"}}")),
            Arguments.of("JSON-RPC missing content", new CliResult(0,
                "{\"jsonrpc\":\"2.0\",\"result\":{}}")),
            Arguments.of("JSON-RPC empty content", new CliResult(0,
                "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[]}}")),
            Arguments.of("JSON-RPC blank text", new CliResult(0,
                "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[{\"text\":\" \"}]}}")),
            Arguments.of("JSON-RPC malformed text", new CliResult(0,
                "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[{\"text\":\"secret-value\"}]}}")),
            Arguments.of("JSON-RPC non-zero errcode", new CliResult(0,
                "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":[{\"text\":\"{\\\"errcode\\\":1}\"}]}}"))
        );
    }

    private static Stream<Arguments> invalidJsonRpcEnvelopes() {
        return Stream.of(
            Arguments.of("missing jsonrpc", """
                {"result":{"content":[{"text":"{\\\"errcode\\\":0}"}]}}
                """),
            Arguments.of("null jsonrpc", """
                {"jsonrpc":null,"result":{"content":[{"text":"{\\\"errcode\\\":0}"}]}}
                """),
            Arguments.of("non-string jsonrpc", """
                {"jsonrpc":2.0,"result":{"content":[{"text":"{\\\"errcode\\\":0}"}]}}
                """),
            Arguments.of("wrong jsonrpc version", """
                {"jsonrpc":"1.0","result":{"content":[{"text":"{\\\"errcode\\\":0}"}]}}
                """),
            Arguments.of("jsonrpc version with whitespace", """
                {"jsonrpc":"2.0 ","result":{"content":[{"text":"{\\\"errcode\\\":0}"}]}}
                """),
            Arguments.of("array result", "{\"jsonrpc\":\"2.0\",\"result\":[]}"),
            Arguments.of("null result", "{\"jsonrpc\":\"2.0\",\"result\":null}"),
            Arguments.of("object content", """
                {"jsonrpc":"2.0","result":{"content":{"text":"{\\\"errcode\\\":0}"}}}
                """),
            Arguments.of("null content", "{\"jsonrpc\":\"2.0\",\"result\":{\"content\":null}}")
        );
    }

    private static Stream<Arguments> malformedJsonRpcProbeEnvelopes() {
        return Stream.of(
            Arguments.of("missing id", """
                {"jsonrpc":"2.0","result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("null id", """
                {"jsonrpc":"2.0","id":null,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("decimal id", """
                {"jsonrpc":"2.0","id":1.0,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("non-positive id", """
                {"jsonrpc":"2.0","id":0,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("result isError true", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":true}}
                """),
            Arguments.of("result isError wrong type", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":"false"}}
                """),
            Arguments.of("content item missing type", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("content item type mismatch", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"image","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("result error field", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false,"error":{"code":-1}}}
                """),
            Arguments.of("mixed invalid and valid content", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"image","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]}"},
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]}"}
                ],"isError":false}}
                """)
        );
    }

    private static Stream<Arguments> duplicateKeyProbeOutputs() {
        return Stream.of(
            Arguments.of("direct duplicate errcode", """
                {"errcode":1,"errcode":0,"errmsg":"ok","userlist":[]}
                """),
            Arguments.of("direct duplicate userlist", """
                {"errcode":0,"userlist":{},"userlist":[]}
                """),
            Arguments.of("duplicate jsonrpc", """
                {"jsonrpc":"1.0","jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("duplicate id", """
                {"jsonrpc":"2.0","id":2,"id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("duplicate isError", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":true,"isError":false}}
                """),
            Arguments.of("nested duplicate errcode", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":1,\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("nested duplicate userlist", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":{},\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("nested duplicate before valid business text", """
                {"jsonrpc":"2.0","id":1,"result":{"content":[
                  {"type":"text","text":"{\\\"errcode\\\":1,\\\"errcode\\\":0,\\\"userlist\\\":[]}"},
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """),
            Arguments.of("duplicate content", """
                {"jsonrpc":"2.0","id":1,"result":{"content":null,"content":[
                  {"type":"text","text":"{\\\"errcode\\\":0,\\\"userlist\\\":[]} "}
                ],"isError":false}}
                """)
        );
    }

    private static Stream<Arguments> malformedEnvelopeCandidates() {
        return Stream.of(
            Arguments.of("missing jsonrpc with null content", "{\"result\":{\"content\":null}}"),
            Arguments.of("missing jsonrpc with object content", """
                {"result":{"content":{"text":"{\\\"errcode\\\":0}"}}}
                """),
            Arguments.of("missing jsonrpc with string content", """
                {"result":{"content":"{\\\"errcode\\\":0}"}}
                """),
            Arguments.of("missing jsonrpc with numeric content", "{\"result\":{\"content\":1}}"),
            Arguments.of("missing jsonrpc with empty content", "{\"result\":{\"content\":[]}}"),
            Arguments.of("missing jsonrpc without valid business text", """
                {"result":{"content":[{"text":"not-json"},{"text":"\\\"diagnostic\\\""}]}}
                """),
            Arguments.of("null jsonrpc with object content", """
                {"jsonrpc":null,"result":{"content":{"text":"{\\\"errcode\\\":0}"}}}
                """),
            Arguments.of("non-string jsonrpc with null content", """
                {"jsonrpc":2.0,"result":{"content":null}}
                """),
            Arguments.of("wrong jsonrpc with no valid business text", """
                {"jsonrpc":"1.0","result":{"content":[{"text":"not-json"}]}}
                """)
        );
    }

    private static Stream<Arguments> invalidProviderStates() {
        return Stream.of(
            Arguments.of("null", null),
            Arguments.of("blank", " "),
            Arguments.of("malformed JSON", "not-json"),
            Arguments.of("trailing JSON", "{\"authorizationTimeoutSeconds\":120,\"probeCommand\":[]} []"),
            Arguments.of("empty object", "{}"),
            Arguments.of("unknown field", """
                {"authorizationTimeoutSeconds":120,
                 "probeCommand":["wecom-cli","contact","get_userlist","{}"],"extra":true}
                """),
            Arguments.of("timeout below range", """
                {"authorizationTimeoutSeconds":89,
                 "probeCommand":["wecom-cli","contact","get_userlist","{}"]}
                """),
            Arguments.of("timeout above range", """
                {"authorizationTimeoutSeconds":901,
                 "probeCommand":["wecom-cli","contact","get_userlist","{}"]}
                """),
            Arguments.of("fractional timeout", """
                {"authorizationTimeoutSeconds":120.5,
                 "probeCommand":["wecom-cli","contact","get_userlist","{}"]}
                """),
            Arguments.of("missing probe command", "{\"authorizationTimeoutSeconds\":120}"),
            Arguments.of("arbitrary probe command", """
                {"authorizationTimeoutSeconds":120,
                 "probeCommand":["sh","-c","printenv","{}"]}
                """),
            Arguments.of("null probe element", """
                {"authorizationTimeoutSeconds":120,
                 "probeCommand":["wecom-cli","contact",null,"{}"]}
                """),
            Arguments.of("malformed probe arguments", """
                {"authorizationTimeoutSeconds":120,
                 "probeCommand":["wecom-cli","contact","get_userlist","not-json"]}
                """)
        );
    }

    private static Map<String, Object> providerConfigWithProbeCommand(Object probeCommand) {
        Map<String, Object> config = new HashMap<>();
        config.put("probeCommand", probeCommand);
        return config;
    }

    private static void assertFailedStart(AuthorizationStartResult result, String errorCode, String errorMessage) {
        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.authorizationUrl()).isNull();
        assertThat(result.expiresAt()).isNotNull();
        assertThat(result.providerSessionId()).isNull();
        assertThat(result.providerState()).isNull();
        assertThat(result.errorCode()).isEqualTo(errorCode);
        assertThat(result.errorMessage()).isEqualTo(errorMessage);
        assertThat(result.errorMessage())
            .doesNotContain("secret-value", "/tmp/", "printenv", "https://");
    }

    private static void assertFailedStatus(
        AuthorizationStatusResult result,
        String errorCode,
        String errorMessage) {
        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isEqualTo(errorCode);
        assertThat(result.errorMessage()).isEqualTo(errorMessage);
        assertThat(result.errorMessage())
            .doesNotContain("secret-value", "/tmp/", "printenv", "https://");
    }

    private StartedAuthorization startCompletedAuthorization(Map<String, Object> providerConfig) {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.exited(
            0,
            "https://auth.example.com/authorize\n"
        );
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        return new StartedAuthorization(provider.start(startContext(providerConfig)), process);
    }

    private StartedAuthorization startAliveAuthorization(String authorizationId) {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        FakeManagedProcess process = FakeManagedProcess.alive(
            "https://auth.example.com/authorize\n");
        when(cliRunner.start(INIT_COMMAND, ENVIRONMENT, null)).thenReturn(process);
        return new StartedAuthorization(
            provider.start(startContext(authorizationId, "42", Map.of())),
            process
        );
    }

    private void stubValidCacheStatus() {
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(new CliResult(0, VALID_CACHE_OUTPUT));
    }

    private void assertRecoveryCacheFailure(String authorizationId, CliResult cacheResult) {
        when(workspaceService.resolve(42L, "wecom-cli")).thenReturn(WORKSPACE);
        when(cliRunner.run(CACHE_STATUS_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30)))
            .thenReturn(cacheResult);

        AuthorizationStatusResult result = provider.queryStatus(recoverySession(authorizationId));

        assertFailedStatus(result, "PROVIDER_CACHE_INVALID", "WeCom credential cache is unavailable");
        verify(cliRunner, never()).run(PROBE_COMMAND, ENVIRONMENT, null, Duration.ofSeconds(30));
    }

    private void verifyNoCliRuns() {
        verify(cliRunner, never()).run(org.mockito.ArgumentMatchers.anyList(),
            org.mockito.ArgumentMatchers.anyMap(), org.mockito.ArgumentMatchers.any(),
            org.mockito.ArgumentMatchers.any(Duration.class));
    }

    private AuthorizationSessionContext sessionContext() {
        return new AuthorizationSessionContext(
            "auth-wecom-1",
            "42",
            1002L,
            "wecom",
            "wecom-cli",
            null,
            null,
            new Date()
        );
    }

    private AuthorizationSessionContext recoverySession(String authorizationId) {
        return sessionContext(authorizationId, "42", VALID_PROVIDER_STATE, futureExpiry());
    }

    private AuthorizationSessionContext sessionContext(
        String authorizationId,
        String userId,
        String providerState,
        Date expiresAt) {
        return new AuthorizationSessionContext(
            authorizationId,
            userId,
            1002L,
            "wecom",
            "wecom-cli",
            null,
            providerState,
            expiresAt
        );
    }

    private Date futureExpiry() {
        return new Date(clock.millis() + TimeUnit.MINUTES.toMillis(10));
    }

    private int authorizationStripe(String authorizationId) {
        int hash = authorizationId.hashCode();
        return (hash ^ (hash >>> 16)) & 63;
    }

    private int activeLifecycleCount() {
        Object lifecycles = org.springframework.test.util.ReflectionTestUtils.getField(
            provider, "authorizationLifecycles");
        assertThat(lifecycles).isInstanceOf(Map.class);
        return ((Map<?, ?>) lifecycles).size();
    }

    private String collidingAuthorizationId(String authorizationId) {
        int stripe = authorizationStripe(authorizationId);
        for (int index = 0; index < 100_000; index++) {
            String candidate = authorizationId + "-collision-" + index;
            if (!candidate.equals(authorizationId) && authorizationStripe(candidate) == stripe) {
                return candidate;
            }
        }
        throw new IllegalStateException("Unable to find authorization stripe collision");
    }

    private AuthorizationSessionContext sessionContext(AuthorizationStartResult started) {
        return sessionContext(started, "42", started.providerState());
    }

    private AuthorizationSessionContext sessionContext(
        AuthorizationStartResult started,
        String userId,
        String providerState) {
        return new AuthorizationSessionContext(
            "auth-wecom-1",
            userId,
            1002L,
            "wecom",
            "wecom-cli",
            started.providerSessionId(),
            providerState,
            started.expiresAt()
        );
    }

    private record StartedAuthorization(AuthorizationStartResult result, FakeManagedProcess process) {
    }

    private static final class MutableClock extends Clock {

        private Instant instant;

        private MutableClock(Instant instant) {
            this.instant = instant;
        }

        private void advance(Duration duration) {
            instant = instant.plus(duration);
        }

        private void setMillis(long epochMillis) {
            instant = Instant.ofEpochMilli(epochMillis);
        }

        @Override
        public ZoneId getZone() {
            return ZoneId.of("UTC");
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return instant;
        }
    }

    private static final class FakeManagedProcess implements ManagedProcess {

        private boolean alive;
        private Integer exitCode;
        private List<String> outputSnapshots = List.of("");
        private int outputSnapshotIndex;
        private int outputCompleteAtSnapshot = Integer.MAX_VALUE;
        private boolean truncated;
        private boolean destroyed;
        private int destroyCalls;
        private CountDownLatch destroyEntered;
        private CountDownLatch releaseDestroy;
        private CountDownLatch inspectionEntered;
        private CountDownLatch releaseInspection;

        private static FakeManagedProcess alive(String output) {
            return aliveSnapshots(output);
        }

        private static FakeManagedProcess aliveSnapshots(String... outputs) {
            FakeManagedProcess process = new FakeManagedProcess();
            process.alive = true;
            process.outputSnapshots = List.of(outputs);
            return process;
        }

        private static FakeManagedProcess exitedWhileOutputDrains(String... outputs) {
            FakeManagedProcess process = new FakeManagedProcess();
            process.exitCode = 0;
            process.outputSnapshots = List.of(outputs);
            process.outputCompleteAtSnapshot = outputs.length - 1;
            return process;
        }

        private static FakeManagedProcess exited(int exitCode, String output) {
            FakeManagedProcess process = new FakeManagedProcess();
            process.exitCode = exitCode;
            process.outputSnapshots = List.of(output);
            process.outputCompleteAtSnapshot = 0;
            return process;
        }

        private static FakeManagedProcess truncated(String output) {
            FakeManagedProcess process = alive(output);
            process.truncated = true;
            return process;
        }

        private void blockDestroy() {
            destroyEntered = new CountDownLatch(1);
            releaseDestroy = new CountDownLatch(1);
        }

        private void blockInspection() {
            inspectionEntered = new CountDownLatch(1);
            releaseInspection = new CountDownLatch(1);
        }

        @Override
        public boolean isAlive() {
            return alive;
        }

        @Override
        public Integer exitCode() {
            return exitCode;
        }

        @Override
        public String output() {
            int index = Math.min(outputSnapshotIndex, outputSnapshots.size() - 1);
            if (alive && outputSnapshotIndex < outputSnapshots.size() - 1) {
                outputSnapshotIndex++;
            }
            return outputSnapshots.get(index);
        }

        @Override
        public boolean outputComplete() {
            boolean complete = outputSnapshotIndex >= outputCompleteAtSnapshot;
            if (!complete && !alive && outputSnapshotIndex < outputSnapshots.size() - 1) {
                outputSnapshotIndex++;
            }
            return complete;
        }

        @Override
        public boolean outputTruncated() {
            if (inspectionEntered != null) {
                inspectionEntered.countDown();
                try {
                    if (!releaseInspection.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Timed out waiting to release inspection");
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while waiting to inspect process", e);
                }
            }
            return truncated;
        }

        @Override
        public void destroy() {
            destroyCalls++;
            destroyed = true;
            alive = false;
            if (destroyEntered != null) {
                destroyEntered.countDown();
                try {
                    if (!releaseDestroy.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Timed out waiting to release destroy");
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("Interrupted while waiting to release destroy", e);
                }
            }
        }
    }
}
