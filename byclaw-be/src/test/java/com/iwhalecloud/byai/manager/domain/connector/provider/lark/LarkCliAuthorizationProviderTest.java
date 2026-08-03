package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

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

class LarkCliAuthorizationProviderTest {

    private static final String AUTHORIZATION_ID = "auth-lark-1";
    private static final String DEVICE_CODE = "device-secret-code";
    private static final String APP_SECRET = "deployment-app-secret";
    private static final List<String> CONFIG_SHOW = List.of("lark-cli", "config", "show");
    private static final List<String> STATUS = List.of("lark-cli", "auth", "status", "--json", "--verify");
    private static final List<String> DEFAULT_LOGIN = List.of(
        "lark-cli", "auth", "login", "--recommend", "--no-wait", "--json");
    private static final Map<String, String> ENVIRONMENT = Map.of("HOME", "/tmp/lark-cli-test");
    private static final ConnectorCliWorkspace WORKSPACE = new ConnectorCliWorkspace(
        Path.of("/tmp/lark-cli-test"), ENVIRONMENT);

    private final ConnectorCliRunner cliRunner = mock(ConnectorCliRunner.class);
    private final ConnectorCredentialWorkspaceService workspaceService =
        mock(ConnectorCredentialWorkspaceService.class);
    private final ObjectMapper objectMapper = new ObjectMapper();

    private LarkCliAuthorizationProvider provider;

    @BeforeEach
    void setUp() {
        when(workspaceService.resolve(42L, "lark-cli")).thenReturn(WORKSPACE);
        provider = provider("", "");
    }

    @Test
    void exposesLarkCliProviderCode() {
        assertThat(provider.providerCode()).isEqualTo("lark-cli");
    }

