package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialProjectionEvent;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;

class MailAccountProjectionServiceTest {
    @TempDir Path directory;
    final ObjectMapper json = new ObjectMapper();
    final MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
    final MailCredentialResolver resolver = mock(MailCredentialResolver.class);
    final MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
    final MailAccountMetadataCacheService cache = mock(MailAccountMetadataCacheService.class);
    final MailAccountProjectionLeaseService.Lease owner = new MailAccountProjectionLeaseService.Lease(1001L, "owner");
    UserMailAccount qq;
    UserMailAccount gmail;

    @BeforeEach
    void setup() throws Exception {
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
        qq = account(1L, "qq", "APP_PASSWORD");
        gmail = account(2L, "gmail", "OAUTH2");
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(qq, gmail));
        when(state.loadAllAccountIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(state.connectorCode(1L)).thenReturn("qq-mail");
        when(state.connectorCode(2L)).thenReturn("gmail-mail");
        when(state.findActiveConnector(anyString())).thenAnswer(call -> {
            String code = call.getArgument(0);
            var connector = new ConnectorInfo();
            connector.setConnectorCode(code);
            connector.setConnectorId(switch(code) {
                case "qq-mail" -> 1L;
                case "gmail-mail" -> 2L;
                case "netease-163-mail" -> 3L;
                default -> 4L;
            });
            connector.setStatusCd("00A");
            return connector;
        });
        when(resolver.resolve(any())).thenAnswer(call -> Optional.of(
            MailCredentialResolver.ResolvedAuth.secret("APP_PASSWORD", "fixture@example.invalid", "test-only-secret")));
        when(lease.tryAcquire(1001L)).thenReturn(Optional.of(owner));
        when(lease.generation(1001L)).thenReturn(1L);
    }

    @Test
    void ordinaryTargetedSyncDoesNotReconcileAwayLatestConnectionCheck() {
        gmail.setStatus("AUTH_REQUIRED");
        service().sync(1001L, Set.of(2L));
        verify(state, never()).reconcileCurrentBinding(anyLong(), anyLong());
        assertThat(gmail.getStatus()).isEqualTo("AUTH_REQUIRED");
    }

    @Test
    void brokenBindingReconciliationDoesNotBlockRevocationCleanupOrHealthyWrite() throws Exception {
        privateFile("netease-163-mail.json", "revoked");
        privateFile("accounts.json", "obsolete");
        when(state.reconcileCurrentBinding(1001L, 2L)).thenThrow(new IllegalStateException("fixture"));
        service().sync(1001L);
        assertThat(file("qq-mail")).exists();
        assertThat(file("gmail-mail")).doesNotExist();
        assertThat(file("netease-163-mail")).doesNotExist();
        assertThat(directory.resolve("accounts.json")).doesNotExist();
        verify(state).markProjectionFailed(1001L, Set.of(2L));
        verify(lease, never()).markClean(anyLong(), anyLong());
    }

