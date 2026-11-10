package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static com.iwhalecloud.byai.manager.domain.devloop.service.DwsCliExecutionTest.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.gateway.sandbox.command.SandboxCommandResult;
import com.iwhalecloud.byai.gateway.sandbox.command.SandboxProcessSnapshot;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCliRunner.CliResult;
import com.iwhalecloud.byai.manager.domain.devloop.service.DwsAuthService.DwsCredentialOutcome;

class DwsAuthServiceRemoteTest {
    @TempDir Path root;
    final DwsCliExecutionTest fixture = new DwsCliExecutionTest();
    final ConnectorCliRunner local = mock(ConnectorCliRunner.class);
    final LoginApplicationService login = mock(LoginApplicationService.class);
    final UserBucketNamingService buckets = mock(UserBucketNamingService.class);
    DwsAuthService service;

    @BeforeEach void setUp() {
        fixture.setUp();
        service = new DwsAuthService();
        ReflectionTestUtils.setField(service, "fileStorageRoot", root.resolve("old-nfs").toString());
        ReflectionTestUtils.setField(service, "connectorCliRunner", local);
        ReflectionTestUtils.setField(service, "loginApplicationService", login);
        ReflectionTestUtils.setField(service, "userBucketNamingService", buckets);
        ReflectionTestUtils.setField(service, "dwsCliExecution", fixture.execution);
    }

    @Test void oldBackendCredentialsCannotMaskAnUnauthorizedAgentWorkspace() {
        when(local.run(anyList(), anyMap(), isNull(), any()))
            .thenReturn(new CliResult(0, "{\"authenticated\":true,\"token_valid\":true}"));
        fixture.guest.result = new SandboxCommandResult(0,
            "{\"authenticated\":false,\"token_valid\":false}", "", false, false);
        assertEquals(false, service.getAuthStatus(42L, STATUS).get("authenticated"));
        assertFalse(Files.exists(root.resolve("old-nfs")));
        verifyNoInteractions(local, login, buckets);
    }

    @Test void everySynchronousOperationUsesTheAgentCredentialWorkspace() {
        fixture.guest.result = new SandboxCommandResult(0,
            "{\"authenticated\":true,\"token_valid\":true,\"corp_name\":\"corp\"}", "", false, false);
        assertEquals(true, service.getAuthStatus(42L, STATUS).get("authenticated"));
        assertEquals("corp", service.getCredentialStatus(42L, STATUS).status().get("corpName"));
        service.revokeCredential(42L, RESET);
        service.runCommand("42", List.of("dws", "contact", "list"), Duration.ofSeconds(30), 1024 * 1024);
        assertEquals(4, fixture.guest.requests.size());
        assertTrue(fixture.guest.requests.stream().allMatch(request ->
            "/by/.connector-auth/.dws".equals(request.environment().get("HOME"))));
        assertEquals(1024 * 1024, fixture.guest.requests.getLast().maxOutputBytes());
        assertFalse(Files.exists(root.resolve("old-nfs")));
        verifyNoInteractions(local, login, buckets);
    }

    @Test void missingWorkspaceAndRemoteFailureNeverFallBackToBackendFiles() {
        when(fixture.resolver.resolve("account-code")).thenThrow(new IllegalStateException("offline"));
        assertEquals(DwsCredentialOutcome.WORKSPACE_UNAVAILABLE, service.getCredentialStatus(42L, STATUS).outcome());
        assertThrows(IllegalStateException.class, () -> service.revokeCredential(42L, RESET));
        assertThrows(IllegalStateException.class, () -> service.runCommand("42", STATUS, Duration.ofSeconds(10)));
        assertFalse(service.applyUserDwsEnv(new HashMap<>(), 42L));
        assertFalse(Files.exists(root.resolve("old-nfs")));
        verifyNoInteractions(local, login, buckets);
    }

    @Test void timeoutTruncationAndFailedStatusRemainDistinctFromAuthorization() {
        fixture.guest.result = new SandboxCommandResult(0, "{}", "", false, true);
        assertEquals(DwsCredentialOutcome.TIMEOUT, service.getCredentialStatus(42L, STATUS).outcome());
        fixture.guest.result = new SandboxCommandResult(0, "{\"authenticated\":true}", "", true, false);
        assertEquals(DwsCredentialOutcome.FAILED, service.getCredentialStatus(42L, STATUS).outcome());
        fixture.guest.result = new SandboxCommandResult(1, "{\"authenticated\":true}", "", false, false);
        assertEquals(DwsCredentialOutcome.FAILED, service.getCredentialStatus(42L, STATUS).outcome());
        assertThrows(IllegalStateException.class, () -> service.revokeCredential(42L, RESET));
    }

