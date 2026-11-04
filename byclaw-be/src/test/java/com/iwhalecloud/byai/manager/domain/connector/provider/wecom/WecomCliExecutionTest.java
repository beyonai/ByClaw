package com.iwhalecloud.byai.manager.domain.connector.provider.wecom;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.sandbox.command.*;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStartResult;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationSessionContext;
import com.iwhalecloud.byai.manager.domain.connector.authorization.AuthorizationStatus;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ManifestCommandCatalog;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

class WecomCliExecutionTest {
    private static final List<String> STATUS = List.of("wecom-cli", "auth", "show", "--status");
    private static final List<String> INIT = List.of("wecom-cli", "auth", "init", "--noninteractive", "--no-browser");
    @TempDir Path root;
    private final ConnectorCliRunner local = mock(ConnectorCliRunner.class);
    private final ConnectorCredentialWorkspaceService workspaces = mock(ConnectorCredentialWorkspaceService.class);
    private final PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
    private final UserSandboxResolver resolver = mock(UserSandboxResolver.class);
    private final UserService users = mock(UserService.class);
    private final Guest guest = new Guest();
    private WecomCliExecution execution;

    @BeforeEach void setUp() {
        when(gateway.isRemote()).thenReturn(true);
        Users user = new Users();
        user.setUserCode("account-code");
        when(users.findById(101L)).thenReturn(user);
        when(resolver.resolve("account-code")).thenReturn(context("sandbox-a"));
        execution = new WecomCliExecution(local, workspaces, gateway, resolver, guest, users);
    }

    @Test void bindsCommandsAndEnvironmentToTheResolvedUserSandbox() {
        WecomCliExecution.Context bound = execution.resolve(101L);
        when(resolver.resolve("account-code")).thenReturn(context("sandbox-b"));
        guest.result = new SandboxCommandResult(0, "authorized\n", "", false, false);
        assertEquals("authorized\n", bound.run(STATUS, Duration.ofSeconds(7)).output());
        SandboxCommandRequest request = guest.requests.getLast();
        assertEquals(STATUS, request.argv().subList(5, request.argv().size()));
        assertEquals(Duration.ofSeconds(7), request.timeout());
        assertEquals(Map.of("HOME", "/by/.connector-auth/.wecom-cli", "WECOM_HOME", "/by/.connector-auth/.wecom-cli",
            "WECOM_CLI_CONFIG_DIR", "/by/.connector-auth/.wecom-cli/.config/wecom", "WECOM_CLI_ACCESS_TOKEN", ""),
            request.environment());
        assertTrue(guest.targets.stream().allMatch("sandbox-a"::equals));
        verifyNoInteractions(local, workspaces);
    }

    @Test void legacyModeKeepsTheLocalWorkspaceAndDoesNotResolveASandbox() {
        when(gateway.isRemote()).thenReturn(false);
        when(workspaces.resolve(101L, "wecom-cli")).thenReturn(
            new ConnectorCredentialWorkspaceService.ConnectorCliWorkspace(root, Map.of("HOME", root.toString())));
        when(local.run(eq(STATUS), anyMap(), isNull(), eq(Duration.ofSeconds(3))))
            .thenReturn(new ConnectorCliRunner.CliResult(0, "authorized"));
        assertEquals("authorized", execution.resolve(101L).run(STATUS, Duration.ofSeconds(3)).output());
        verifyNoInteractions(resolver, users);
        assertTrue(guest.requests.isEmpty());
    }

    @Test void missingUsersAndMismatchedSandboxOwnersFailClosed() {
        assertThrows(IllegalStateException.class, () -> execution.resolve(102L));
        when(resolver.resolve("account-code")).thenReturn(
            new UserSandboxResolver.UserSandboxContext("other", "another-user", null, null));
        assertThrows(IllegalStateException.class, () -> execution.resolve(101L));
        verifyNoInteractions(local, workspaces);
        assertTrue(guest.requests.isEmpty());
    }

    @Test void remoteFailureDoesNotFallBackToLocalAuthorization() {
        when(resolver.resolve("account-code")).thenThrow(new IllegalStateException("unavailable"));
        assertThrows(IllegalStateException.class, () -> execution.resolve(101L));
        verifyNoInteractions(local, workspaces);
    }

