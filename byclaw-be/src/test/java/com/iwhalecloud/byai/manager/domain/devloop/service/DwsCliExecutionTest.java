package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.gateway.sandbox.command.*;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.gateway.sandbox.service.UserSandboxResolver;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.ManagedProcess;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;

class DwsCliExecutionTest {
    static final List<String> STATUS = List.of("dws", "auth", "status", "--format", "json");
    static final List<String> LOGIN = List.of("dws", "auth", "login", "--device");
    static final List<String> RESET = List.of("dws", "auth", "reset", "-y");
    final PlatformRemoteGateway gateway = mock(PlatformRemoteGateway.class);
    final UserSandboxResolver resolver = mock(UserSandboxResolver.class);
    final UserService users = mock(UserService.class);
    final Guest guest = new Guest();
    DwsCliExecution execution;

    @BeforeEach void setUp() {
        when(gateway.isRemote()).thenReturn(true);
        Users user = new Users();
        user.setUserCode("account-code");
        when(users.findById(42L)).thenReturn(user);
        when(resolver.resolve("account-code")).thenReturn(context("sandbox-a"));
        execution = new DwsCliExecution(gateway, resolver, guest, users);
    }

    @Test void routesTheRealUserCodeAndPinsEnvironmentAndSandbox() {
        DwsCliExecution.Context bound = execution.resolve(42L);
        when(resolver.resolve("account-code")).thenReturn(context("sandbox-b"));
        guest.result = new SandboxCommandResult(0, "authorized", "", false, false);
        assertEquals("authorized", bound.run(STATUS, Duration.ofSeconds(7), 1024).output());
        SandboxCommandRequest request = guest.requests.getLast();
        assertEquals(STATUS, request.argv().subList(5, request.argv().size()));
        assertEquals(Duration.ofSeconds(7), request.timeout());
        assertEquals(1024, request.maxOutputBytes());
        assertFalse(request.background());
        assertEquals(Map.of("HOME", "/by/.connector-auth/.dws", "DWS_HOME", "/by/.connector-auth/.dws",
            "DWS_CONFIG_DIR", "/by/.connector-auth/.dws/config", "DWS_DISABLE_KEYCHAIN", "1",
            "DWS_CLIENT_ID", "", "DWS_CLIENT_SECRET", ""), request.environment());
        assertEquals(List.of("sandbox-a"), guest.targets);
        verify(resolver).resolve("account-code");
        verify(resolver, never()).resolve("42");
    }

    @Test void absentUserCodeWrongOwnerAndUnavailableSandboxFailClosed() {
        assertThrows(DwsCliExecution.WorkspaceUnavailableException.class, () -> execution.resolve(99L));
        when(resolver.resolve("account-code")).thenReturn(
            new UserSandboxResolver.UserSandboxContext("sandbox-a", "another-user", null, null));
        assertThrows(DwsCliExecution.WorkspaceUnavailableException.class, () -> execution.resolve(42L));
        when(resolver.resolve("account-code")).thenThrow(new IllegalStateException("unavailable"));
        assertThrows(DwsCliExecution.WorkspaceUnavailableException.class, () -> execution.resolve(42L));
        assertTrue(guest.requests.isEmpty());
    }

    @Test void preservesSandboxFailureCauseWithoutExposingDetailsInWorkspaceMessage() {
        IllegalStateException platformFailure = new IllegalStateException(
            "Tool sandbox requires request-scoped SSH bootstrap keys: private-platform-detail");
        when(resolver.resolve("account-code")).thenThrow(platformFailure);

        DwsCliExecution.WorkspaceUnavailableException failure = assertThrows(
            DwsCliExecution.WorkspaceUnavailableException.class, () -> execution.resolve(42L));

        assertEquals("Unable to resolve DWS credential workspace", failure.getMessage());
        assertSame(platformFailure, failure.getCause());
        assertTrue(guest.requests.isEmpty());
    }

    @Test void boundsOutputAndPreservesTimeoutFailureAndStderr() {
        DwsCliExecution.Context bound = execution.resolve(42L);
        guest.result = new SandboxCommandResult(0, "authorized", "warning", false, false);
        assertEquals("authorizedwarning", bound.run(STATUS, Duration.ofSeconds(1), 1024).output());
        guest.result = new SandboxCommandResult(0, "authorized", "", false, true);
        assertEquals(124, bound.run(STATUS, Duration.ofSeconds(1), 1024).exitCode());
        guest.result = new SandboxCommandResult(0, "x".repeat(70000), "", false, false);
        assertTrue(bound.run(STATUS, Duration.ofSeconds(1), 65536).truncated());
        assertEquals("", bound.run(STATUS, Duration.ofSeconds(1), 65536).output());
        assertEquals(70000, bound.run(STATUS, Duration.ofSeconds(1), 1024 * 1024).output().length());
        guest.result = new SandboxCommandResult(1, "unauthorized", "", false, false);
        assertEquals(1, bound.run(STATUS, Duration.ofSeconds(1), 1024).exitCode());
    }

