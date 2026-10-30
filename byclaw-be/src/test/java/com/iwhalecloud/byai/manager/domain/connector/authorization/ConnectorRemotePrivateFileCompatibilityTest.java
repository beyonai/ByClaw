package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformPrivateFileSystemRouting;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;

/** The canonical Platform root is a logical address, not a mounted BE directory. */
class ConnectorRemotePrivateFileCompatibilityTest {
    @TempDir Path temporary;
    private Path localRoot;
    private Path canonicalRoot;
    private PlatformRemoteGateway gateway;
    private PlatformPrivateFileSystemRouting routing;
    private ConnectorCredentialWorkspaceService workspace;
    private ConnectorPrivateFileProjectionWriter writer;

    @BeforeEach
    void setUp() {
        localRoot = temporary.resolve("be-local");
        canonicalRoot = temporary.resolve("unmounted-platform-root");
        gateway = mock(PlatformRemoteGateway.class);
        when(gateway.isRemote()).thenReturn(true);
        when(gateway.params(any(Object[].class))).thenCallRealMethod();
        routing = new PlatformPrivateFileSystemRouting(gateway, canonicalRoot.toString());
        var login = mock(LoginApplicationService.class);
        var buckets = mock(UserBucketNamingService.class);
        LoginInfo info = new LoginInfo();
        info.setUserCode("user001");
        when(login.getLoginInfo(42L)).thenReturn(info);
        when(buckets.buildUserBucketName("user001")).thenReturn("byclaw-user001");
        workspace = new ConnectorCredentialWorkspaceService(login, buckets, localRoot.toString());
        ReflectionTestUtils.setField(workspace, "platformPrivateFiles", routing);
        writer = new ConnectorPrivateFileProjectionWriter();
        ReflectionTestUtils.setField(writer, "platformPrivateFiles", routing);
    }

    @Test
    void remoteProjectionUsesOwnerRelativeAddressAndNeverCreatesLocalMount() {
        Path file = workspace.resolveProjectionFile(42L, "/by/.connector-auth/.custom/success.json");
        String content = "{\"status\":\"连接成功\"}";
        writer.write(file, content);

        verify(gateway).call("private-filesystem", "trust-root", Map.of("path", ""));
        verify(gateway).call("private-filesystem", "prepare-directory", Map.of(
            "path", "byclaw-user001", "privateDirectory", false));
        verify(gateway).call("private-filesystem", "prepare-directory", Map.of(
            "path", "byclaw-user001/by/.connector-auth/.custom", "privateDirectory", true));
        verify(gateway).call("private-filesystem", "chmod-directory", Map.of(
            "path", "byclaw-user001/by/.connector-auth/.custom"));
        verify(gateway).call("private-filesystem", "write-atomic", Map.of(
            "path", "byclaw-user001/by/.connector-auth/.custom/success.json",
            "content", Base64.getEncoder().encodeToString(content.getBytes(StandardCharsets.UTF_8)),
            "temporaryPrefix", ".connector-projection-"));
        assertThat(file).isEqualTo(canonicalRoot.resolve("byclaw-user001/by/.connector-auth/.custom/success.json"));
        assertThat(Files.exists(canonicalRoot)).isFalse();
        assertThat(Files.exists(localRoot)).isFalse();
    }

    @Test
    void cliHomeAndMailLockedProjectionStayLocalWhenPlatformIsRemote() throws Exception {
        var cli = workspace.resolve(42L, "github");
        Path mail = workspace.resolveLocalProjectionFile(42L, "/by/.connector-auth/.mail/accounts.json");

        assertThat(cli.home()).isEqualTo(localRoot.toRealPath().resolve("byclaw-user001/by/.connector-auth/.github"));
        assertThat(cli.environment()).isEqualTo(Map.of("HOME", cli.home().toString()));
        assertThat(mail.getParent()).isDirectory();
        assertThat(mail).isEqualTo(localRoot.toRealPath().resolve("byclaw-user001/by/.connector-auth/.mail/accounts.json"));
        assertThat(Files.exists(canonicalRoot)).isFalse();
        verifyNoInteractions(gateway);
    }

    @Test
    void failedPlatformWriteNeverFallsBackToBeDisk() {
        Path target = canonicalRoot.resolve("byclaw-user001/by/.connector-auth/.custom/success.json");
        doThrow(new IllegalStateException("storage unavailable")).when(gateway)
            .call(eq("private-filesystem"), eq("write-atomic"), any());

        assertThatThrownBy(() -> writer.write(target, "simulated-success"))
            .isInstanceOf(PlatformPrivateFileSystemRouting.RemoteFailure.class);
        assertThat(Files.exists(canonicalRoot)).isFalse();
        assertThat(Files.exists(localRoot)).isFalse();
    }

    @Test
    void multibyteProjectionLimitCountsUtf8BytesBeforeRemoteWrite() {
        Path target = canonicalRoot.resolve("byclaw-user001/by/.connector-auth/success.json");
        assertThatThrownBy(() -> writer.write(target, "中".repeat(22_000)))
            .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("64 KiB");
        org.mockito.Mockito.verify(gateway, org.mockito.Mockito.never())
            .call(eq("private-filesystem"), eq("write-atomic"), any());
    }

    @Test
    void candidateReadAndDeletionKeepSameOwnerMappingAndReadBound() {
        Path target = canonicalRoot.resolve("byclaw-user001/by/.connector-auth/success.json");
        when(gateway.call(eq("private-filesystem"), eq("read-candidate"), any()))
            .thenReturn(Base64.getEncoder().encodeToString("abc".getBytes(StandardCharsets.UTF_8)));
        assertThat(routing.readCandidate(target, 3)).isEqualTo("abc".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> routing.readCandidate(target, 2))
            .isInstanceOf(PlatformPrivateFileSystemRouting.RemoteFailure.class);
        writer.delete(target);
        verify(gateway).call("private-filesystem", "delete", Map.of(
            "path", "byclaw-user001/by/.connector-auth/success.json"));
    }
}
