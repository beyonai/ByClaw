package com.iwhalecloud.byai.manager.domain.connector.provider.lark;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.EnumSource;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandExecutor;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandRequest;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessHandle;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessSnapshot;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver.UserSandboxContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

class LarkSandboxAuthorizationRuntimeTest {

    @Test
    void revokesCredentialInsideUserExecutionSandbox() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any())).thenReturn(new SandboxCommandResult(0, "{}", "", false, false));

        runtime.revoke("42", commandCatalog());

        var requestCaptor = org.mockito.ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(executor).run(org.mockito.ArgumentMatchers.eq("sandbox-1"), requestCaptor.capture());
        assertThat(requestCaptor.getValue().argv().subList(5, requestCaptor.getValue().argv().size())).containsExactly("lark-cli", "auth", "logout", "--json");
        assertThat(requestCaptor.getValue().environment()).containsAllEntriesOf(Map.of(
            "HOME", "/by/.connector-auth/.lark-cli", "LARK_HOME", "/by/.connector-auth/.lark-cli"));
    }

    @Test
    void startsUserAuthorizationInsideUserExecutionSandbox() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkAuthorizationProperties properties = new LarkAuthorizationProperties();
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, properties, new ObjectMapper(), userService);
        Users user = new Users();
        user.setUserCode("user-code-42");
        when(userService.findById(42L)).thenReturn(user);
        when(resolver.resolve("user-code-42"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", "generation-1", new Date()));
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"https://open.feishu.cn/device\","
                    + "\"device_code\":\"device-1\",\"expires_in\":120}", "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", "https://localhost/callback", Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://open.feishu.cn/device");
        assertThat(result.providerState()).contains("sandbox-1", "device-1");
        verify(resolver).resolve("user-code-42");
        verify(executor, never()).start(any(), any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void preservesExistingApplicationWhenLoginCannotReadItsCredentials(boolean legacyManifest) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(success("{\"configured\":true}"))
            .thenReturn(notConfigured());

        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog(legacyManifest)));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PROVIDER_START_FAILED");
        verify(fixture.executor, never()).start(any(), any());
        verify(fixture.executor, times(2)).run(any(), any());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void initializesMissingConfigurationWithNewOrLegacyManifest(boolean legacyManifest) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog(legacyManifest)));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.phase()).isEqualTo("app_initialization");
        assertThat(result.providerState()).contains("init-1", "generation-1");
        verify(fixture.executor, times(1)).run(any(), any());
    }

    @Test
    void waitsForApplicationUrlAfterInitiallyEmptyOutput() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 0, false))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
                "https://open.feishu.cn/app/init\n", 31, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://open.feishu.cn/app/init");
        verify(fixture.executor, never()).terminate(any(), any());
    }

    @Test
    void doesNotReturnPartialUrlAndAccumulatesOutputAcrossCursors() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
                "https://open.feishu.cn/app/init?ticket=first", 43, false));
        when(fixture.executor.readOutput("sandbox-1", "init-1", 43))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
                "-second\n", 51, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://open.feishu.cn/app/init?ticket=first-second");
        assertThat(result.providerState()).contains("\"outputCursor\":51");
        verify(fixture.executor, never()).terminate(any(), any());
    }

    @Test
    void failedStartupIsNotReportedAsMissingUrl() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.EXITED, 1);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 1,
                "configuration initialization failed\n", 36, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @Test
    void drainsOutputWrittenJustBeforeProcessExitIncludingUnterminatedLastLine() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.EXITED, 0);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 0, false))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0,
                "https://open.feishu.cn/app/init?ticket=first", 43, false));
        when(fixture.executor.readOutput("sandbox-1", "init-1", 43))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0,
                "-second", 50, false));
        when(fixture.executor.readOutput("sandbox-1", "init-1", 50))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 50, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo("https://open.feishu.cn/app/init?ticket=first-second");
        assertThat(result.providerState()).contains("\"outputCursor\":50");
        verify(fixture.executor, never()).terminate(any(), any());
    }

    @ParameterizedTest
    @EnumSource(value = SandboxProcessSnapshot.State.class, names = {"FAILED", "TERMINATED", "NOT_FOUND"})
    void terminalStartupFailureDoesNotAcceptAnOutputUrl(SandboxProcessSnapshot.State state) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(state, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @Test
    void truncatedOutputDoesNotAcceptAnOutputUrl() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
                "https://open.feishu.cn/app/init\n", 31, true));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @Test
    void cumulativeOutputIsBoundedEvenWhenIndividualChunksAreNotTruncated() {
        RuntimeFixture fixture = new RuntimeFixture();
        fixture.properties.setMaxOutputBytes(6);
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "日志", 6, false));
        when(fixture.executor.readOutput("sandbox-1", "init-1", 6))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "x", 7, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @Test
    void runningProcessWithoutCompleteUrlTimesOutAndIsTerminated() {
        RuntimeFixture fixture = new RuntimeFixture();
        fixture.properties.setInitializationOutputTimeout(Duration.ofMillis(10));
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
                "https://open.feishu.cn/app/init?ticket=partial", 45, false));
        when(fixture.executor.readOutput("sandbox-1", "init-1", 45))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 45, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_URL_MISSING");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @Test
    void processExitingWithoutUrlIsAnInitializationFailure() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.EXITED, 0);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 0, false));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @Test
    void outputFailureStillTerminatesTheStartedProcess() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0))
            .thenThrow(new IllegalStateException("transport unavailable"));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        verify(fixture.executor).terminate("sandbox-1", "init-1");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void interruptedWaitPreservesInterruptAndTerminatesTheStartedProcess(boolean urlReady) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0)).thenAnswer(invocation -> {
            Thread.currentThread().interrupt();
            return new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
                urlReady ? "https://open.feishu.cn/app/init\n" : "", urlReady ? 31 : 0, false);
        });

        try {
            var result = fixture.runtime.start(startContext(commandCatalog()));

            assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
            assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
            verify(fixture.executor).terminate("sandbox-1", "init-1");
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void interruptedTransportFailureAllowsCleanupBeforeRestoringInterrupt() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.readOutput("sandbox-1", "init-1", 0)).thenAnswer(invocation -> {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("transport interrupted");
        });
        org.mockito.Mockito.doAnswer(invocation -> {
            assertThat(Thread.currentThread().isInterrupted()).isFalse();
            return null;
        }).when(fixture.executor).terminate("sandbox-1", "init-1");

        try {
            var result = fixture.runtime.start(startContext(commandCatalog()));

            assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
            assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
            verify(fixture.executor).terminate("sandbox-1", "init-1");
        } finally {
            Thread.interrupted();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "openclaw context detected but lark-cli is not bound to it",
        "hermes context detected but lark-cli is not bound to it",
        "lark-channel context detected but lark-cli is not bound to it"
    })
    void initializesMissingConfigurationInAgentWorkspace(String message) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(configError("not_configured", message, null));
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.phase()).isEqualTo("app_initialization");
        assertThat(result.authorizationUrl()).isEqualTo("https://open.feishu.cn/app/init");
        var command = org.mockito.ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(fixture.executor).start(eq("sandbox-1"), command.capture());
        assertThat(command.getValue().argv().subList(5, command.getValue().argv().size())).containsExactly(
            "lark-cli", "config", "init", "--new", "--force-init");
        verify(fixture.executor, times(1)).run(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"LARKSUITE_CLI_PROFILE", "currentApp", "--profile"})
    void missingProfileDoesNotReinitializeExistingApplication(String field) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(configError("not_configured", "profile \"ghost\" not found", field));
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_CONFIG_CHECK_FAILED");
        verify(fixture.executor, never()).start(any(), any());
        verify(fixture.executor, times(1)).run(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "not configured",
        "openclaw context detected but lark-cli is not bound to it"
    })
    void configurationErrorWithFieldDoesNotInitializeEvenWhenMessageSaysNotConfigured(String message) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(configError("not_configured", message, "unexpected-field"));
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_CONFIG_CHECK_FAILED");
        verify(fixture.executor, never()).start(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "configuration could not be read",
        "failed to load config: permission denied",
        "no active profile",
        "no active profile in openclaw workspace",
        "read application secret: keychain decryption failed",
        "failed to load config: openclaw context detected but lark-cli is not bound to it",
        "openclaw context detected but lark-cli is not bound to it; failed to load config"
    })
    void unknownNotConfiguredMessageDoesNotInitializeApplication(String message) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(configError("not_configured", message, null));
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_CONFIG_CHECK_FAILED");
        verify(fixture.executor, never()).start(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "auth"})
    void unrecognizedErrorTypeDoesNotInitializeApplication(String type) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(new SandboxCommandResult(3, "",
            "{\"ok\":false,\"error\":{\"type\":\"" + type
                + "\",\"subtype\":\"not_configured\",\"message\":\"not configured\"}}", false, false));
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_CONFIG_CHECK_FAILED");
        verify(fixture.executor, never()).start(any(), any());
    }

    @Test
    void workspaceMissingMessageWithWrongErrorTypeDoesNotInitializeApplication() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(new SandboxCommandResult(3, "", """
            {"ok":false,"error":{"type":"auth","subtype":"not_configured",
             "message":"openclaw context detected but lark-cli is not bound to it"}}
            """, false, false));
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_CONFIG_CHECK_FAILED");
        verify(fixture.executor, never()).start(any(), any());
    }

    @Test
    void malformedConfigurationDoesNotInitializeApplication() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(configError("invalid_config",
            "failed to load config: invalid config format: malformed config: unexpected end of JSON input", null));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_CONFIG_CHECK_FAILED");
        verify(fixture.executor, never()).start(any(), any());
    }

    @Test
    void completedInitializationStartsUserAuthorizationWithoutBindingExternalConfiguration() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(notConfigured())
            .thenReturn(success("{\"configured\":true}"))
            .thenReturn(loginResponse());
        fixture.stubInitialization(SandboxProcessSnapshot.State.EXITED, 0);
        var started = fixture.runtime.start(startContext(commandCatalog()));

        var result = fixture.runtime.queryStatus(session(started));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.progress().phase()).isEqualTo("user_authorization");
        assertThat(result.progress().authorizationUrl()).isEqualTo("https://accounts.feishu.cn/device");
        assertThat(result.progress().providerState()).contains("device-1", "generation-1")
            .doesNotContain("init-1");
        verify(fixture.executor, times(1)).start(any(), any());
    }

    @Test
    void failedInitializationTerminatesWithoutTryingUserLogin() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        when(fixture.executor.inspect("sandbox-1", "init-1"))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 48, false))
            .thenReturn(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 1, "", 48, false));
        var started = fixture.runtime.start(startContext(commandCatalog()));

        var result = fixture.runtime.queryStatus(session(started));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        assertThat(result.progress()).isNull();
        verify(fixture.executor, times(1)).run(any(), any());
    }

    @Test
    void completedInitializationWithoutConfigurationTerminatesInsteadOfRemainingPending() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.EXITED, 0);
        var started = fixture.runtime.start(startContext(commandCatalog()));

        var result = fixture.runtime.queryStatus(session(started));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("APP_INIT_FAILED");
        assertThat(result.progress()).isNull();
        verify(fixture.executor, times(1)).start(any(), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"not_configured", "user_not_configured", "invalid_response"})
    void loginFailureAfterInitializationIsTerminalAndDoesNotReinitialize(String failure) {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(notConfigured())
            .thenReturn(success("{\"configured\":true}"))
            .thenReturn(configError(failure, "not_configured".equals(failure) ? "not configured" : failure, null));
        fixture.stubInitialization(SandboxProcessSnapshot.State.EXITED, 0);
        var started = fixture.runtime.start(startContext(commandCatalog(true)));

        var result = fixture.runtime.queryStatus(session(started));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PROVIDER_START_FAILED");
        assertThat(result.progress()).isNull();
        verify(fixture.executor, times(1)).start(any(), any());
        verify(fixture.executor, times(3)).run(any(), any());
    }

    @Test
    void missingUserAuthorizationDoesNotReinitializeApplication() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(success("{\"configured\":true}"))
            .thenReturn(configError("user_not_configured", "User authorization is unavailable", null));

        var result = fixture.runtime.start(startContext(commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PROVIDER_START_FAILED");
        verify(fixture.executor, never()).start(any(), any());
    }

    @Test
    void completesUserDeviceAuthorizationWithExistingLocalConfiguration() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any()))
            .thenReturn(success("{\"configured\":true}"))
            .thenReturn(loginResponse())
            .thenReturn(success("{\"identity\":\"user\",\"verified\":false}"))
            .thenReturn(success("{\"identity\":\"user\",\"verified\":true,"
                + "\"identities\":{\"user\":{\"openId\":\"ou_42\"}}}"));
        when(fixture.executor.start(eq("sandbox-1"), any()))
            .thenReturn(new SandboxProcessHandle("sandbox-1", "auth-process-1", Instant.now()));
        var started = fixture.runtime.start(startContext(commandCatalog()));

        var pending = fixture.runtime.queryStatus(session(started));
        var completed = fixture.runtime.queryStatus(new AuthorizationSessionContext(
            "auth-1", "42", 1L, "lark", "lark-cli", null,
            pending.progress().providerState(), pending.progress().expiresAt(), commandCatalog()));

        assertThat(pending.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(pending.progress().phase()).isEqualTo("user_authorization");
        assertThat(completed.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(completed.accountId()).isEqualTo("ou_42");
        var command = org.mockito.ArgumentCaptor.forClass(SandboxCommandRequest.class);
        verify(fixture.executor).start(eq("sandbox-1"), command.capture());
        assertThat(command.getValue().argv().subList(5, command.getValue().argv().size())).containsExactly(
            "lark-cli", "auth", "login", "--device-code", "device-1", "--json");
    }

    @Test
    void cancelTerminatesLocalApplicationInitializationProcess() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());
        fixture.stubInitialization(SandboxProcessSnapshot.State.RUNNING, null);
        var started = fixture.runtime.start(startContext(commandCatalog()));

        fixture.runtime.cancel(session(started));

        verify(fixture.executor).terminate("sandbox-1", "init-1");
        verify(fixture.executor, times(1)).start(any(), any());
    }

    @Test
    void revokeFailureDoesNotInitializeApplicationOrReportSuccess() {
        RuntimeFixture fixture = new RuntimeFixture();
        when(fixture.executor.run(any(), any())).thenReturn(notConfigured());

        assertThatThrownBy(() -> fixture.runtime.revoke("42", commandCatalog()))
            .isInstanceOf(IllegalStateException.class).hasMessage("Unable to revoke Lark credential");

        verify(fixture.executor, never()).start(any(), any());
    }

    @Test
    void acceptsDeviceVerificationUrlOnAccountsHost() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        String verificationUrl =
            "https://accounts.feishu.cn/oauth/v1/device/verify?flow_id=flow-1&user_code=5ZMG-MUFK";
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"" + verificationUrl + "\","
                    + "\"device_code\":\"device-1\",\"expires_in\":600}", "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", null, Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.PENDING);
        assertThat(result.authorizationUrl()).isEqualTo(verificationUrl);
    }

    @Test
    void rejectsVerificationUrlOnUntrustedHost() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any()))
            .thenReturn(new SandboxCommandResult(0, "{\"configured\":true}", "", false, false))
            .thenReturn(new SandboxCommandResult(0,
                "{\"verification_url\":\"https://accounts.feishu.cn.evil.example/verify\","
                    + "\"device_code\":\"device-1\"}", "", false, false));

        var result = runtime.start(new AuthorizationStartContext(
            "auth-1", "42", 1L, "lark", "lark-cli", null, Map.of(), commandCatalog()));

        assertThat(result.status()).isEqualTo(AuthorizationStatus.FAILED);
        assertThat(result.errorCode()).isEqualTo("PROVIDER_PROTOCOL_ERROR");
    }

    @Test
    void verifyReadsUserIdentityFromUserExecutionSandbox() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any())).thenReturn(new SandboxCommandResult(0, """
            {"appId":"cli_app","brand":"feishu","identity":"user","verified":true,
             "identities":{"bot":{"status":"ready","verified":true,"openId":"ou_bot"},
                           "user":{"status":"ready","verified":true,
                                   "openId":"ou_65c765c074a0098a75f51a15f454313a",
                                   "userName":"谢逊飞","tokenStatus":"valid",
                                   "expiresAt":"2030-08-10T23:58:47+08:00",
                                   "refreshExpiresAt":"2030-08-17T21:58:47+08:00"}}}
            """, "", false, false));

        var result = runtime.verify("42", commandCatalog());

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.accountId()).isEqualTo("ou_65c765c074a0098a75f51a15f454313a");
        assertThat(result.accountName()).isEqualTo("谢逊飞");
        assertThat(result.credentialExpiresAt())
            .isEqualTo(Date.from(Instant.parse("2030-08-10T15:58:47Z")));
        assertThat(result.refreshExpiresAt())
            .isEqualTo(Date.from(Instant.parse("2030-08-17T13:58:47Z")));
        assertThat(result.renewalMode().name()).isEqualTo("REFRESH_TOKEN");
    }

    @Test
    void verifyMapsExplicitlyExpiredUserTokenWithoutRefreshMetadataToReauthorizationRequired() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        when(resolver.resolve("42"))
            .thenReturn(new UserSandboxContext("sandbox-1", "42", null, new Date()));
        when(executor.run(any(), any())).thenReturn(new SandboxCommandResult(0, """
            {"identity":"user","verified":true,
             "identities":{"user":{"openId":"ou_expired","tokenStatus":"expired"}}}
            """, "", false, false));

        var result = runtime.verify("42", commandCatalog());

        assertThat(result.status()).isEqualTo(AuthorizationStatus.CONNECTED);
        assertThat(result.credentialState().name()).isEqualTo("REAUTH_REQUIRED");
    }

    @Test
    void revokeStopsBeforeRunningCommandsWhenUserExecutionEnvironmentIsUnavailable() {
        SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        UserService userService = mock(UserService.class);
        LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, new LarkAuthorizationProperties(), new ObjectMapper(), userService);
        IllegalStateException unavailable = new IllegalStateException("User execution environment is unavailable");
        when(resolver.resolve("42")).thenThrow(unavailable);

        assertThatThrownBy(() -> runtime.revoke("42", commandCatalog())).isSameAs(unavailable);

        verifyNoInteractions(executor);
    }

    private AuthorizationStartContext startContext(ManifestCommandCatalog catalog) {
        return new AuthorizationStartContext("auth-1", "42", 1L, "lark", "lark-cli", null, Map.of(), catalog);
    }

    private AuthorizationSessionContext session(AuthorizationStartResult started) {
        return new AuthorizationSessionContext("auth-1", "42", 1L, "lark", "lark-cli", null,
            started.providerState(), started.expiresAt(), commandCatalog());
    }

    private static SandboxCommandResult success(String stdout) {
        return new SandboxCommandResult(0, stdout, "", false, false);
    }

    private static SandboxCommandResult notConfigured() {
        return new SandboxCommandResult(3, "", """
            {"ok":false,"error":{"type":"config","subtype":"not_configured","message":"not configured",
             "hint":"run `lark-cli config init --new` in the background. It blocks and outputs a verification URL — retrieve the URL and open it in a browser to complete setup."}}
            """, false, false);
    }

    private static SandboxCommandResult configError(String subtype, String message, String field) {
        var response = new ObjectMapper().createObjectNode();
        response.put("ok", false);
        var error = response.putObject("error");
        error.put("type", "config");
        error.put("subtype", subtype);
        error.put("message", message);
        if (field != null) {
            error.put("field", field);
        }
        return new SandboxCommandResult(3, "", response.toString(), false, false);
    }

    private static SandboxCommandResult loginResponse() {
        return success("{\"verification_url\":\"https://accounts.feishu.cn/device\",\"device_code\":\"device-1\"}");
    }

    private static class RuntimeFixture {
        final SandboxCommandExecutor executor = mock(SandboxCommandExecutor.class);
        final UserSandboxResolver resolver = mock(UserSandboxResolver.class);
        final LarkAuthorizationProperties properties = new LarkAuthorizationProperties();
        final LarkSandboxAuthorizationRuntime runtime = new LarkSandboxAuthorizationRuntime(
            executor, resolver, properties, new ObjectMapper(), mock(UserService.class));

        RuntimeFixture() {
            when(resolver.resolve("42"))
                .thenReturn(new UserSandboxContext("sandbox-1", "42", "generation-1", new Date()));
        }

        void stubInitialization(SandboxProcessSnapshot.State state, Integer exitCode) {
            when(executor.start(eq("sandbox-1"), any()))
                .thenReturn(new SandboxProcessHandle("sandbox-1", "init-1", Instant.now()));
            when(executor.readOutput(eq("sandbox-1"), eq("init-1"), org.mockito.ArgumentMatchers.anyLong()))
                .thenReturn(new SandboxProcessSnapshot(state, exitCode, "https://open.feishu.cn/app/init\n", 48, false));
            when(executor.inspect("sandbox-1", "init-1"))
                .thenReturn(new SandboxProcessSnapshot(state, exitCode, "", 48, false));
        }
    }

    private ManifestCommandCatalog commandCatalog() {
        return commandCatalog(false);
    }

    private ManifestCommandCatalog commandCatalog(boolean legacyManifest) {
        Map<String, List<List<String>>> commands = new java.util.LinkedHashMap<>(Map.of(
            "configCheck", List.of(List.of("lark-cli", "config", "show")),
            "configInitialize", List.of(List.of("lark-cli", "config", "init", "--new", "--force-init")),
            "login", List.of(
                List.of("lark-cli", "auth", "login", "--domain", "all", "--no-wait", "--json"),
                List.of("lark-cli", "auth", "login", "--device-code", "${deviceCode}", "--json")),
            "status", List.of(List.of("lark-cli", "auth", "status", "--json", "--verify")),
            "logout", List.of(List.of("lark-cli", "auth", "logout", "--json"))
        ));
        if (legacyManifest) {
            commands.put("contextBind", List.of(List.of(
                "lark-cli", "config", "bind", "--source", "openclaw", "--identity", "user-default", "--force")));
        }
        return new ManifestCommandCatalog(commands, "test-digest",
            Map.of("deviceCode", ManifestCommandCatalog.PlaceholderPolicy.safeValue(512)));
    }
}