    @Test
    void invalidPrivateParameterIsRemovedAndRetainedForRetryWithoutBlockingHealthyAccount() throws Exception {
        privateFile("qq-mail.json", "old revoked credential");
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(gmail));
        when(state.invalidProjectionIds(1001L)).thenReturn(Set.of(1L));
        service().sync(1001L);
        assertThat(file("qq-mail")).doesNotExist();
        assertThat(file("gmail-mail")).exists();
        verify(state).markProjectionFailed(1001L, Set.of(1L));
        verify(state).markProjectionSucceeded(1001L, Set.of(2L));
        verify(lease, never()).markClean(anyLong(), anyLong());
    }

    @Test
    void serializesAllFourRecognizedConnectorsWithoutAggregateOrDefaultFields() throws Exception {
        var netease = account(3L, "netease-163", "APP_PASSWORD");
        var custom = account(4L, "custom-imap", "APP_PASSWORD");
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(qq, gmail, netease, custom));
        service().sync(1001L);
        for (String code : List.of("qq-mail", "gmail-mail", "netease-163-mail", "custom-imap-mail")) {
            var root = json.readTree(file(code).toFile());
            assertThat(root.path("schemaVersion").asInt()).isEqualTo(2);
            assertThat(root.path("connectorCode").asText()).isEqualTo(code);
            assertThat(root.size()).isEqualTo(3);
            assertThat(root.path("account").has("default")).isFalse();
            assertThat(root.path("account").path("locatorKey").asText()).matches("[A-Za-z0-9_-]{43}");
            assertThat(Files.getPosixFilePermissions(file(code))).isEqualTo(PosixFilePermissions.fromString("rw-------"));
        }
        assertThat(directory.resolve("accounts.json")).doesNotExist();
    }

    @Test
    void revocationDeletesOnlyAffectedFileBeforeAttemptingOtherCredentials() throws Exception {
        service().sync(1001L);
        byte[] unchanged = Files.readAllBytes(file("gmail-mail"));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(gmail));
        clearInvocations(resolver);
        service().sync(1001L, Set.of(1L));
        assertThat(file("qq-mail")).doesNotExist();
        assertThat(Files.readAllBytes(file("gmail-mail"))).isEqualTo(unchanged);
        verifyNoInteractions(resolver);
    }

    @Test
    void reconciliationRemovesObsoleteAndUnavailableFilesEvenWhenOneCredentialFails() throws Exception {
        privateFile("accounts.json", "not parsed");
        privateFile("fastmail-mail.json", "obsolete");
        privateFile("netease-163-mail.json", "revoked");
        when(resolver.resolve(qq)).thenThrow(new MailCredentialResolutionException(
            MailCredentialResolutionException.Code.CORRUPT_CREDENTIAL, new IllegalStateException("fixture")));
        service().sync(1001L);
        assertThat(directory.resolve("accounts.json")).doesNotExist();
        assertThat(file("fastmail-mail")).doesNotExist();
        assertThat(file("netease-163-mail")).doesNotExist();
        assertThat(file("gmail-mail")).exists();
        verify(state).markProjectionFailed(1001L, Set.of(1L));
        verify(state).markProjectionSucceeded(1001L, Set.of(2L));
        verify(lease, never()).markClean(anyLong(), anyLong());
    }

    @Test
    void unavailableOrUnauthorizedConnectorIsRemoved() throws Exception {
        service().sync(1001L);
        when(state.findActiveConnector("qq-mail")).thenReturn(null);
        when(resolver.resolve(gmail)).thenReturn(Optional.empty());
        service().sync(1001L);
        assertThat(file("qq-mail")).doesNotExist();
        assertThat(file("gmail-mail")).doesNotExist();
    }

    @Test
    void unchangedAccountRetainsKeyButReplacementRotatesIt() throws Exception {
        service().sync(1001L);
        String key = key("qq-mail");
        qq.setEmail(" FIXTURE@EXAMPLE.INVALID ");
        service().sync(1001L, Set.of(1L));
        assertThat(key("qq-mail")).isEqualTo(key);
        qq.setEmail("replacement@example.invalid");
        service().sync(1001L, Set.of(1L));
        assertThat(key("qq-mail")).isNotEqualTo(key);
    }

    @Test
    void independentWriteFailurePreservesOldFileAndOtherConnectorSucceeds() throws Exception {
        service().sync(1001L);
        byte[] old = Files.readAllBytes(file("qq-mail"));
        clearInvocations(state, lease);
        var operations = new TestMailFileOperations() {
            @Override protected void beforeMove(Path directory, MailAccountProjectionService.OpenedPrivateFile source,
                    Path target) throws IOException {
                if (target.toString().equals("qq-mail.json")) throw new IOException("fixture failure");
            }
        };
        service(operations).sync(1001L);
        assertThat(Files.readAllBytes(file("qq-mail"))).isEqualTo(old);
        assertThat(file("gmail-mail")).exists();
        verify(state).markProjectionFailed(1001L, Set.of(1L));
        verify(state).markProjectionSucceeded(1001L, Set.of(2L));
        verify(lease, never()).markClean(anyLong(), anyLong());
        noTemps();
    }

    @Test
    void successStatusIsOnlyWrittenAfterVisibleCompleteProjection() throws Exception {
        doAnswer(call -> {
            for (Long id : (Set<Long>) call.getArgument(1)) {
                var root = json.readTree(file(id == 1L ? "qq-mail" : "gmail-mail").toFile());
                assertThat(root.path("account").path("accountId").asText()).isEqualTo(id.toString());
            }
            return Set.of();
        }).when(state).markProjectionSucceeded(anyLong(), anySet());
        service().sync(1001L);
        verify(state).markProjectionSucceeded(1001L, Set.of(1L, 2L));
    }

    @Test
    void insecureRecognizedTargetFailsClosedWithoutTouchingExternalFile() throws Exception {
        Path external = Files.writeString(directory.resolve("external"), "keep");
        Files.createSymbolicLink(file("qq-mail"), external);
        service().sync(1001L);
        assertThat(Files.readString(external)).isEqualTo("keep");
        assertThat(Files.isSymbolicLink(file("qq-mail"))).isTrue();
        assertThat(file("gmail-mail")).exists();
        verify(state).markProjectionFailed(1001L, Set.of(1L));
    }

    @Test
    void insecureDeletionIsRejected() throws Exception {
        privateFile("qq-mail.json", "private");
        Files.setPosixFilePermissions(file("qq-mail"), PosixFilePermissions.fromString("rw-r--r--"));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(gmail));
        service().sync(1001L, Set.of(1L));
        assertThat(file("qq-mail")).exists();
        verify(lease, never()).markClean(anyLong(), anyLong());
    }

    @Test
    void shortWritesProduceCompleteDocumentAndZeroWritesFail() throws Exception {
        service(new TestMailFileOperations((channel, buffer) -> writeAtMost(channel, buffer, 3))).sync(1001L);
        assertThat(json.readTree(file("qq-mail").toFile()).path("schemaVersion").asInt()).isEqualTo(2);
        byte[] old = Files.readAllBytes(file("qq-mail"));
        service(new TestMailFileOperations((channel, buffer) -> 0)).sync(1001L);
        assertThat(Files.readAllBytes(file("qq-mail"))).isEqualTo(old);
        verify(state).markProjectionFailed(1001L, Set.of(1L, 2L));
        noTemps();
    }

    @Test
    void oversizedAccountDoesNotPreventOtherProjection() throws Exception {
        qq.setDisplayName("x".repeat(65536));
        service().sync(1001L);
        assertThat(file("qq-mail")).doesNotExist();
        assertThat(file("gmail-mail")).exists();
        verify(state).markProjectionFailed(1001L, Set.of(1L));
    }

    @Test
    void targetSwapBeforeRenameCannotReplaceExternalFile() throws Exception {
        Path external = Files.writeString(directory.resolve("external"), "keep");
        var operations = new TestMailFileOperations() {
            @Override protected void beforeMove(Path directory, MailAccountProjectionService.OpenedPrivateFile source,
                    Path target) throws IOException {
                if (target.toString().equals("qq-mail.json")) Files.createSymbolicLink(directory.resolve(target), external);
            }
        };
        service(operations).sync(1001L);
        assertThat(Files.readString(external)).isEqualTo("keep");
        verify(state).markProjectionFailed(1001L, Set.of(1L));
    }

    @Test
    void insecureParentFailsClosed() throws Exception {
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwxr-xr-x"));
        assertThatThrownBy(() -> service().sync(1001L)).isInstanceOf(IllegalStateException.class);
        assertThat(file("qq-mail")).doesNotExist();
        verify(lease).release(owner);
    }

    @Test
    void unsupportedFilesystemKeepsDirtyAndMarksFailure() throws Exception {
        assertThatThrownBy(() -> service((path, identity) -> {
            throw new IOException("unsupported");
        }).sync(1001L)).isInstanceOf(IllegalStateException.class);
        verify(state).markProjectionFailed(1001L, Set.of(1L, 2L));
        verify(lease, never()).markClean(anyLong(), anyLong());
    }

    @Test
    void leaseLossNeverWritesOrCleans() throws Exception {
        doThrow(new MailAccountProjectionLeaseService.LeaseLostException()).when(lease).assertOwnedAndRenew(owner);
        assertThatThrownBy(() -> service().sync(1001L))
            .isInstanceOf(MailAccountProjectionLeaseService.LeaseLostException.class);
        assertThat(file("qq-mail")).doesNotExist();
        verify(lease, never()).markClean(anyLong(), anyLong());
        verify(lease).release(owner);
    }

    @Test
    void busyLeaseOnlyTriggersRetry() throws Exception {
        when(lease.tryAcquire(1001L)).thenReturn(Optional.empty());
        service().sync(1001L);
        verify(lease).trigger(1001L);
        verifyNoInteractions(state, resolver);
    }

    @Test
    void databaseSweepRepairsWithoutDirtyRedisState() throws Exception {
        when(lease.dirtyUsers(100)).thenReturn(Set.of());
        when(state.scanProjectionUsersAfter(0L, 100)).thenReturn(
            new MailAccountProjectionStateService.ProjectionUserBatch(Set.of(1001L), 2L, false));
        service().reconcileDirtyUsers();
        assertThat(file("qq-mail")).exists();
        assertThat(file("gmail-mail")).exists();
    }

    @Test
    void connectorEventProjectsOnlyItsConnector() throws Exception {
        when(state.recognizesMailConnector(1L)).thenReturn(true);
        service().handle(new ConnectorCredentialProjectionEvent(1001L, 1L,
            ConnectorCredentialProjectionEvent.Action.SYNC));
        assertThat(file("qq-mail")).exists();
        assertThat(file("gmail-mail")).doesNotExist();
        verify(resolver, never()).resolve(gmail);
    }

    @Test
    void statusUpdateFailureDoesNotMarkClean() throws Exception {
        doThrow(new IllegalStateException("fixture")).when(state).markProjectionSucceeded(anyLong(), anySet());
        assertThatThrownBy(() -> service().sync(1001L)).isInstanceOf(IllegalStateException.class);
        verify(lease, never()).markClean(anyLong(), anyLong());
    }

    private MailAccountProjectionService service() { return service(new TestMailFileOperations()); }
    private MailAccountProjectionService service(MailAccountProjectionService.FileOperations operations) {
        var workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(1001L, MailAccountProjectionService.PROJECTION_PATH))
            .thenReturn(file("qq-mail"));
        return new MailAccountProjectionService(workspace, resolver, state, lease, cache, json, operations);
    }
    private Path file(String code) { return directory.resolve(code + ".json"); }
    private void privateFile(String name, String content) throws Exception {
        Path path = Files.writeString(directory.resolve(name), content);
        Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
    }
    private String key(String code) throws Exception {
        return json.readTree(file(code).toFile()).path("account").path("locatorKey").asText();
    }
    private void noTemps() throws Exception {
        try (var files = Files.list(directory)) {
            assertThat(files.filter(path -> path.getFileName().toString().endsWith(".tmp")).toList()).isEmpty();
        }
    }
    private static int writeAtMost(FileChannel channel, ByteBuffer buffer, int maximum) throws IOException {
        int limit = buffer.limit();
        buffer.limit(Math.min(limit, buffer.position() + maximum));
        try { return channel.write(buffer); } finally { buffer.limit(limit); }
    }
    private UserMailAccount account(Long id, String provider, String type) {
        var account = new UserMailAccount();
        account.setAccountId(id); account.setConnectorId(id); account.setUserId(1001L);
        account.setEmail("fixture@example.invalid"); account.setProviderCode(provider); account.setAuthType(type);
        account.setStatus("NORMAL"); account.setDeleteFlag("0");
        return account;
    }
}