    @Test
    void configuredAppSkipsInitializationAndStartsRecommendedLoginWithoutDeploymentCredentials() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{\"configured\":true}"));
        when(cliRunner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(loginResult("verification_url", "https://open.feishu.cn/device", 120));
        long before = System.currentTimeMillis();

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        long after = System.currentTimeMillis();
        assertPendingStart(result, "https://open.feishu.cn/device");
        assertThat(result.providerState()).isEqualTo("{\"deviceCode\":\"" + DEVICE_CODE + "\"}");
        assertThat(result.expiresAt().getTime()).isBetween(before + 120_000L, after + 120_000L);
        InOrder order = inOrder(cliRunner);
        order.verify(cliRunner).run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class));
        order.verify(cliRunner).run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class));
        verifyNoMoreInteractions(cliRunner);
    }

    @Test
    void missingDeploymentCredentialsFailOnlyWhenConfigIsNotConfigured() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(notConfiguredResult());

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "APP_CONFIG_MISSING");
        verify(cliRunner).run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class));
        verifyNoMoreInteractions(cliRunner);
    }

    @Test
    void initializesConfigWithSecretOnStdinAndNeverInArgv() {
        provider = provider("cli_app_id", APP_SECRET);
        List<String> initCommand = List.of(
            "lark-cli", "config", "init", "--app-id", "cli_app_id",
            "--app-secret-stdin", "--brand", "feishu");
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(notConfiguredResult());
        when(cliRunner.run(eq(initCommand), eq(ENVIRONMENT), eq(APP_SECRET + System.lineSeparator()),
            any(Duration.class))).thenReturn(new CliResult(0, "{}"));
        when(cliRunner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(loginResult("verification_url", "https://open.feishu.cn/device", 600));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        ArgumentCaptor<List<String>> commands = ArgumentCaptor.forClass(List.class);
        verify(cliRunner, times(3)).run(commands.capture(), eq(ENVIRONMENT), any(), any(Duration.class));
        assertThat(commands.getAllValues()).allSatisfy(command -> assertThat(command).doesNotContain(APP_SECRET));
        assertThat(commands.getAllValues().get(1)).isEqualTo(initCommand);
    }

    @Test
    void configInitializationFailureIsSanitized() {
        provider = provider("cli_app_id", APP_SECRET);
        List<String> initCommand = List.of(
            "lark-cli", "config", "init", "--app-id", "cli_app_id",
            "--app-secret-stdin", "--brand", "feishu");
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(notConfiguredResult());
        when(cliRunner.run(eq(initCommand), eq(ENVIRONMENT), eq(APP_SECRET + System.lineSeparator()),
            any(Duration.class))).thenReturn(new CliResult(8, "failure " + APP_SECRET, true));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "APP_CONFIG_FAILED");
        assertThat(result.errorMessage()).doesNotContain(APP_SECRET);
        verify(cliRunner, times(2)).run(anyList(), eq(ENVIRONMENT), any(), any(Duration.class));
    }

    @Test
    void unrelatedConfigCheckFailureDoesNotOverwriteConfig() {
        provider = provider("cli_app_id", APP_SECRET);
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(3, "{\"error\":{\"subtype\":\"permission_denied\"}}"));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "APP_CONFIG_CHECK_FAILED");
        verify(cliRunner).run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class));
        verifyNoMoreInteractions(cliRunner);
    }

    @Test
    void domainsAreDeduplicatedAndRenderedAsRepeatedArguments() {
        List<String> expected = List.of(
            "lark-cli", "auth", "login", "--domain", "d1", "--domain", "d2", "--no-wait", "--json");
        stubConfiguredLogin(expected);

        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "domains", List.of("d1", "d1", "d2"))));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        verify(cliRunner).run(eq(expected), eq(ENVIRONMENT), isNull(), any(Duration.class));
    }

    @Test
    void scopesAreDeduplicatedAndRenderedAsOneCommaSeparatedArgument() {
        List<String> expected = List.of(
            "lark-cli", "auth", "login", "--scope", "scope-a,scope-b", "--no-wait", "--json");
        stubConfiguredLogin(expected);

        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "scopes", List.of("scope-a", "scope-a", "scope-b"))));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        verify(cliRunner).run(eq(expected), eq(ENVIRONMENT), isNull(), any(Duration.class));
    }

    @Test
    void rejectsSimultaneousDomainsAndScopesBeforeRunningCli() {
        AuthorizationStartResult result = provider.start(startContext(Map.of(
            "domains", List.of("d1"),
            "scopes", List.of("scope-a"))));

        assertFailedStart(result, "PROVIDER_CONFIG_INVALID");
        verifyNoInteractions(cliRunner);
    }

    @Test
    void rejectsMalformedProviderConfigElementsBeforeRunningCli() {
        Map<String, Object> config = new HashMap<>();
        config.put("domains", List.of("d1", " "));

        AuthorizationStartResult blank = provider.start(startContext(config));
        config.put("domains", List.of("d1", 7));
        AuthorizationStartResult nonString = provider.start(startContext(config));
        config.put("domains", "d1");
        AuthorizationStartResult nonList = provider.start(startContext(config));

        assertFailedStart(blank, "PROVIDER_CONFIG_INVALID");
        assertFailedStart(nonString, "PROVIDER_CONFIG_INVALID");
        assertFailedStart(nonList, "PROVIDER_CONFIG_INVALID");
        verifyNoInteractions(cliRunner);
    }

    @Test
    void parsesCamelCaseFieldsFromRoot() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, """
                {"verificationUrl":"https://open.feishu.cn/root","deviceCode":"device-secret-code","expiresIn":60}
                """));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertPendingStart(result, "https://open.feishu.cn/root");
    }

    @Test
    void parsesSnakeCaseFieldsFromDataAndFallsBackToCompleteVerificationUri() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, """
                {"data":{"verification_uri_complete":"https://open.feishu.cn/complete",
                "device_code":"device-secret-code","expires_in":-1}}
                """));
        long before = System.currentTimeMillis();

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        long after = System.currentTimeMillis();
        assertPendingStart(result, "https://open.feishu.cn/complete");
        assertThat(result.expiresAt().getTime()).isBetween(before + 600_000L, after + 600_000L);
    }

    @Test
    void malformedOrIncompleteLoginResponsesFailWithoutLeakingDeviceCode() {
        List<CliResult> invalidResults = List.of(
            new CliResult(0, "not-json"),
            new CliResult(0, "{\"device_code\":\"" + DEVICE_CODE + "\"}"),
            new CliResult(0, "{\"verification_url\":\"https://open.feishu.cn/device\"}"),
            new CliResult(0, "{\"verification_url\":\"javascript:alert(1)\",\"device_code\":\""
                + DEVICE_CODE + "\"}")
        );

        for (CliResult invalidResult : invalidResults) {
            ConnectorCliRunner runner = mock(ConnectorCliRunner.class);
            when(runner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
                .thenReturn(new CliResult(0, "{}"));
            when(runner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
                .thenReturn(invalidResult);
            LarkCliAuthorizationProvider isolated = provider(runner, "", "");

            AuthorizationStartResult result = isolated.start(startContext(Map.of()));

            assertFailedStart(result, "PROVIDER_PROTOCOL_ERROR");
            assertThat(result.errorMessage()).doesNotContain(DEVICE_CODE).doesNotContain("javascript");
        }
    }

    @Test
    void truncatedLoginResponseIsProviderStartFailure() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{\"verification_url\":\"https://open.feishu.cn/device\","
                + "\"device_code\":\"" + DEVICE_CODE + "\"}", true));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "PROVIDER_START_FAILED");
        assertThat(result.errorMessage()).doesNotContain(DEVICE_CODE);
    }

    @Test
    void loginNonzeroExitIsProviderStartFailureAndSanitized() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.run(eq(DEFAULT_LOGIN), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(9, "raw " + DEVICE_CODE));

        AuthorizationStartResult result = provider.start(startContext(Map.of()));

        assertFailedStart(result, "PROVIDER_START_FAILED");
        assertThat(result.errorMessage()).doesNotContain(DEVICE_CODE);
    }

    @Test
    void alreadyVerifiedStatusConnectsWithoutStartingCompletionProcess() {
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, """
                {"data":{"verified":true,"identity":"user",
                "identities":{"user":{"open_id":"ou_123","name":"Lark User"}},
                "expires_at":"2026-08-01T04:30:00Z"}}
                """));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("ou_123");
        assertThat(result.accountName()).isEqualTo("Lark User");
        assertThat(result.credentialExpiresAt()).isEqualTo(Date.from(Instant.parse("2026-08-01T04:30:00Z")));
        assertThat(result.errorCode()).isNull();
        verify(cliRunner, never()).start(anyList(), any(), any());
    }

    @Test
    void explicitAuthenticatedStatusConnectsTolerantly() {
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{\"loggedIn\":true,\"user_id\":\"u-42\",\"user_name\":\"User\"}"));

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("u-42");
        assertThat(result.accountName()).isEqualTo("User");
    }

    @Test
    void verifiedBotStatusWithStaleUserIdentityDoesNotConnect() {
        ManagedProcess process = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, """
                {"verified":true,"identity":"bot","identities":{
                "bot":{"appId":"cli_app"},
                "user":{"openId":"ou_stale","userName":"Stale User"}}}
                """));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(true);

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        verify(cliRunner).start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull());
    }

    @Test
    void sequentialLivePollsStartExactlyOneCompletionProcess() {
        ManagedProcess process = mock(ManagedProcess.class);
        List<String> completionCommand = completionCommand(DEVICE_CODE);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(eq(completionCommand), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(true);

        AuthorizationStatusResult first = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));
        AuthorizationStatusResult second = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));

        assertThat(first.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(second.status()).isEqualTo(AuthorizationStatus.PENDING);
        verify(cliRunner, times(1)).start(eq(completionCommand), eq(ENVIRONMENT), isNull());
        verify(cliRunner, times(2)).run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class));
    }

    @Test
    void exitedSuccessfulCompletionVerifiesAgainAndConnects() {
        ManagedProcess process = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(
                new CliResult(0, "{}"),
                new CliResult(0, "{\"status\":\"connected\",\"identities\":{\"user\":{\"openId\":\"ou_9\"}}}"));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(false);
        when(process.exitCode()).thenReturn(0);

        AuthorizationStatusResult result = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("ou_9");
        verify(cliRunner, times(2)).run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class));
    }

    @Test
    void exitedCompletionThatCannotVerifyDoesNotRestartOnRepeatedPolls() {
        ManagedProcess process = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(false);
        when(process.exitCode()).thenReturn(0);
        AuthorizationSessionContext session = sessionContext(AUTHORIZATION_ID, validState());

        AuthorizationStatusResult first = provider.queryStatus(session);
        AuthorizationStatusResult second = provider.queryStatus(session);

        assertFailedStatus(first, "PROVIDER_AUTH_FAILED");
        assertFailedStatus(second, "PROVIDER_AUTH_FAILED");
        assertThat(first.errorMessage()).doesNotContain(DEVICE_CODE);
        assertThat(second.errorMessage()).doesNotContain(DEVICE_CODE);
        verify(cliRunner, times(1)).start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull());
        verify(process).destroy();
    }

    @Test
    void failedCompletionIsReleasedAndTerminalResultExpiresWithSession() {
        ManagedProcess first = mock(ManagedProcess.class);
        ManagedProcess second = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull()))
            .thenReturn(first, second);
        when(first.isAlive()).thenReturn(false);
        when(first.exitCode()).thenReturn(7);
        when(second.isAlive()).thenReturn(false);
        when(second.exitCode()).thenReturn(7);
        AuthorizationSessionContext expiredSession = sessionContext(
            AUTHORIZATION_ID,
            "42",
            validState(),
            new Date(System.currentTimeMillis() - 1L));

        AuthorizationStatusResult firstResult = provider.queryStatus(expiredSession);
        AuthorizationStatusResult secondResult = provider.queryStatus(expiredSession);

        assertFailedStatus(firstResult, "PROVIDER_AUTH_FAILED");
        assertFailedStatus(secondResult, "PROVIDER_AUTH_FAILED");
        verify(cliRunner, times(2)).start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull());
        verify(first).destroy();
        verify(second).destroy();
    }

    @Test
    void terminalResultCacheRemainsBoundedAtCapacity() throws Exception {
        ManagedProcess process = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull()))
            .thenReturn(process);
        when(process.isAlive()).thenReturn(false);
        when(process.exitCode()).thenReturn(7);

        for (int index = 0; index <= 256; index++) {
            AuthorizationStatusResult result = provider.queryStatus(
                sessionContext("auth-capacity-" + index, validState()));
            assertFailedStatus(result, "PROVIDER_AUTH_FAILED");
        }

        java.lang.reflect.Field terminalResults =
            LarkCliAuthorizationProvider.class.getDeclaredField("completionTerminalResults");
        terminalResults.setAccessible(true);
        assertThat((Map<?, ?>) terminalResults.get(provider)).hasSizeLessThanOrEqualTo(256);
    }

    @Test
    void concurrentPollDuringFinalVerificationDoesNotRestartExitedCompletionProcess() throws Exception {
        ManagedProcess process = mock(ManagedProcess.class);
        CountDownLatch finalVerificationEntered = new CountDownLatch(1);
        CountDownLatch releaseFinalVerification = new CountDownLatch(1);
        AtomicInteger statusCalls = new AtomicInteger();
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenAnswer(invocation -> {
                if (statusCalls.incrementAndGet() == 2) {
                    finalVerificationEntered.countDown();
                    if (!releaseFinalVerification.await(5, TimeUnit.SECONDS)) {
                        throw new IllegalStateException("Timed out waiting to release final verification");
                    }
                }
                return new CliResult(0, "{}");
            });
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(false);
        when(process.exitCode()).thenReturn(0);
        AuthorizationSessionContext session = sessionContext(AUTHORIZATION_ID, validState());
        ExecutorService executor = Executors.newFixedThreadPool(2);
        AtomicReference<Thread> concurrentPollThread = new AtomicReference<>();

        try {
            Future<AuthorizationStatusResult> firstPoll = executor.submit(() -> provider.queryStatus(session));
            assertThat(finalVerificationEntered.await(2, TimeUnit.SECONDS)).isTrue();

            Future<AuthorizationStatusResult> concurrentPoll = executor.submit(() -> {
                concurrentPollThread.set(Thread.currentThread());
                return provider.queryStatus(session);
            });
            assertThat(waitUntilBlockedOrDone(concurrentPollThread, concurrentPoll)).isTrue();
            releaseFinalVerification.countDown();
            AuthorizationStatusResult firstResult = firstPoll.get(2, TimeUnit.SECONDS);
            AuthorizationStatusResult concurrentResult = concurrentPoll.get(2, TimeUnit.SECONDS);

            assertFailedStatus(firstResult, "PROVIDER_AUTH_FAILED");
            assertFailedStatus(concurrentResult, "PROVIDER_AUTH_FAILED");
            assertThat(firstResult.errorMessage()).doesNotContain(DEVICE_CODE);
            assertThat(concurrentResult.errorMessage()).doesNotContain(DEVICE_CODE);
            verify(cliRunner, times(1)).start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull());
        } finally {
            releaseFinalVerification.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void connectedPollCannotRemoveProcessBetweenAnotherPollStatusCheckAndProcessLookup() throws Exception {
        ManagedProcess process = mock(ManagedProcess.class);
        ObjectMapper blockingMapper = spy(new ObjectMapper());
        AtomicBoolean blockProviderState = new AtomicBoolean();
        CountDownLatch providerStateRead = new CountDownLatch(1);
        CountDownLatch releaseProviderState = new CountDownLatch(1);
        doAnswer(invocation -> {
            String content = invocation.getArgument(0);
            Object parsed = invocation.callRealMethod();
            if (validState().equals(content) && blockProviderState.compareAndSet(true, false)) {
                providerStateRead.countDown();
                if (!releaseProviderState.await(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("Timed out waiting to release provider state");
                }
            }
            return parsed;
        }).when(blockingMapper).readTree(anyString());
        AtomicInteger statusCalls = new AtomicInteger();
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenAnswer(invocation -> statusCalls.incrementAndGet() >= 3
                ? new CliResult(0, "{\"authenticated\":true}")
                : new CliResult(0, "{}"));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(true, false, false);
        when(process.exitCode()).thenReturn(0);
        LarkCliAuthorizationProvider isolated =
            new LarkCliAuthorizationProvider(cliRunner, workspaceService, blockingMapper, "", "");
        AuthorizationSessionContext session = sessionContext(AUTHORIZATION_ID, validState());
        assertThat(isolated.queryStatus(session).status()).isEqualTo(AuthorizationStatus.PENDING);
        blockProviderState.set(true);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        AtomicReference<Thread> connectedThread = new AtomicReference<>();

        try {
            Future<AuthorizationStatusResult> stalePoll = executor.submit(() -> isolated.queryStatus(session));
            assertThat(providerStateRead.await(5, TimeUnit.SECONDS)).isTrue();
            Future<AuthorizationStatusResult> connectedPoll = executor.submit(() -> {
                connectedThread.set(Thread.currentThread());
                return isolated.queryStatus(session);
            });
            boolean connectedPollBlocked = waitUntilBlockedOrDone(connectedThread, connectedPoll);
            releaseProviderState.countDown();

            assertThat(stalePoll.get(5, TimeUnit.SECONDS).status()).isEqualTo(AuthorizationStatus.CONNECTED);
            assertThat(connectedPoll.get(5, TimeUnit.SECONDS).status()).isEqualTo(AuthorizationStatus.CONNECTED);
            assertThat(connectedPollBlocked).isTrue();
            verify(cliRunner, times(1)).start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull());
        } finally {
            releaseProviderState.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void exitedFailedOrTruncatedCompletionReturnsGenericFailure() {
        List<ManagedProcess> processes = List.of(mock(ManagedProcess.class), mock(ManagedProcess.class));
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(anyList(), eq(ENVIRONMENT), isNull())).thenReturn(processes.get(0), processes.get(1));
        when(processes.get(0).isAlive()).thenReturn(false);
        when(processes.get(0).exitCode()).thenReturn(7);
        when(processes.get(0).output()).thenReturn("failure " + DEVICE_CODE);
        when(processes.get(1).isAlive()).thenReturn(false);
        when(processes.get(1).exitCode()).thenReturn(0);
        when(processes.get(1).outputTruncated()).thenReturn(true);
        when(processes.get(1).output()).thenReturn("truncated " + DEVICE_CODE);

        AuthorizationStatusResult failed = provider.queryStatus(sessionContext("auth-failed", validState()));
        AuthorizationStatusResult truncated = provider.queryStatus(sessionContext("auth-truncated", validState()));

        assertFailedStatus(failed, "PROVIDER_AUTH_FAILED");
        assertFailedStatus(truncated, "PROVIDER_AUTH_FAILED");
        assertThat(failed.errorMessage()).doesNotContain(DEVICE_CODE).doesNotContain("failure");
        assertThat(truncated.errorMessage()).doesNotContain(DEVICE_CODE).doesNotContain("truncated");
    }

    @Test
    void malformedOrUnexpectedProviderStateFailsBeforeStartingProcess() {
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        List<String> invalidStates = List.of(
            "not-json",
            "{}",
            "{\"deviceCode\":\" \"}",
            "{\"deviceCode\":\"device-secret-code\",\"extra\":true}"
        );

        for (String state : invalidStates) {
            AuthorizationStatusResult result = provider.queryStatus(sessionContext(AUTHORIZATION_ID, state));
            assertFailedStatus(result, "PROVIDER_PROTOCOL_ERROR");
        }
        verify(cliRunner, never()).start(anyList(), any(), any());
    }

    @Test
    void connectedStatusDestroysExistingCompletionProcess() {
        ManagedProcess process = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(
                new CliResult(0, "{}"),
                new CliResult(0, "{\"authenticated\":true}"));
        when(cliRunner.start(anyList(), eq(ENVIRONMENT), isNull())).thenReturn(process);
        when(process.isAlive()).thenReturn(true);
        AuthorizationSessionContext session = sessionContext(AUTHORIZATION_ID, validState());

        assertThat(provider.queryStatus(session).status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(provider.queryStatus(session).status()).isEqualTo(AuthorizationStatus.CONNECTED);

        verify(process).destroy();
    }

    @Test
    void cancelDestroysOnlyTheExactAuthorizationProcess() {
        ManagedProcess first = mock(ManagedProcess.class);
        ManagedProcess second = mock(ManagedProcess.class);
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(anyList(), eq(ENVIRONMENT), isNull())).thenReturn(first, second);
        when(first.isAlive()).thenReturn(true);
        when(second.isAlive()).thenReturn(true);
        provider.queryStatus(sessionContext("auth-one", validState()));
        provider.queryStatus(sessionContext("auth-two", validState()));

        provider.cancel(sessionContext("auth-one", validState()));
        provider.cancel(sessionContext("unknown", validState()));
        provider.cancel(null);

        verify(first).destroy();
        verify(second, never()).destroy();
    }

    @Test
    void statusQueuedBehindCancelCannotRestartCompletionProcess() throws Exception {
        ManagedProcess process = mock(ManagedProcess.class);
        ManagedProcess restartedProcess = mock(ManagedProcess.class);
        CountDownLatch destroyEntered = new CountDownLatch(1);
        CountDownLatch releaseDestroy = new CountDownLatch(1);
        doAnswer(invocation -> {
            destroyEntered.countDown();
            if (!releaseDestroy.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("Timed out waiting to release process destroy");
            }
            return null;
        }).when(process).destroy();
        when(cliRunner.run(eq(STATUS), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull()))
            .thenReturn(process, restartedProcess);
        when(process.isAlive()).thenReturn(true);
        when(restartedProcess.isAlive()).thenReturn(true);
        AuthorizationSessionContext session = sessionContext(AUTHORIZATION_ID, validState());
        assertThat(provider.queryStatus(session).status()).isEqualTo(AuthorizationStatus.PENDING);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        AtomicReference<Thread> queuedStatusThread = new AtomicReference<>();

        try {
            Future<?> cancel = executor.submit(() -> provider.cancel(session));
            assertThat(destroyEntered.await(5, TimeUnit.SECONDS)).isTrue();
            Future<AuthorizationStatusResult> queuedStatus = executor.submit(() -> {
                queuedStatusThread.set(Thread.currentThread());
                return provider.queryStatus(session);
            });
            assertThat(waitUntilBlockedOrDone(queuedStatusThread, queuedStatus)).isTrue();
            releaseDestroy.countDown();

            cancel.get(5, TimeUnit.SECONDS);
            AuthorizationStatusResult result = queuedStatus.get(5, TimeUnit.SECONDS);
            assertFailedStatus(result, "PROVIDER_AUTH_CANCELLED");
            verify(cliRunner, times(1)).start(eq(completionCommand(DEVICE_CODE)), eq(ENVIRONMENT), isNull());
        } finally {
            releaseDestroy.countDown();
            executor.shutdownNow();
        }
    }

    @Test
    void invalidUsersFailWithoutResolvingWorkspaceOrRunningCli() {
        AuthorizationStartResult start = provider.start(startContext("0", Map.of()));
        AuthorizationStatusResult status = provider.queryStatus(
            sessionContext(AUTHORIZATION_ID, "not-a-number", validState()));

        assertFailedStart(start, "INVALID_USER");
        assertFailedStatus(status, "INVALID_USER");
        verifyNoInteractions(cliRunner);
        verify(workspaceService, never()).resolve(any(), any());
    }

    @Test
    void workspaceFailuresUseStableSanitizedErrors() {
        when(workspaceService.resolve(42L, "lark-cli"))
            .thenThrow(new IllegalStateException("private-path-and-token"));

        AuthorizationStartResult start = provider.start(startContext(Map.of()));
        AuthorizationStatusResult status = provider.queryStatus(sessionContext(AUTHORIZATION_ID, validState()));

        assertFailedStart(start, "PROVIDER_WORKSPACE_ERROR");
        assertFailedStatus(status, "PROVIDER_WORKSPACE_ERROR");
        assertThat(start.errorMessage()).doesNotContain("private-path-and-token");
        assertThat(status.errorMessage()).doesNotContain("private-path-and-token");
        verifyNoInteractions(cliRunner);
    }

    @Test
    void cliExceptionsMapToStableSanitizedFailures() {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenThrow(new IllegalStateException("command with " + APP_SECRET));

        AuthorizationStartResult start = provider.start(startContext(Map.of()));

        assertFailedStart(start, "APP_CONFIG_CHECK_FAILED");
        assertThat(start.errorMessage()).doesNotContain(APP_SECRET);
    }

    private LarkCliAuthorizationProvider provider(String appId, String appSecret) {
        return provider(cliRunner, appId, appSecret);
    }

    private LarkCliAuthorizationProvider provider(ConnectorCliRunner runner, String appId, String appSecret) {
        return new LarkCliAuthorizationProvider(runner, workspaceService, objectMapper, appId, appSecret);
    }

    private void stubConfiguredLogin(List<String> loginCommand) {
        when(cliRunner.run(eq(CONFIG_SHOW), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(new CliResult(0, "{}"));
        when(cliRunner.run(eq(loginCommand), eq(ENVIRONMENT), isNull(), any(Duration.class)))
            .thenReturn(loginResult("verification_url", "https://open.feishu.cn/device", 600));
    }

    private CliResult notConfiguredResult() {
        return new CliResult(3, "{\"error\":{\"subtype\":\"not_configured\"}}");
    }

    private CliResult loginResult(String urlField, String url, int expiresIn) {
        return new CliResult(0, "{\"" + urlField + "\":\"" + url + "\",\"device_code\":\""
            + DEVICE_CODE + "\",\"expires_in\":" + expiresIn + "}");
    }

    private List<String> completionCommand(String deviceCode) {
        return List.of("lark-cli", "auth", "login", "--device-code", deviceCode, "--json");
    }

    private String validState() {
        return "{\"deviceCode\":\"" + DEVICE_CODE + "\"}";
    }

    private AuthorizationStartContext startContext(Map<String, Object> providerConfig) {
        return startContext("42", providerConfig);
    }

    private AuthorizationStartContext startContext(String userId, Map<String, Object> providerConfig) {
        return new AuthorizationStartContext(
            AUTHORIZATION_ID,
            userId,
            1003L,
            "lark",
            "lark-cli",
            null,
            providerConfig
        );
    }

    private AuthorizationSessionContext sessionContext(String authorizationId, String providerState) {
        return sessionContext(authorizationId, "42", providerState);
    }

    private AuthorizationSessionContext sessionContext(String authorizationId, String userId, String providerState) {
        return sessionContext(
            authorizationId,
            userId,
            providerState,
            new Date(System.currentTimeMillis() + 600_000L));
    }

    private AuthorizationSessionContext sessionContext(
        String authorizationId,
        String userId,
        String providerState,
        Date expiresAt) {
        return new AuthorizationSessionContext(
            authorizationId,
            userId,
            1003L,
            "lark",
            "lark-cli",
            null,
            providerState,
            expiresAt
        );
    }

    private void assertPendingStart(AuthorizationStartResult result, String expectedUrl) {
        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo(expectedUrl);
        assertThat(result.expiresAt()).isNotNull();
        assertThat(result.providerSessionId()).isNull();
        assertThat(result.errorCode()).isNull();
        assertThat(result.errorMessage()).isNull();
    }

    private void assertFailedStart(AuthorizationStartResult result, String errorCode) {
        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.authorizationUrl()).isNull();
        assertThat(result.providerSessionId()).isNull();
        assertThat(result.providerState()).isNull();
        assertThat(result.errorCode()).isEqualTo(errorCode);
        assertThat(result.errorMessage()).isNotBlank();
    }

    private void assertFailedStatus(AuthorizationStatusResult result, String errorCode) {
        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.accountId()).isNull();
        assertThat(result.accountName()).isNull();
        assertThat(result.credentialExpiresAt()).isNull();
        assertThat(result.credentialReference()).isNull();
        assertThat(result.errorCode()).isEqualTo(errorCode);
        assertThat(result.errorMessage()).isNotBlank();
    }

    private boolean waitUntilBlockedOrDone(AtomicReference<Thread> thread, Future<?> future)
        throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        while (System.nanoTime() < deadline) {
            Thread current = thread.get();
            if (current != null && current.getState() == Thread.State.BLOCKED) {
                return true;
            }
            if (future.isDone()) {
                return false;
            }
            Thread.sleep(1L);
        }
        return false;
    }
}