    @Test void timeoutAndOversizedResponsesCannotBecomeSuccessfulCliResults() {
        WecomCliExecution.Context bound = execution.resolve(101L);
        guest.result = new SandboxCommandResult(0, "authorized", "", false, true);
        assertEquals(124, bound.run(STATUS, Duration.ofSeconds(1)).exitCode());
        guest.result = new SandboxCommandResult(0, "x".repeat(65537), "", false, false);
        assertTrue(bound.run(STATUS, Duration.ofSeconds(1)).truncated());
    }

    @Test void statusKeepsStderrSoAWarningCannotBeHiddenAsAuthorized() {
        WecomCliExecution.Context bound = execution.resolve(101L);
        guest.result = new SandboxCommandResult(0, "authorized", "invalid credential", false, false);
        assertEquals("authorizedinvalid credential", bound.run(STATUS, Duration.ofSeconds(1)).output());
    }

    @Test void asynchronousExecutionKeepsItsDeadlineAndDrainsTerminalOutput() throws Exception {
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "first\n", 6, false));
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "最后\n", 13, false));
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 13, false));
        ManagedProcess process = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        assertEquals(Duration.ofSeconds(120), guest.requests.getLast().timeout());
        assertTrue(guest.requests.getLast().background());
        assertTrue(process.isAlive());
        assertEquals("first\n", process.output());
        guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 0, false);
        Thread.sleep(120);
        assertFalse(process.isAlive());
        assertFalse(process.outputComplete());
        Thread.sleep(120);
        assertTrue(process.outputComplete());
        assertEquals("first\n最后\n", process.output());
        assertEquals(0, process.exitCode());
        assertEquals(List.of(0L, 6L, 13L), guest.cursors);
    }

    @Test void lostOrFailedProcessesNeverReportSuccessfulExit() {
        guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.NOT_FOUND, null, "", 0, false);
        ManagedProcess missing = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        assertFalse(missing.isAlive());
        assertTrue(missing.outputComplete());
        assertNotEquals(0, missing.exitCode());
        guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.FAILED, 0, "", 0, false);
        ManagedProcess failed = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        assertFalse(failed.isAlive());
        assertNotEquals(0, failed.exitCode());
    }

    @Test void malformedCursorsAndTruncatedOutputFailClosed() {
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "duplicate", 0, false));
        ManagedProcess bad = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        assertThrows(IllegalStateException.class, bad::output);
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "x".repeat(65537), 65537, false));
        ManagedProcess oversized = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        assertTrue(oversized.outputTruncated());
        assertEquals(65536, oversized.output().length());
    }

    @Test void cancellationUsesTheOriginalHandleOnce() {
        ManagedProcess process = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        when(resolver.resolve("account-code")).thenReturn(context("sandbox-b"));
        process.destroy();
        process.destroy();
        assertEquals(List.of("sandbox-a/process-1"), guest.terminated);
    }

    @Test void cancellationRetriesTransientFailuresAndRetainsRetryabilityAfterAnOutage() {
        ManagedProcess process = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        guest.terminationFailures = 1;
        assertDoesNotThrow(process::destroy);
        assertEquals(2, guest.terminated.size());
        process.destroy();
        assertEquals(2, guest.terminated.size());

        ManagedProcess another = execution.resolve(101L).start(INIT, Duration.ofSeconds(120));
        guest.terminationFailures = 3;
        assertThrows(IllegalStateException.class, another::destroy);
        assertEquals(5, guest.terminated.size());
        assertDoesNotThrow(another::destroy);
        assertEquals(6, guest.terminated.size());
    }

    @Test void providerCompletionProbesTheOriginalSandboxAfterRoutingChanges() throws Exception {
        WecomCliAuthorizationProvider provider = new WecomCliAuthorizationProvider(
            local, workspaces, new ObjectMapper(), null, execution);
        try {
            AuthorizationSessionContext session = start(provider);
            when(resolver.resolve("account-code")).thenReturn(context("sandbox-b"));
            guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 0, false);
            guest.result = new SandboxCommandResult(0, "authorized", "", false, false);
            Thread.sleep(120);
            assertEquals(AuthorizationStatus.CONNECTED, provider.queryStatus(session).status());
            assertTrue(guest.targets.stream().allMatch("sandbox-a"::equals));
            assertTrue(guest.requests.stream().anyMatch(request -> request.argv().size() > 5 && request.argv().subList(5, request.argv().size()).equals(STATUS)));
            verify(resolver, times(1)).resolve("account-code");
            verifyNoInteractions(local, workspaces);
        } finally { provider.shutdown(); }
    }

    @Test void providerCancellationPreventsALateSuccessfulRemoteProbe() throws Exception {
        WecomCliAuthorizationProvider provider = new WecomCliAuthorizationProvider(
            local, workspaces, new ObjectMapper(), null, execution);
        try {
            AuthorizationSessionContext session = start(provider);
            provider.cancel(session);
            guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 0, false);
            guest.result = new SandboxCommandResult(0, "authorized", "", false, false);
            assertEquals(AuthorizationStatus.FAILED, provider.queryStatus(session).status());
            assertFalse(guest.requests.stream().anyMatch(request -> request.argv().size() > 5 && request.argv().subList(5, request.argv().size()).equals(STATUS)));
            assertEquals(List.of("sandbox-a/process-1"), guest.terminated);
        } finally { provider.shutdown(); }
    }

    @Test void providerDoesNotProbeOldCredentialsWhenRemoteInitializationFails() throws Exception {
        WecomCliAuthorizationProvider provider = new WecomCliAuthorizationProvider(
            local, workspaces, new ObjectMapper(), null, execution);
        try {
            AuthorizationSessionContext session = start(provider);
            guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.EXITED, 1, "", 0, false);
            guest.result = new SandboxCommandResult(0, "authorized", "", false, false);
            Thread.sleep(120);
            assertEquals(AuthorizationStatus.FAILED, provider.queryStatus(session).status());
            assertFalse(guest.requests.stream().anyMatch(request -> request.argv().size() > 5 && request.argv().subList(5, request.argv().size()).equals(STATUS)));
        } finally { provider.shutdown(); }
    }

    @Test void providerClassifiesRemoteCliIncompatibilityAfterDrainingItsTerminalOutput() {
        String diagnostic = "error: unrecognized subcommand 'init'\n\nUsage: wecom-cli auth <COMMAND>\n";
        guest.status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.FAILED, 2, "", 0, false);
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
            diagnostic, diagnostic.length(), false));
        WecomCliAuthorizationProvider provider = new WecomCliAuthorizationProvider(
            local, workspaces, new ObjectMapper(), null, execution);
        try {
            ManifestCommandCatalog catalog = new ManifestCommandCatalog(Map.of(
                "login", List.of(INIT), "status", List.of(STATUS),
                "logout", List.of(List.of("wecom-cli", "cache", "clear"))), "test", Map.of());

            AuthorizationStartResult result = provider.start(new AuthorizationStartContext(
                "auth-incompatible", "101", 1L, "wecom", "wecom-cli", null,
                Map.of("authorizationTimeoutSeconds", 120), catalog));

            assertEquals(AuthorizationStatus.FAILED, result.status());
            assertEquals("PROVIDER_CLI_INCOMPATIBLE", result.errorCode());
            assertNull(result.authorizationUrl());
            assertEquals(List.of(0L, (long) diagnostic.length()), guest.cursors);
            assertEquals(List.of("sandbox-a/process-1"), guest.terminated);
            assertFalse(guest.requests.stream().anyMatch(request -> request.argv().size() > 5
                && request.argv().subList(5, request.argv().size()).equals(STATUS)));
            verifyNoInteractions(local, workspaces);
        } finally { provider.shutdown(); }
    }

    private AuthorizationSessionContext start(WecomCliAuthorizationProvider provider) {
        String url = "https://work.weixin.qq.com/ai/qc/gen?scode=test";
        guest.logs.add(new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null,
            "请打开二维码链接扫码: " + url + "\n", 100, false));
        ManifestCommandCatalog catalog = new ManifestCommandCatalog(Map.of(
            "login", List.of(INIT), "status", List.of(STATUS),
            "logout", List.of(List.of("wecom-cli", "cache", "clear"))), "test", Map.of());
        AuthorizationStartResult started = provider.start(new AuthorizationStartContext(
            "auth-1", "101", 1L, "wecom", "wecom-cli", null,
            Map.of("authorizationTimeoutSeconds", 120), catalog));
        assertEquals(AuthorizationStatus.PENDING, started.status());
        assertEquals(url, started.authorizationUrl());
        return new AuthorizationSessionContext("auth-1", "101", 1L, "wecom", "wecom-cli",
            started.providerSessionId(), started.providerState(), started.expiresAt(), catalog);
    }

    @Test void guestRevocationDeletesOnlyCredentialsAndDoesNotFollowPrivateSymlinks() throws Exception {
        guest.directoryRoot = root;
        WecomCliExecution.Context bound = execution.resolve(101L);
        Path config = root.resolve(".connector-auth/.wecom-cli/.config/wecom");
        for (String name : List.of("bot.enc", "token.enc", "credentials.enc", ".encryption_key", "config.json")) {
            Files.writeString(config.resolve(name), "fixture");
        }
        Path outside = root.resolve("outside");
        Files.writeString(outside, "untouched");
        Files.delete(config.resolve("credentials.enc"));
        Files.createSymbolicLink(config.resolve("credentials.enc"), outside);
        assertThrows(IllegalStateException.class, bound::removeCredentials);
        assertEquals("untouched", Files.readString(outside));
        Files.delete(config.resolve("credentials.enc"));
        bound.removeCredentials();
        assertFalse(Files.exists(config.resolve("bot.enc")));
        assertFalse(Files.exists(config.resolve("token.enc")));
        assertFalse(Files.isSymbolicLink(config.resolve("credentials.enc")));
        assertEquals("untouched", Files.readString(outside));
        assertTrue(Files.exists(config.resolve(".encryption_key")));
        assertTrue(Files.exists(config.resolve("config.json")));
        Files.move(config, config.resolveSibling("preserved"));
        Files.createSymbolicLink(config, config.resolveSibling("preserved"));
        assertThrows(IllegalStateException.class, bound::removeCredentials);
        assertTrue(Files.exists(config.resolveSibling("preserved/.encryption_key")));
    }

    private UserSandboxResolver.UserSandboxContext context(String id) {
        return new UserSandboxResolver.UserSandboxContext(id, "account-code", null, null);
    }

    private static final class Guest implements SandboxCommandExecutor {
        final List<SandboxCommandRequest> requests = new ArrayList<>();
        final List<String> targets = new ArrayList<>();
        final List<Long> cursors = new ArrayList<>();
        final List<SandboxProcessSnapshot> logs = new ArrayList<>();
        final List<String> terminated = new ArrayList<>();
        SandboxCommandResult result = new SandboxCommandResult(0, "", "", false, false);
        SandboxProcessSnapshot status = new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 0, false);
        Path directoryRoot;
        int terminationFailures;

        @Override public SandboxCommandResult run(String id, SandboxCommandRequest request) {
            targets.add(id);
            requests.add(request);
            if (request.argv().getFirst().equals("python3") && !request.argv().get(4).equals("run")) {
                if (directoryRoot != null) {
                    try {
                        String script = request.argv().get(2).replace("'/by'", "'" + directoryRoot + "'");
                        ProcessBuilder builder = new ProcessBuilder("python3", "-c", script, request.argv().get(3), request.argv().get(4))
                            .redirectErrorStream(true);
                        request.environment().forEach((key, value) -> builder.environment().put(key, value.replace("/by/", directoryRoot + "/")));
                        Process process = builder.start();
                        String output = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
                        return new SandboxCommandResult(process.waitFor(), output, "", false, false);
                    } catch (Exception failure) { throw new AssertionError(failure); }
                }
                return new SandboxCommandResult(0, "", "", false, false);
            }
            return result;
        }
        @Override public SandboxProcessHandle start(String id, SandboxCommandRequest request) {
            targets.add(id);
            requests.add(request);
            return new SandboxProcessHandle(id, "process-1", Instant.now());
        }
        @Override public SandboxProcessSnapshot inspect(String id, String process) { targets.add(id); return status; }
        @Override public SandboxProcessSnapshot readOutput(String id, String process, long cursor) {
            targets.add(id);
            cursors.add(cursor);
            return logs.isEmpty() ? new SandboxProcessSnapshot(SandboxProcessSnapshot.State.RUNNING, null, "", cursor, false)
                : logs.removeFirst();
        }
        @Override public void terminate(String id, String process) {
            terminated.add(id + "/" + process);
            if (terminationFailures-- > 0) throw new IllegalStateException("transport unavailable");
        }
    }
}