    @Test void rejectsInvalidRequestsBeforeStartingACommand() {
        DwsCliExecution.Context bound = execution.resolve(42L);
        assertThrows(IllegalArgumentException.class, () -> bound.run(List.of(), Duration.ofSeconds(1), 1));
        assertThrows(IllegalArgumentException.class, () -> bound.run(STATUS, Duration.ZERO, 1));
        assertThrows(IllegalArgumentException.class, () -> bound.run(STATUS, Duration.ofSeconds(1), 0));
        assertThrows(IllegalArgumentException.class, () -> bound.run(STATUS, Duration.ofSeconds(1), 16 * 1024 * 1024 + 1));
        assertTrue(guest.requests.isEmpty());
    }

    @Test void backgroundProcessesKeepTimeoutAndDrainTerminalOutputByCursor() throws Exception {
        guest.logs.add(snapshot(SandboxProcessSnapshot.State.RUNNING, null, "first\n", 6));
        guest.logs.add(snapshot(SandboxProcessSnapshot.State.EXITED, 0, "最后\n", 13));
        guest.logs.add(snapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 13));
        ManagedProcess process = execution.resolve(42L).start(LOGIN, Duration.ofSeconds(900));
        assertEquals(Duration.ofSeconds(900), guest.requests.getLast().timeout());
        assertTrue(guest.requests.getLast().background());
        assertEquals("first\n", process.output());
        guest.status = snapshot(SandboxProcessSnapshot.State.EXITED, 0, "", 0);
        Thread.sleep(120);
        assertFalse(process.isAlive());
        assertFalse(process.outputComplete());
        Thread.sleep(120);
        assertTrue(process.outputComplete());
        assertEquals("first\n最后\n", process.output());
        assertEquals(0, process.exitCode());
        assertEquals(List.of(0L, 6L, 13L), guest.cursors);
    }

    @Test void missingProcessesBadCursorsAndTruncatedOutputCannotBecomeSuccessful() {
        guest.status = snapshot(SandboxProcessSnapshot.State.NOT_FOUND, null, "", 0);
        ManagedProcess missing = execution.resolve(42L).start(LOGIN, Duration.ofSeconds(900));
        assertFalse(missing.isAlive());
        assertTrue(missing.outputComplete());
        assertEquals(-1, missing.exitCode());
        guest.status = snapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 0);
        guest.logs.add(snapshot(SandboxProcessSnapshot.State.RUNNING, null, "duplicate", 0));
        ManagedProcess badCursor = execution.resolve(42L).start(LOGIN, Duration.ofSeconds(900));
        assertThrows(IllegalStateException.class, badCursor::output);
        guest.logs.add(snapshot(SandboxProcessSnapshot.State.RUNNING, null, "x".repeat(65537), 65537));
        ManagedProcess oversized = execution.resolve(42L).start(LOGIN, Duration.ofSeconds(900));
        assertTrue(oversized.outputTruncated());
        assertEquals(65536, oversized.output().length());
    }

    @Test void cancellationUsesOriginalHandleAndCanRetryAnOutage() {
        ManagedProcess process = execution.resolve(42L).start(LOGIN, Duration.ofSeconds(900));
        when(resolver.resolve("account-code")).thenReturn(context("sandbox-b"));
        guest.terminationFailures = 3;
        assertThrows(IllegalStateException.class, process::destroy);
        assertEquals(3, guest.terminated.size());
        process.destroy();
        process.destroy();
        assertEquals(4, guest.terminated.size());
        assertTrue(guest.terminated.stream().allMatch("sandbox-a/process-1"::equals));
    }

    static UserSandboxResolver.UserSandboxContext context(String id) {
        return new UserSandboxResolver.UserSandboxContext(id, "account-code", null, null);
    }

    static SandboxProcessSnapshot snapshot(SandboxProcessSnapshot.State state, Integer exit, String output, long cursor) {
        return new SandboxProcessSnapshot(state, exit, output, cursor, false);
    }

    static class Guest implements SandboxCommandExecutor {
        final List<SandboxCommandRequest> requests = new CopyOnWriteArrayList<>();
        final List<String> targets = new CopyOnWriteArrayList<>();
        final List<Long> cursors = new CopyOnWriteArrayList<>();
        final List<SandboxProcessSnapshot> logs = new ArrayList<>();
        final List<String> terminated = new CopyOnWriteArrayList<>();
        volatile SandboxCommandResult result = new SandboxCommandResult(0, "", "", false, false);
        volatile SandboxProcessSnapshot status = snapshot(SandboxProcessSnapshot.State.RUNNING, null, "", 0);
        int terminationFailures;

        @Override public SandboxCommandResult run(String id, SandboxCommandRequest request) {
            targets.add(id); requests.add(request); return result;
        }
        @Override public SandboxProcessHandle start(String id, SandboxCommandRequest request) {
            targets.add(id); requests.add(request); return new SandboxProcessHandle(id, "process-1", Instant.now());
        }
        @Override public SandboxProcessSnapshot inspect(String id, String process) { return status; }
        @Override public synchronized SandboxProcessSnapshot readOutput(String id, String process, long cursor) {
            cursors.add(cursor);
            return logs.isEmpty() ? snapshot(status.state(), status.exitCode(), "", cursor) : logs.removeFirst();
        }
        @Override public synchronized void terminate(String id, String process) {
            terminated.add(id + "/" + process);
            if (terminationFailures-- > 0) throw new IllegalStateException("transport unavailable");
        }
    }
}
