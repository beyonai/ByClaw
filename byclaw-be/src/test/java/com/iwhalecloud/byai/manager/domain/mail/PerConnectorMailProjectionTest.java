package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.connector.authorization.ConnectorCredentialWorkspaceService;
import com.iwhalecloud.byai.manager.entity.users.UserMailAccount;
import com.iwhalecloud.byai.manager.entity.connector.ConnectorInfo;

class PerConnectorMailProjectionTest {
    @TempDir Path directory;

    @Test
    void writesIndependentSchemaTwoDocumentsAndPreservesUntouchedConnector() throws Exception {
        Files.setPosixFilePermissions(directory, PosixFilePermissions.fromString("rwx------"));
        var workspace = mock(ConnectorCredentialWorkspaceService.class);
        when(workspace.resolveProjectionFile(any(), any())).thenAnswer(call ->
            directory.resolve(Path.of((String) call.getArgument(1)).getFileName()));
        var state = mock(MailAccountProjectionStateService.class);
        var resolver = mock(MailCredentialResolver.class);
        var lease = mock(MailAccountProjectionLeaseService.class);
        var owner = new MailAccountProjectionLeaseService.Lease(1001L, "owner");
        when(lease.tryAcquire(1001L)).thenReturn(Optional.of(owner));
        UserMailAccount qq = account(1L, "qq"), gmail = account(2L, "gmail");
        when(state.loadActiveSnapshot(1001L)).thenReturn(List.of(qq, gmail));
        when(state.findActiveConnector(any())).thenAnswer(call -> {
            var connector = new ConnectorInfo();
            connector.setConnectorCode(call.getArgument(0));
            connector.setConnectorId("qq-mail".equals(call.getArgument(0)) ? 1L : 2L);
            connector.setStatusCd("00A");
            return connector;
        });
        when(resolver.resolve(any())).thenAnswer(call -> Optional.of(
            MailCredentialResolver.ResolvedAuth.secret("APP_PASSWORD", "test@example.invalid", "test-only")));
        var service = new MailAccountProjectionService(workspace, resolver, state, lease,
            mock(MailAccountMetadataCacheService.class), new ObjectMapper(), new TestMailFileOperations());
        service.sync(1001L);
        Path qqFile = directory.resolve("qq-mail.json"), gmailFile = directory.resolve("gmail-mail.json");
        var json = new ObjectMapper().readTree(qqFile.toFile());
        assertThat(json.path("schemaVersion").asInt()).isEqualTo(2);
        assertThat(json.path("connectorCode").asText()).isEqualTo("qq-mail");
        assertThat(json.has("accounts")).isFalse();
        assertThat(json.path("account").has("default")).isFalse();
        String key = json.path("account").path("locatorKey").asText();
        assertThat(key).hasSize(43);
        var gmailModified = Files.getLastModifiedTime(gmailFile);
        service.sync(1001L, Set.of(1L));
        assertThat(Files.getLastModifiedTime(gmailFile)).isEqualTo(gmailModified);
        assertThat(new ObjectMapper().readTree(qqFile.toFile()).path("account").path("locatorKey").asText()).isEqualTo(key);
        assertThat(directory.resolve("accounts.json")).doesNotExist();
    }

    private UserMailAccount account(Long id, String provider) {
        var account = new UserMailAccount();
        account.setAccountId(id);
        account.setConnectorId(id);
        account.setUserId(1001L);
        account.setProviderCode(provider);
        account.setEmail("test@example.invalid");
        account.setAuthType("APP_PASSWORD");
        account.setDeleteFlag("0");
        account.setStatus("NORMAL");
        return account;
    }
}
