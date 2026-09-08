package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.ArgumentMatchers.isNull;
import org.mockito.ArgumentCaptor;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.io.IOException;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Date;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecretStore;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialSecret;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialProjectionEvent;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.domain.connector.service.ConnectorConnectionStateService;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorAuth;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.mapper.connector.ConnectorInfoMapper;
import com.iwhalecloud.byai.manager.mapper.users.UserMailAccountMapper;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;

@DisabledOnOs(OS.WINDOWS)
class MailAccountProjectionServiceTest {
    @TempDir Path temporaryDirectory;

    @BeforeAll
    static void initializeTableMetadata() {
        if (TableInfoHelper.getTableInfo(UserMailAccount.class) == null) {
            TableInfoHelper.initTableInfo(
                new MapperBuilderAssistant(new MybatisConfiguration(), ""), UserMailAccount.class);
        }
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void writesStablePrivateProjectionWithoutRefreshOrReference() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        UserMailAccount later = account(2L, "N", new Date(2_000), "gmail", "OAUTH2");
        UserMailAccount preferred = account(1L, "Y", new Date(1_000), "qq", "APP_PASSWORD");
        when(mapper.selectList(any())).thenReturn(List.of(later, preferred));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(preferred)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
            "APP_PASSWORD", preferred.getEmail(), "secret", null, null, List.of(), null, null, null)));
        when(resolver.resolve(later)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
            "OAUTH2", null, null, "access", "Bearer", List.of("mail"), new Date(9_999_999_999L), null, null)));

        service(target, mapper, resolver).sync(1001L);

        JsonNode json = new ObjectMapper().readTree(target.toFile());
        assertThat(json.path("schemaVersion").asInt()).isEqualTo(1);
        assertThat(json.path("accounts").get(0).path("accountId").asText()).isEqualTo("1");
        assertThat(json.path("accounts").get(0).has("displayName")).isTrue();
        assertThat(json.toString()).contains("secret", "access").doesNotContain("refresh", "credentialRef");
        JsonNode qq = json.path("accounts").get(0);
        String firstLocatorKey = qq.path("locatorKey").asText();
        String secondLocatorKey = json.path("accounts").get(1).path("locatorKey").asText();
        assertThat(firstLocatorKey).hasSize(43).matches("[A-Za-z0-9_-]{43}");
        assertThat(secondLocatorKey).hasSize(43).isNotEqualTo(firstLocatorKey);
        String formerlyDerivable = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(
            java.security.MessageDigest.getInstance("SHA-256").digest(
                Sm4Util.encrypt("mail-locator:v1:1001:1:qq:" + preferred.getEmail().toLowerCase())
                    .getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        assertThat(firstLocatorKey).isNotEqualTo(formerlyDerivable);
        service(target, mapper, resolver).sync(1001L);
        assertThat(new ObjectMapper().readTree(target.toFile()).path("accounts").get(0)
            .path("locatorKey").asText()).isEqualTo(firstLocatorKey);
        assertThat(qq.path("capabilities").toString()).doesNotContain("delete");
        assertThat(qq.path("capabilityStatus").path("delete").asText())
            .isEqualTo("CONDITIONAL_MOVE_OR_UIDPLUS");
        assertThat(qq.path("setupRequirements").toString())
            .contains("ENABLE_IMAP_SMTP", "USE_AUTHORIZATION_CODE");
        assertThat(json.toString()).doesNotContain("top-secret");
        if (Files.getFileStore(target).supportsFileAttributeView("posix")) {
            assertThat(Files.getPosixFilePermissions(target)).isEqualTo(Set.of(
                PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE));
        }
        try (var files = Files.list(temporaryDirectory)) {
            assertThat(files.map(path -> path.getFileName().toString()).toList())
                .containsExactlyInAnyOrder(".mail-projection.lock", "accounts.json");
        }
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void emptyDisplayNameIsStillPresent() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        UserMailAccount account = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        account.setDisplayName(null);
        when(mapper.selectList(any())).thenReturn(List.of(account));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(account)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
            "APP_PASSWORD", account.getEmail(), "secret", null, null, List.of(), null, null, null)));

        service(target, mapper, resolver).sync(1001L);

        JsonNode projected = new ObjectMapper().readTree(target.toFile()).path("accounts").get(0);
        assertThat(projected.has("displayName")).isTrue();
        assertThat(projected.path("displayName").asText()).isEmpty();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void excludesUnresolvableAndWritesEmptyArray() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        UserMailAccount account = account(1L, "Y", new Date(), "gmail", "OAUTH2");
        when(mapper.selectList(any())).thenReturn(List.of(account));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(account)).thenReturn(Optional.empty());

        service(target, mapper, resolver).sync(1001L);

        assertThat(new ObjectMapper().readTree(target.toFile()).path("accounts")).isEmpty();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void atomicallyReplacesSymlinkEntryWithoutFollowingItAndRejectsOversize() throws Exception {
        Path real = temporaryDirectory.resolve("old.json");
        Files.writeString(real, "old-content");
        Path symlink = temporaryDirectory.resolve("accounts.json");
        Files.createSymbolicLink(symlink, real.getFileName());
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        when(mapper.selectList(any())).thenReturn(List.of());
        service(symlink, mapper, mock(MailCredentialResolver.class)).sync(1001L);
        assertThat(Files.readString(real)).isEqualTo("old-content");
        assertThat(Files.isSymbolicLink(symlink)).isFalse();

        Files.writeString(symlink, "old-content");
        UserMailAccount huge = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        huge.setDisplayName("x".repeat(70_000));
        when(mapper.selectList(any())).thenReturn(List.of(huge));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(huge)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
            "APP_PASSWORD", huge.getEmail(), "secret", null, null, List.of(), null, null, null)));
        assertThatThrownBy(() -> service(symlink, mapper, resolver).sync(1001L))
            .isInstanceOf(IllegalStateException.class);
        assertThat(Files.readString(symlink)).isEqualTo("old-content");
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void connectorEventBindsAndDeleteEventUnbindsOnlyMatchingMailProvider() {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        UserMailAccount gmail = account(1L, "Y", new Date(), "gmail", "OAUTH2");
        gmail.setCredentialRef(null);
        gmail.setStatus("AUTH_REQUIRED");
        when(mapper.selectList(any())).thenReturn(List.of(gmail));
        ConnectorInfo connector = new ConnectorInfo();
        connector.setConnectorId(9L);
        connector.setConnectorCode("gmail-mail");
        connector.setProviderCode("google");
        connector.setStatusCd("00A");
        ConnectorInfoMapper connectorMapper = mock(ConnectorInfoMapper.class);
        when(connectorMapper.selectById(9L)).thenReturn(connector);
        ConnectorConnectionStateService connectionState = mock(ConnectorConnectionStateService.class);
        ConnectorAuth authorization = new ConnectorAuth();
        authorization.setAuthCredential(Sm4Util.encrypt("{\"credentialReference\":\"owned-ref\"}"));
        authorization.setAccessExpireTime(new Date(System.currentTimeMillis() + 60_000));
        when(connectionState.findEnabledActiveAuthorization("1001", 9L)).thenReturn(authorization);
        ConnectorCredentialSecretStore store = mock(ConnectorCredentialSecretStore.class);
        when(store.findActiveByReference("owned-ref", "1001")).thenReturn(Optional.of(
            ConnectorCredentialSecret.restored("owned-ref", "google", "1001", 9L, "access", "refresh",
                "Bearer", "mail", new Date(System.currentTimeMillis() + 60_000), null)));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(gmail)).thenReturn(Optional.empty());
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.recognizesMailConnector(9L)).thenReturn(true);
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(gmail));
        when(state.reconcileCurrentBinding(1001L, 9L)).thenAnswer(invocation -> {
            if (connectionState.findEnabledActiveAuthorization("1001", 9L) == null) {
                gmail.setCredentialRef(null);
                gmail.setStatus("AUTH_REQUIRED");
            } else {
                gmail.setCredentialRef("owned-ref");
                gmail.setStatus("NORMAL");
            }
            return Set.of(gmail.getAccountId());
        });
        MailAccountProjectionService service = service(target, resolver,
            new MailAccountProjectionService.NioFileOperations(), state);

        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 9L, ConnectorCredentialProjectionEvent.Action.SYNC));
        assertThat(gmail.getCredentialRef()).isEqualTo("owned-ref");
        assertThat(gmail.getStatus()).isEqualTo("NORMAL");

        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 9L, ConnectorCredentialProjectionEvent.Action.DELETE));
        assertThat(gmail.getCredentialRef()).isEqualTo("owned-ref");
        assertThat(gmail.getStatus()).isEqualTo("NORMAL");

        when(connectionState.findEnabledActiveAuthorization("1001", 9L)).thenReturn(null);
        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 9L, ConnectorCredentialProjectionEvent.Action.DELETE));
        assertThat(gmail.getCredentialRef()).isNull();
        assertThat(gmail.getStatus()).isEqualTo("AUTH_REQUIRED");
    }

    @Test
    void atomicUnsupportedFailsClosedAndCleansPrivateArtifacts() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        FaultingFileOperations files = new FaultingFileOperations();
        files.atomicUnsupported = true;

        assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), files)
            .sync(1001L)).isInstanceOf(IllegalStateException.class);

        assertThat(Files.readString(target)).isEqualTo("old");
        assertNoWorkFiles();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void permissionsAreEstablishedBeforeAtomicRename() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        FaultingFileOperations files = new FaultingFileOperations();
        service(target, emptyMapper(), mock(MailCredentialResolver.class), files).sync(1001L);

        assertThat(files.permissionCalls).isEqualTo(1);
        assertThat(Files.readString(target)).contains("\"accounts\":[]");
        assertNoWorkFiles();
    }

    @Test
    void failureBeforeReplacementNeverTouchesOldFile() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        FaultingFileOperations files = new FaultingFileOperations();
        files.failPermissionCall = 1;

        assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), files)
            .sync(1001L)).isInstanceOf(IllegalStateException.class);

        assertThat(Files.readString(target)).isEqualTo("old");
        assertNoWorkFiles();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void shortChannelWritesStillProduceCompleteJson() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        MailAccountProjectionService.NioFileOperations files = new MailAccountProjectionService.NioFileOperations(
            (channel, buffer) -> writeAtMost(channel, buffer, 3));

        service(target, emptyMapper(), mock(MailCredentialResolver.class), files).sync(1001L);

        JsonNode json = new ObjectMapper().readTree(target.toFile());
        assertThat(json.path("schemaVersion").asInt()).isEqualTo(1);
        assertThat(json.path("accounts")).isEmpty();
        assertNoWorkFiles();
    }

    @Test
    void repeatedZeroChannelWritesFailWithoutTouchingOldFile() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        MailAccountProjectionService.NioFileOperations files = new MailAccountProjectionService.NioFileOperations(
            (channel, buffer) -> 0);

        assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), files)
            .sync(1001L)).isInstanceOf(IllegalStateException.class);

        assertThat(Files.readString(target)).isEqualTo("old");
        assertNoWorkFiles();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void targetSwappedToSymlinkBeforeRenameNeverTouchesExternalFile() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        Path external = temporaryDirectory.resolve("external-secret");
        Files.writeString(external, "external-unchanged");
        FaultingFileOperations files = new FaultingFileOperations();
        files.swapTarget = target;
        files.externalTarget = external;

        service(target, emptyMapper(), mock(MailCredentialResolver.class), files).sync(1001L);

        assertThat(Files.readString(external)).isEqualTo("external-unchanged");
        assertThat(Files.isSymbolicLink(target)).isFalse();
        assertThat(Files.readString(target)).contains("\"accounts\":[]");
    }

    @Test
    void tempPathSwapAfterOpenCannotTruncateExternalFile() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        Path external = temporaryDirectory.resolve("external-secret");
        Files.writeString(external, "external-unchanged");
        FaultingFileOperations files = new FaultingFileOperations();
        files.swapOpenTempTo = external;

        assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), files)
            .sync(1001L)).isInstanceOf(IllegalStateException.class);

        assertThat(Files.readString(external)).isEqualTo("external-unchanged");
        assertThat(Files.readString(target)).isEqualTo("old");
        assertNoWorkFiles();
    }

    @Test
    void parentSwapAfterValidationFailsClosedWithoutTouchingExternalDirectory() throws Exception {
        Path trusted = Files.createDirectory(temporaryDirectory.resolve("trusted"));
        Path external = Files.createDirectory(temporaryDirectory.resolve("external"));
        if (Files.getFileStore(trusted).supportsFileAttributeView("posix")) {
            Files.setPosixFilePermissions(trusted, Set.of(PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE));
            Files.setPosixFilePermissions(external, Set.of(PosixFilePermission.OWNER_READ,
                PosixFilePermission.OWNER_WRITE, PosixFilePermission.OWNER_EXECUTE));
        }
        Path target = trusted.resolve("accounts.json");
        Files.writeString(target, "old");
        Path sentinel = external.resolve("sentinel");
        Files.writeString(sentinel, "external-unchanged");
        FaultingFileOperations files = new FaultingFileOperations();
        files.swapParent = trusted;
        files.parentBackup = temporaryDirectory.resolve("trusted-backup");
        files.externalDirectory = external;

        try {
            assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), files)
                .sync(1001L)).isInstanceOf(IllegalStateException.class);
            assertThat(Files.readString(sentinel)).isEqualTo("external-unchanged");
            assertThat(external.resolve("accounts.json")).doesNotExist();
            assertThat(external.resolve(".mail-projection.lock")).doesNotExist();
            assertThat(Files.readString(files.parentBackup.resolve("accounts.json"))).isEqualTo("old");
        } finally {
            if (Files.isSymbolicLink(trusted)) Files.delete(trusted);
            if (Files.exists(files.parentBackup)) Files.move(files.parentBackup, trusted);
        }
    }

    @Test
    void unavailableSecureDirectorySupportFailsClosed() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        Files.writeString(target, "old");
        MailAccountProjectionService.FileOperations unavailable = (directory, identity) -> {
            throw new IOException("secure directory unavailable");
        };

        assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), unavailable)
            .sync(1001L)).isInstanceOf(IllegalStateException.class);

        assertThat(Files.readString(target)).isEqualTo("old");
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void expiredOldLeaseCannotOverwriteNewWriterAfterItResumes() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        CountDownLatch oldReachedCommit = new CountDownLatch(1);
        CountDownLatch replacementStarted = new CountDownLatch(1);
        AtomicInteger oldChecks = new AtomicInteger();
        MailAccountProjectionLeaseService oldLease = acquiredLease("old-owner");
        org.mockito.Mockito.doAnswer(invocation -> {
            if (oldChecks.incrementAndGet() == 5) {
                oldReachedCommit.countDown();
                assertThat(replacementStarted.await(5, TimeUnit.SECONDS)).isTrue();
                throw new MailAccountProjectionLeaseService.LeaseLostException();
            }
            return null;
        }).when(oldLease).assertOwnedAndRenew(any());
        MailAccountProjectionLeaseService newLease = acquiredLease("new-owner");

        MailAccountProjectionService oldWriter = writer(target, "old", oldLease);
        MailAccountProjectionService newWriter = writer(target, "new", newLease);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var oldFuture = executor.submit(() -> assertThatThrownBy(() -> oldWriter.sync(1001L, Set.of(1L)))
                .isInstanceOf(MailAccountProjectionLeaseService.LeaseLostException.class));
            assertThat(oldReachedCommit.await(5, TimeUnit.SECONDS)).isTrue();
            var newFuture = executor.submit(() -> {
                replacementStarted.countDown();
                newWriter.sync(1001L, Set.of(1L));
            });
            oldFuture.get(5, TimeUnit.SECONDS);
            newFuture.get(5, TimeUnit.SECONDS);
        }

        JsonNode projected = new ObjectMapper().readTree(target.toFile()).path("accounts").get(0);
        assertThat(projected.path("displayName").asText()).isEqualTo("new");
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void busyLeaseLeavesDirtyTriggerForBoundedReconciliation() {
        Path target = temporaryDirectory.resolve("accounts.json");
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(1001L, MailAccountProjectionService.PROJECTION_PATH)).thenReturn(target);
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of());
        when(state.reconcileCurrentBindings(1001L)).thenReturn(Set.of());
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        var owner = new MailAccountProjectionLeaseService.Lease(1001L, "owner");
        when(lease.tryAcquire(1001L)).thenReturn(Optional.empty(), Optional.of(owner));
        when(lease.dirtyUsers(100)).thenReturn(Set.of(1001L));
        when(lease.generation(1001L)).thenReturn(2L);
        when(state.scanProjectionUsersAfter(0L, 100)).thenReturn(
            new MailAccountProjectionStateService.ProjectionUserBatch(Set.of(), 0L, false));
        MailAccountProjectionService service = new MailAccountProjectionService(workspace,
            mock(MailCredentialResolver.class), state, lease, mock(MailAccountMetadataCacheService.class),
            new ObjectMapper(), new MailAccountProjectionService.NioFileOperations());

        service.sync(1001L);
        assertThat(target).doesNotExist();

        service.reconcileDirtyUsers();
        assertThat(target).exists();
        verify(lease, org.mockito.Mockito.times(2)).trigger(1001L);
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void boundedDatabaseSweepRecoversUserEvenWhenRedisDirtySetIsEmpty() {
        Path target = temporaryDirectory.resolve("accounts.json");
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(1001L, MailAccountProjectionService.PROJECTION_PATH)).thenReturn(target);
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.scanProjectionUsersAfter(0L, 100)).thenReturn(
            new MailAccountProjectionStateService.ProjectionUserBatch(Set.of(1001L), 1L, false));
        when(state.loadAllAccountIds(1001L)).thenReturn(Set.of(1L));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of());
        when(state.reconcileCurrentBindings(1001L)).thenReturn(Set.of());
        MailAccountProjectionLeaseService lease = acquiredLease("sweep-owner");
        when(lease.dirtyUsers(100)).thenReturn(Set.of());
        MailAccountProjectionService service = new MailAccountProjectionService(workspace,
            mock(MailCredentialResolver.class), state, lease, mock(MailAccountMetadataCacheService.class),
            new ObjectMapper(), new MailAccountProjectionService.NioFileOperations());

        service.reconcileDirtyUsers();

        assertThat(target).exists();
        verify(state).reconcileCurrentBindings(1001L);
    }

    @Test
    void connectorLookupFailureDoesNotEscapeEventAndLeavesGenerationDirty() {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.recognizesMailConnector(9L)).thenReturn(true);
        when(state.reconcileCurrentBinding(1001L, 9L)).thenThrow(
            new MailCredentialResolutionException(MailCredentialResolutionException.Code.INFRASTRUCTURE, null));
        MailAccountProjectionLeaseService lease = acquiredLease("event-owner");
        MailAccountProjectionService service = new MailAccountProjectionService(
            workspace(temporaryDirectory.resolve("accounts.json")), mock(MailCredentialResolver.class),
            state, lease, mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 9L, ConnectorCredentialProjectionEvent.Action.SYNC));

        verify(lease, org.mockito.Mockito.never()).markClean(any(Long.class), any(Long.class));
    }

    @Test
    void eventTriggerFailureMarksOnlyAccountsForThatConnector() {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.recognizesMailConnector(9L)).thenReturn(true);
        when(state.loadAccountIdsForConnector(1001L, 9L)).thenReturn(Set.of(7L));
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        when(lease.trigger(1001L)).thenThrow(new MailAccountProjectionLeaseService.LeaseUnavailableException());
        MailAccountProjectionService service = new MailAccountProjectionService(
            mock(ConnectorCredentialWorkspaceService.class), mock(MailCredentialResolver.class), state, lease,
            mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 9L, ConnectorCredentialProjectionEvent.Action.DELETE));

        verify(state).markProjectionFailed(1001L, Set.of(7L));
    }

    @Test
    void nonMailConnectorEventReturnsBeforeLeaseOrProjectionWork() {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.recognizesMailConnector(99L)).thenReturn(false);
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        MailAccountMetadataCacheService cache = mock(MailAccountMetadataCacheService.class);
        MailAccountProjectionService service = new MailAccountProjectionService(
            workspace, mock(MailCredentialResolver.class), state, lease,
            cache, new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 99L, ConnectorCredentialProjectionEvent.Action.SYNC));

        verify(lease, never()).trigger(any());
        verify(state, never()).loadActiveSnapshot(any());
        verifyNoInteractions(workspace, cache);
    }

    @Test
    void connectorRecognitionFailureDoesNotStartSyncOrEscapeEvent() {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.recognizesMailConnector(9L)).thenThrow(
            new MailCredentialResolutionException(MailCredentialResolutionException.Code.INFRASTRUCTURE, null));
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        MailAccountMetadataCacheService cache = mock(MailAccountMetadataCacheService.class);
        MailAccountProjectionService service = new MailAccountProjectionService(
            workspace, mock(MailCredentialResolver.class), state, lease,
            cache, new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.handle(new ConnectorCredentialProjectionEvent(
            1001L, 9L, ConnectorCredentialProjectionEvent.Action.SYNC));

        verify(lease, never()).trigger(any());
        verifyNoInteractions(workspace, cache);
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void credentialResolutionFailureMarksOnlyTheFailingAccount() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccount broken = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        UserMailAccount healthy = account(2L, "N", new Date(), "qq", "APP_PASSWORD");
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(broken, healthy));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(broken)).thenThrow(new MailCredentialResolutionException(
            MailCredentialResolutionException.Code.CORRUPT_CREDENTIAL, null));
        when(resolver.resolve(healthy)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
            "APP_PASSWORD", healthy.getEmail(), "healthy-secret", null, null, List.of(), null, null, null)));
        MailAccountProjectionLeaseService lease = acquiredLease("owner");
        MailAccountProjectionService service = new MailAccountProjectionService(workspace(target), resolver,
            state, lease, mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.sync(1001L, Set.of());

        verify(state).markProjectionFailed(1001L, Set.of(1L));
        verify(state, never()).markProjectionFailed(1001L, Set.of(1L, 2L));
        JsonNode projected = new ObjectMapper().readTree(target.toFile()).path("accounts");
        assertThat(projected).hasSize(1);
        assertThat(projected.get(0).path("accountId").asText()).isEqualTo("2");
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void privateLocatorKeyringSurvivesCorruptOmissionAndPrunesOrRotatesSecurityContexts() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccount account = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        AtomicReference<List<UserMailAccount>> snapshot = new AtomicReference<>(List.of(account));
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L));
        when(state.loadActiveSnapshot(1001L)).thenAnswer(invocation -> snapshot.get());
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        MailCredentialResolver.ResolvedAuth auth = new MailCredentialResolver.ResolvedAuth(
            "APP_PASSWORD", account.getEmail(), "secret", null, null, List.of(), null, null, null);
        when(resolver.resolve(account)).thenReturn(Optional.of(auth))
            .thenThrow(new MailCredentialResolutionException(
                MailCredentialResolutionException.Code.CORRUPT_CREDENTIAL, null))
            .thenReturn(Optional.of(auth), Optional.of(auth));
        MailAccountProjectionService service = new MailAccountProjectionService(workspace(target), resolver,
            state, acquiredLease("owner"), mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.sync(1001L, Set.of());
        String original = projectionKey(target, 0);
        service.sync(1001L, Set.of());
        JsonNode omitted = new ObjectMapper().readTree(target.toFile());
        assertThat(omitted.path("accounts")).isEmpty();
        assertThat(omitted.path("locatorKeyring")).hasSize(1);
        service.sync(1001L, Set.of());
        assertThat(projectionKey(target, 0)).isEqualTo(original);

        account.setEmail("changed@example.test");
        service.sync(1001L, Set.of());
        String rotated = projectionKey(target, 0);
        assertThat(rotated).isNotEqualTo(original);
        assertThat(new ObjectMapper().readTree(target.toFile()).path("locatorKeyring")).hasSize(1);

        account.setProviderCode("gmail");
        service.sync(1001L, Set.of());
        String providerRotated = projectionKey(target, 0);
        assertThat(providerRotated).isNotEqualTo(rotated);
        assertThat(new ObjectMapper().readTree(target.toFile()).path("locatorKeyring")).hasSize(1);

        account.setAccountId(2L);
        service.sync(1001L, Set.of());
        assertThat(projectionKey(target, 0)).isNotEqualTo(providerRotated);
        assertThat(new ObjectMapper().readTree(target.toFile()).path("locatorKeyring")).hasSize(1);

        snapshot.set(List.of());
        service.sync(1001L, Set.of(1L));
        JsonNode deleted = new ObjectMapper().readTree(target.toFile());
        assertThat(deleted.path("accounts")).isEmpty();
        assertThat(deleted.path("locatorKeyring")).isEmpty();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void resolverInfrastructureFailurePreservesOldProjectionAndLeavesDirtyForRetry() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        byte[] oldProjection = "old-projection-bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8);
        Files.write(target, oldProjection);
        UserMailAccount account = account(1L, "Y", new Date(), "gmail", "OAUTH2");
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(account));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(account)).thenThrow(new MailCredentialResolutionException(
            MailCredentialResolutionException.Code.INFRASTRUCTURE, null));
        MailAccountProjectionLeaseService lease = acquiredLease("owner");
        MailAccountProjectionService service = new MailAccountProjectionService(workspace(target), resolver,
            state, lease, mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        assertThatThrownBy(() -> service.sync(1001L, Set.of(1L)))
            .isInstanceOf(MailCredentialResolutionException.class);

        assertThat(Files.readAllBytes(target)).containsExactly(oldProjection);
        verify(state).markProjectionFailed(1001L, Set.of(1L, 2L));
        verify(lease, never()).markClean(any(), any(Long.class));
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void corruptActiveAndDeletedAccountCommitConsistentDatabaseFileAndRedis() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccount corrupt = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        UserMailAccount deleted = account(2L, "N", new Date(), "qq", "APP_PASSWORD");
        deleted.setDeleteFlag("1");
        deleted.setStatus("PROJECTION_FAILED");
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(corrupt));
        when(state.markProjectionSucceeded(1001L, Set.of(2L))).thenAnswer(invocation -> {
            deleted.setStatus("DELETED");
            return Set.of(2L);
        });
        org.mockito.Mockito.doAnswer(invocation -> {
            corrupt.setStatus("PROJECTION_FAILED");
            return null;
        }).when(state).markProjectionFailed(1001L, Set.of(1L));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(corrupt)).thenThrow(new MailCredentialResolutionException(
            MailCredentialResolutionException.Code.CORRUPT_CREDENTIAL, null));
        AtomicReference<String> redisJson = new AtomicReference<>();
        MailAccountMetadataCacheService cache = realCache(List.of(corrupt), redisJson);
        MailAccountProjectionService service = new MailAccountProjectionService(workspace(target), resolver,
            state, acquiredLease("owner"), cache, new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        service.sync(1001L, Set.of(2L));

        verify(state).markProjectionSucceeded(1001L, Set.of(2L));
        verify(state).markProjectionFailed(1001L, Set.of(1L));
        assertThat(corrupt.getStatus()).isEqualTo("PROJECTION_FAILED");
        assertThat(deleted.getStatus()).isEqualTo("DELETED");
        assertThat(new ObjectMapper().readTree(target.toFile()).path("accounts")).isEmpty();
        JsonNode cached = new ObjectMapper().readTree(redisJson.get()).path("accounts");
        assertThat(cached).hasSize(1);
        assertThat(cached.get(0).path("status").asText()).isEqualTo("PROJECTION_FAILED");
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void singleAccountRetryRecoversWholeProjectionBeforeClean() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccount first = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        UserMailAccount second = account(2L, "N", new Date(), "qq", "APP_PASSWORD");
        MailAccountProjectionStateService failedState = mock(MailAccountProjectionStateService.class);
        when(failedState.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(failedState.loadActiveSnapshot(1001L)).thenReturn(List.of(first, second));
        when(failedState.markProjectionSucceeded(1001L, Set.of(1L, 2L))).thenReturn(Set.of(1L, 2L));
        FaultingFileOperations failedFiles = new FaultingFileOperations();
        failedFiles.atomicUnsupported = true;
        MailAccountProjectionService failed = new MailAccountProjectionService(workspace(target),
            resolverFor(first, second), failedState, acquiredLease("failed-owner"),
            mock(MailAccountMetadataCacheService.class), new ObjectMapper(), failedFiles);
        assertThatThrownBy(() -> failed.sync(1001L, Set.of(1L))).isInstanceOf(IllegalStateException.class);
        verify(failedState).markProjectionFailed(1001L, Set.of(1L, 2L));

        MailAccountProjectionStateService recoveredState = mock(MailAccountProjectionStateService.class);
        when(recoveredState.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L, 3L));
        when(recoveredState.loadActiveSnapshot(1001L)).thenReturn(List.of(first, second));
        MailAccountProjectionLeaseService recoveredLease = acquiredLease("recovered-owner");
        AtomicReference<String> redisJson = new AtomicReference<>();
        MailAccountMetadataCacheService cache = spy(realCache(List.of(first, second), redisJson));
        MailAccountProjectionService recovered = new MailAccountProjectionService(workspace(target),
            resolverFor(first, second), recoveredState, recoveredLease, cache, new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        recovered.sync(1001L, Set.of(1L));

        verify(recoveredState).markProjectionSucceeded(1001L, Set.of(1L, 2L, 3L));
        assertThat(new ObjectMapper().readTree(target.toFile()).path("accounts")).hasSize(2);
        assertThat(new ObjectMapper().readTree(redisJson.get()).path("accounts")).hasSize(2);
        var completion = inOrder(recoveredState, cache, recoveredLease);
        completion.verify(recoveredState).markProjectionSucceeded(1001L, Set.of(1L, 2L, 3L));
        completion.verify(cache).refreshRequired(1001L);
        completion.verify(recoveredLease).markClean(1001L, 1L);
    }

    @Test
    void snapshotLoadFailureCompensatesCompleteRecoveryScope() {
        Path target = temporaryDirectory.resolve("accounts.json");
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L, 2L));
        when(state.loadActiveSnapshot(1001L)).thenThrow(new IllegalStateException("database unavailable"));
        MailAccountProjectionService service = new MailAccountProjectionService(workspace(target),
            mock(MailCredentialResolver.class), state, acquiredLease("owner"),
            mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        assertThatThrownBy(() -> service.sync(1001L, Set.of(1L)))
            .isInstanceOf(IllegalStateException.class);

        verify(state).markProjectionFailed(1001L, Set.of(1L, 2L));
        verify(state, never()).markProjectionSucceeded(any(), any());
        assertThat(target).doesNotExist();
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void recoveredProjectionFailedAccountSerializesAfterCommitWithConsistentStatus() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        UserMailAccount recovering = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        recovering.setStatus("PROJECTION_FAILED");
        recovering.setAuthCodeCipher("encrypted-present");
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadProjectionRecoveryIds(1001L)).thenReturn(Set.of(1L));
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(recovering));
        when(state.markProjectionSucceeded(1001L, Set.of(1L))).thenAnswer(invocation -> {
            recovering.setStatus("NORMAL");
            return Set.of(1L);
        });
        AtomicReference<String> redisJson = new AtomicReference<>();
        MailAccountMetadataCacheService cache = realCache(List.of(recovering), redisJson);
        ObjectMapper json = spy(new ObjectMapper());
        MailAccountProjectionService service = new MailAccountProjectionService(workspace(target),
            resolverFor(recovering), state, acquiredLease("owner"), cache, json,
            new MailAccountProjectionService.NioFileOperations());

        service.sync(1001L, Set.of(1L));

        var order = inOrder(state, json);
        order.verify(state).markProjectionSucceeded(1001L, Set.of(1L));
        order.verify(json).writeValueAsString(any(Object.class));
        assertThat(recovering.getStatus()).isEqualTo("NORMAL");
        assertThat(new ObjectMapper().readTree(target.toFile()).path("accounts").get(0)
            .path("status").asText()).isEqualTo("NORMAL");
        assertThat(new ObjectMapper().readTree(redisJson.get()).path("accounts").get(0)
            .path("status").asText()).isEqualTo("NORMAL");
    }

    @Test
    void failedNewProjectionLeavesNoTargetOrArtifacts() throws Exception {
        Path target = temporaryDirectory.resolve("accounts.json");
        FaultingFileOperations files = new FaultingFileOperations();
        files.failPermissionCall = 1;

        assertThatThrownBy(() -> service(target, emptyMapper(), mock(MailCredentialResolver.class), files)
            .sync(1001L)).isInstanceOf(IllegalStateException.class);

        assertThat(target).doesNotExist();
        assertNoWorkFiles();
    }

    @Test
    void projectionFailureCanMarkTheJustSoftDeletedAccount() {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);

        service(temporaryDirectory.resolve("accounts.json"), mock(MailCredentialResolver.class),
            new MailAccountProjectionService.NioFileOperations(), state).markProjectionFailed(1001L, 77L);

        verify(state).markProjectionFailed(1001L, Set.of(77L));
    }

    @Test
    void redisTriggerFailureMarksOnlyExplicitlyAffectedAccount() {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        when(lease.trigger(1001L)).thenThrow(new MailAccountProjectionLeaseService.LeaseUnavailableException());
        MailAccountMetadataCacheService cache = mock(MailAccountMetadataCacheService.class);
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        MailAccountProjectionService service = new MailAccountProjectionService(workspace,
            mock(MailCredentialResolver.class), state, lease, cache, new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());

        assertThatThrownBy(() -> service.sync(1001L, Set.of(77L)))
            .isInstanceOf(MailAccountProjectionLeaseService.LeaseUnavailableException.class);

        verify(state).markProjectionFailed(1001L, Set.of(77L));
        verify(cache).refresh(1001L);
    }

    @DisabledOnOs(value = OS.MAC, disabledReason ="macOS JDK has no SecureDirectoryStream; this path needs it (passes on Linux CI)")
    @Test
    void successfulRetryPreparesSnapshotBeforeNormalizingDatabase() {
        Path target = temporaryDirectory.resolve("accounts.json");
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of());
        when(state.reconcileCurrentBindings(1001L)).thenReturn(Set.of());

        service(target, mock(MailCredentialResolver.class),
            new MailAccountProjectionService.NioFileOperations(), state).sync(1001L, Set.of(77L));

        var order = inOrder(state);
        order.verify(state).loadActiveSnapshot(1001L);
        order.verify(state).markProjectionSucceeded(1001L, Set.of(77L));
    }

    private MailAccountProjectionService service(
            Path target, UserMailAccountMapper mapper, MailCredentialResolver resolver) {
        return service(target, mapper, resolver, new MailAccountProjectionService.NioFileOperations());
    }

    private MailAccountProjectionService service(Path target, UserMailAccountMapper mapper,
            MailCredentialResolver resolver, MailAccountProjectionService.FileOperations fileOperations) {
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadActiveSnapshot(1001L)).thenAnswer(invocation -> mapper.selectList(null));
        when(state.reconcileCurrentBindings(1001L)).thenReturn(Set.of());
        return service(target, resolver, fileOperations, state);
    }

    private MailAccountProjectionService service(Path target, MailCredentialResolver resolver,
            MailAccountProjectionService.FileOperations fileOperations, MailAccountProjectionStateService state) {
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(1001L, MailAccountProjectionService.PROJECTION_PATH)).thenReturn(target);
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        MailAccountProjectionLeaseService.Lease acquired = new MailAccountProjectionLeaseService.Lease(1001L, "owner");
        when(lease.tryAcquire(1001L)).thenReturn(Optional.of(acquired));
        when(lease.generation(1001L)).thenReturn(1L);
        MailAccountMetadataCacheService cache = mock(MailAccountMetadataCacheService.class);
        return new MailAccountProjectionService(workspace, resolver, state, lease, cache,
            new ObjectMapper(), fileOperations);
    }

    private UserMailAccountMapper emptyMapper() {
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        when(mapper.selectList(any())).thenReturn(List.of());
        return mapper;
    }

    private String projectionKey(Path target, int index) throws IOException {
        return new ObjectMapper().readTree(target.toFile()).path("accounts").get(index)
            .path("locatorKey").asText();
    }

    private MailAccountProjectionLeaseService acquiredLease(String ownerName) {
        MailAccountProjectionLeaseService lease = mock(MailAccountProjectionLeaseService.class);
        when(lease.tryAcquire(1001L)).thenReturn(Optional.of(
            new MailAccountProjectionLeaseService.Lease(1001L, ownerName)));
        when(lease.generation(1001L)).thenReturn(1L);
        return lease;
    }

    private ConnectorCredentialWorkspaceService workspace(Path target) {
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(1001L, MailAccountProjectionService.PROJECTION_PATH)).thenReturn(target);
        return workspace;
    }

    private MailAccountProjectionService writer(Path target, String displayName,
            MailAccountProjectionLeaseService lease) {
        UserMailAccount value = account(1L, "Y", new Date(), "qq", "APP_PASSWORD");
        value.setDisplayName(displayName);
        MailAccountProjectionStateService state = mock(MailAccountProjectionStateService.class);
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(value));
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        when(resolver.resolve(value)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
            "APP_PASSWORD", value.getEmail(), "secret", null, null, List.of(), null, null, null)));
        ConnectorCredentialWorkspaceService workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(1001L, MailAccountProjectionService.PROJECTION_PATH)).thenReturn(target);
        return new MailAccountProjectionService(workspace, resolver, state, lease,
            mock(MailAccountMetadataCacheService.class), new ObjectMapper(),
            new MailAccountProjectionService.NioFileOperations());
    }

    private MailCredentialResolver resolverFor(UserMailAccount... accounts) {
        MailCredentialResolver resolver = mock(MailCredentialResolver.class);
        for (UserMailAccount value : accounts) {
            when(resolver.resolve(value)).thenReturn(Optional.of(new MailCredentialResolver.ResolvedAuth(
                "APP_PASSWORD", value.getEmail(), "secret", null, null, List.of(), null, null, null)));
        }
        return resolver;
    }

    @SuppressWarnings("unchecked")
    private MailAccountMetadataCacheService realCache(
            List<UserMailAccount> accounts, AtomicReference<String> redisJson) {
        UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
        when(mapper.selectList(any())).thenReturn(accounts);
        LoginApplicationService logins = mock(LoginApplicationService.class);
        LoginInfo login = new LoginInfo();
        login.setUserCode("tester");
        when(logins.getLoginInfo(1001L)).thenReturn(login);
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        ValueOperations<String, String> values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        org.mockito.Mockito.doAnswer(invocation -> {
            redisJson.set(invocation.getArgument(1));
            return null;
        }).when(values).set(any(String.class), any(String.class));
        return new MailAccountMetadataCacheService(new MailAccountMetadataCacheTransactionService(
            mapper, logins, redis, new ObjectMapper()));
    }

    private void assertNoWorkFiles() throws IOException {
        try (var files = Files.list(temporaryDirectory)) {
            assertThat(files.map(path -> path.getFileName().toString())
                .filter(name -> name.startsWith(".mail-accounts-")).toList()).isEmpty();
        }
    }

    private static int writeAtMost(FileChannel channel, ByteBuffer buffer, int maximum) throws IOException {
        int originalLimit = buffer.limit();
        buffer.limit(Math.min(originalLimit, buffer.position() + maximum));
        try {
            return channel.write(buffer);
        } finally {
            buffer.limit(originalLimit);
        }
    }

    private static class FaultingFileOperations extends MailAccountProjectionService.NioFileOperations {
        boolean atomicUnsupported;
        int failPermissionCall = -1;
        int permissionCalls;
        Path swapTarget;
        Path externalTarget;
        Path swapOpenTempTo;
        boolean swappedOpenTemp;
        Path swapParent;
        Path parentBackup;
        Path externalDirectory;

        @Override
        protected void beforeOpenDirectory(Path directory) throws IOException {
            if (swapParent != null && swapParent.equals(directory)) {
                Files.move(directory, parentBackup);
                Files.createSymbolicLink(directory, externalDirectory);
                swapParent = null;
            }
        }

        @Override
        protected void beforeMove(Path directory, MailAccountProjectionService.OpenedPrivateFile source, Path target)
                throws IOException {
            if (atomicUnsupported) {
                throw new AtomicMoveNotSupportedException(source.path().toString(), target.toString(), "test");
            }
            Path absoluteTarget = directory.resolve(target);
            if (swapTarget != null && swapTarget.equals(absoluteTarget)) {
                Files.deleteIfExists(absoluteTarget);
                Files.createSymbolicLink(absoluteTarget, externalTarget);
            }
        }

        @Override
        protected void beforeOpenTemp(Path directory) throws IOException {
            permissionCalls++;
            if (permissionCalls == failPermissionCall) {
                throw new IOException("permission failed");
            }
        }

        @Override
        protected void beforeValidateIdentity(Path directory,
                MailAccountProjectionService.OpenedPrivateFile file, Path path)
                throws IOException {
            if (swapOpenTempTo != null && !swappedOpenTemp && path.equals(file.path())) {
                swappedOpenTemp = true;
                Files.delete(directory.resolve(path));
                Files.createSymbolicLink(directory.resolve(path), swapOpenTempTo);
            }
        }
    }

    private UserMailAccount account(Long id, String defaultFlag, Date update, String provider, String authType) {
        UserMailAccount account = new UserMailAccount();
        account.setAccountId(id);
        account.setUserId(1001L);
        account.setAccountName("mail-" + id);
        account.setEmail("user" + id + "@example.com");
        account.setDisplayName("User " + id);
        account.setDefaultFlag(defaultFlag);
        account.setProviderCode(provider);
        account.setAuthType(authType);
        account.setStatus("NORMAL");
        account.setDeleteFlag("0");
        account.setUpdateTime(update);
        return account;
    }
}