    @Test void malformedOrUnavailableResponsesCannotConfirmAuthorization() {
        fixture.guest.result = new SandboxCommandResult(0, "{\"authenticated\":true,\"token_valid\":true}",
            "credential read failed", false, false);
        assertEquals(DwsCredentialOutcome.FAILED, service.getCredentialStatus(42L, STATUS).outcome());
        fixture.guest.result = null;
        assertEquals(DwsCredentialOutcome.FAILED, service.getCredentialStatus(42L, STATUS).outcome());
        verifyNoInteractions(local, login, buckets);
    }

    @Test void deviceLoginAndOwnerCheckedCancellationStayOnTheOriginalSandbox() {
        deviceCode("TEST-CODE");
        Map<String, Object> result = service.startDeviceAuth(42L, "auth-1", LOGIN);
        assertEquals(true, result.get("success"));
        assertEquals("TEST-CODE", result.get("userCode"));
        assertEquals(Duration.ofSeconds(900), fixture.guest.requests.getLast().timeout());
        when(fixture.resolver.resolve("account-code")).thenReturn(context("sandbox-b"));
        assertFalse(service.cancelDeviceAuth("auth-1", 99L));
        assertTrue(service.cancelDeviceAuth("auth-1", 42L));
        assertEquals(List.of("sandbox-a/process-1"), fixture.guest.terminated);
        assertFalse(service.deviceFlowRegistrations.containsKey("auth-1"));
        verifyNoInteractions(local, login, buckets);
    }

    @Test void duplicateStartDoesNotSpawnAnotherProcessAndFailedCancellationCanRetry() {
        deviceCode("TEST-CODE");
        assertEquals(true, service.startDeviceAuth(42L, "auth-1", LOGIN).get("success"));
        assertEquals(false, service.startDeviceAuth(42L, "auth-1", LOGIN).get("success"));
        assertEquals(1, fixture.guest.requests.size());
        fixture.guest.terminationFailures = 3;
        assertFalse(service.cancelDeviceAuth("auth-1", 42L));
        assertTrue(service.deviceFlowRegistrations.containsKey("auth-1"));
        assertTrue(service.cancelDeviceAuth("auth-1", 42L));
        assertFalse(service.deviceFlowRegistrations.containsKey("auth-1"));
    }

    @Test void partialUrlOutputIsNotReturnedBeforeTheCompleteLineArrives() {
        String prefix = "authorization code: TEST-CODE\nhttps://login.dingtalk.com/oauth2/device/verify.htm?user_code=TEST";
        fixture.guest.logs.add(snapshot(SandboxProcessSnapshot.State.RUNNING, null, prefix, prefix.length()));
        fixture.guest.logs.add(snapshot(SandboxProcessSnapshot.State.RUNNING, null, "-CODE\n", prefix.length() + 6));
        Map<String, Object> result = service.startDeviceAuth(42L, "auth-1", LOGIN);
        assertEquals("https://login.dingtalk.com/oauth2/device/verify.htm?user_code=TEST-CODE", result.get("verificationUrl"));
        assertTrue(service.cancelDeviceAuth("auth-1", 42L));
    }

    @Test void failedLoginWithoutADeviceCodeIsCleanedUp() {
        fixture.guest.status = snapshot(SandboxProcessSnapshot.State.EXITED, 1, "", 0);
        assertEquals(false, service.startDeviceAuth(42L, "auth-1", LOGIN).get("success"));
        assertTrue(service.deviceFlowRegistrations.isEmpty());
        assertEquals(List.of("sandbox-a/process-1"), fixture.guest.terminated);
        verifyNoInteractions(local, login, buckets);
    }

    @Test void invalidBackgroundOwnerCannotStartInSharedOrBackendHome() {
        assertThrows(IllegalStateException.class, () -> service.runCommand("not-a-user", STATUS, Duration.ofSeconds(10)));
        assertThrows(IllegalStateException.class, () -> service.runCommand("0", STATUS, Duration.ofSeconds(10)));
        assertTrue(fixture.guest.requests.isEmpty());
        verifyNoInteractions(local, login, buckets);
    }

    private void deviceCode(String code) {
        String output = "authorization code: " + code + "\nhttps://login.dingtalk.com/oauth2/device/verify.htm?user_code=" + code + "\n";
        fixture.guest.logs.add(snapshot(SandboxProcessSnapshot.State.RUNNING, null, output, output.length()));
    }
}
