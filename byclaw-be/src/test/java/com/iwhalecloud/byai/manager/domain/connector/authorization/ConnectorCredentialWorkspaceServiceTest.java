package com.iwhalecloud.byai.manager.domain.connector.authorization;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;

@ExtendWith(MockitoExtension.class)
class ConnectorCredentialWorkspaceServiceTest {

    private static final Long USER_ID = 42L;

    @TempDir
    Path tempDir;

    @Mock
    private LoginApplicationService loginApplicationService;

    @Mock
    private UserBucketNamingService userBucketNamingService;

    private ConnectorCredentialWorkspaceService service;

    @BeforeEach
    void setUp() {
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, tempDir.toString());
    }

    @Test
    void resolveCreatesExactPerUserProviderHomeAndImmutableEnvironment() throws Exception {
        LoginInfo loginInfo = loginInfo("user001");
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(loginInfo);
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");

        ConnectorCredentialWorkspaceService.ConnectorCliWorkspace workspace = service.resolve(USER_ID, "github");

        Path expectedHome = tempDir.toRealPath().resolve("byclaw-user001/by/.connector-auth/.github");
        assertThat(workspace.home()).isEqualTo(expectedHome);
        assertThat(workspace.environment()).isEqualTo(Map.of("HOME", expectedHome.toString()));
        assertThat(Files.isDirectory(expectedHome)).isTrue();
        assertThatThrownBy(() -> workspace.environment().put("TOKEN", "value"))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void constructorRejectsNullOrBlankStorageRoot() {
        assertThatThrownBy(() -> new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, null))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, ""))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, " "))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void resolveCreatesMissingRootAndReturnsPathUnderItsRealLocation() throws Exception {
        Path configuredRoot = tempDir.resolve("missing/../trusted-root");
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, configuredRoot.toString());
        stubValidUserAndBucket();

        ConnectorCredentialWorkspaceService.ConnectorCliWorkspace workspace = service.resolve(USER_ID, "github");

        Path realRoot = tempDir.resolve("trusted-root").toRealPath();
        assertThat(workspace.home()).isEqualTo(
            realRoot.resolve("byclaw-user001/by/.connector-auth/.github"));
        assertThat(workspace.home()).startsWith(realRoot);
    }

    @Test
    void resolveAllowsConfiguredRootSymlinkButReturnsPathUnderRealTarget() throws Exception {
        Path realRoot = tempDir.resolve("real-root");
        Files.createDirectories(realRoot);
        Path configuredLink = tempDir.resolve("configured-root-link");
        Files.createSymbolicLink(configuredLink, realRoot);
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, configuredLink.toString());
        stubValidUserAndBucket();

        ConnectorCredentialWorkspaceService.ConnectorCliWorkspace workspace = service.resolve(USER_ID, "github");

        assertThat(workspace.home()).startsWith(realRoot.toRealPath());
        assertThat(workspace.home().startsWith(configuredLink.toAbsolutePath())).isFalse();
    }

    @Test
    void resolveRejectsUnknownUserAndIncludesUserId() {
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(null);

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining(USER_ID.toString());
    }

    @Test
    void resolveRejectsBlankUserCodeAndIncludesUserId() {
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(loginInfo(" "));

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining(USER_ID.toString());
    }

    @Test
    void resolveWrapsLoginLookupFailureAndIncludesUserId() {
        when(loginApplicationService.getLoginInfo(USER_ID)).thenThrow(new RuntimeException("lookup failed"));

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining(USER_ID.toString());
    }

    @Test
    void resolveRejectsBlankBucketName() {
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(loginInfo("user001"));
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn(" ");

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void resolveRejectsBucketUnlessItIsOneValidResolverStyleSegment() throws Exception {
        Path storageRoot = tempDir.resolve("bucket-validation-root");
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, storageRoot.toString());
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(loginInfo("user001"));
        when(userBucketNamingService.buildUserBucketName("user001"))
            .thenReturn("../escape", "a", "UPPER-bucket", "a".repeat(64));

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
        assertThat(tempDir.resolve("escape")).doesNotExist();
    }

    @Test
    void resolveRejectsExistingSymlinksFromBucketThroughProviderHome() throws Exception {
        stubValidUserAndBucket();

        assertExistingSymlinkRejected("bucket", Path.of("byclaw-user001"));
        assertExistingSymlinkRejected("by", Path.of("byclaw-user001/by"));
        assertExistingSymlinkRejected("auth", Path.of("byclaw-user001/by/.connector-auth"));
        assertExistingSymlinkRejected("provider", Path.of("byclaw-user001/by/.connector-auth/.github"));
    }

    @Test
    void resolveTightensOnlyCredentialDirectoriesToOwnerOnlyOnPosix() throws Exception {
        Assumptions.assumeTrue(
            Files.getFileStore(tempDir).supportsFileAttributeView(PosixFileAttributeView.class));
        Path storageRoot = tempDir.resolve("permission-root");
        Path byDirectory = storageRoot.resolve("byclaw-user001/by");
        Path authDirectory = byDirectory.resolve(".connector-auth");
        Path providerHome = authDirectory.resolve(".github");
        Files.createDirectories(providerHome);
        Set<PosixFilePermission> openPermissions = Set.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE,
            PosixFilePermission.OWNER_EXECUTE,
            PosixFilePermission.GROUP_READ,
            PosixFilePermission.GROUP_WRITE,
            PosixFilePermission.GROUP_EXECUTE,
            PosixFilePermission.OTHERS_READ,
            PosixFilePermission.OTHERS_WRITE,
            PosixFilePermission.OTHERS_EXECUTE);
        Set<PosixFilePermission> privatePermissions = Set.of(
            PosixFilePermission.OWNER_READ,
            PosixFilePermission.OWNER_WRITE,
            PosixFilePermission.OWNER_EXECUTE);
        Files.setPosixFilePermissions(byDirectory, openPermissions);
        Files.setPosixFilePermissions(authDirectory, openPermissions);
        Files.setPosixFilePermissions(providerHome, openPermissions);
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, storageRoot.toString());
        stubValidUserAndBucket();

        service.resolve(USER_ID, "github");

        assertThat(Files.getPosixFilePermissions(byDirectory)).isEqualTo(openPermissions);
        assertThat(Files.getPosixFilePermissions(authDirectory)).isEqualTo(privatePermissions);
        assertThat(Files.getPosixFilePermissions(providerHome)).isEqualTo(privatePermissions);
    }

    @Test
    void resolveRejectsInvalidUserIdAndProviderPathTraversal() {
        assertThatThrownBy(() -> service.resolve(null, "github"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.resolve(USER_ID, "../github"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.resolve(USER_ID, "GitHub"))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.resolve(USER_ID, " "))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void resolveWrapsDirectoryCreationFailure() throws Exception {
        Path storageFile = tempDir.resolve("storage-file");
        Files.writeString(storageFile, "not a directory");
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, storageFile.toString());
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(loginInfo("user001"));
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
    }

    private LoginInfo loginInfo(String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode);
        return loginInfo;
    }

    private void stubValidUserAndBucket() {
        when(loginApplicationService.getLoginInfo(USER_ID)).thenReturn(loginInfo("user001"));
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");
    }

    private void assertExistingSymlinkRejected(String caseName, Path relativeLink) throws Exception {
        Path storageRoot = tempDir.resolve("symlink-" + caseName + "-root");
        Path outside = tempDir.resolve("symlink-" + caseName + "-outside");
        Files.createDirectories(storageRoot);
        Files.createDirectories(outside);
        Path link = storageRoot.resolve(relativeLink);
        Files.createDirectories(link.getParent());
        Files.createSymbolicLink(link, outside);
        service = new ConnectorCredentialWorkspaceService(
            loginApplicationService, userBucketNamingService, storageRoot.toString());

        assertThatThrownBy(() -> service.resolve(USER_ID, "github"))
            .isInstanceOf(IllegalStateException.class);
    }
}
