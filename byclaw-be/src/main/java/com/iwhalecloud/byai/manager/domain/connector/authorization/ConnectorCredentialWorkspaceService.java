package com.iwhalecloud.byai.manager.domain.connector.authorization;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFileAttributeView;
import java.nio.file.attribute.PosixFilePermission;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;

@Service
public class ConnectorCredentialWorkspaceService {

    private static final Pattern PROVIDER_CODE_PATTERN = Pattern.compile("[a-z0-9-]+");
    private static final Pattern BUCKET_PATTERN = Pattern.compile("[a-z0-9][a-z0-9-]{1,61}[a-z0-9]");
    private static final Set<PosixFilePermission> PRIVATE_DIRECTORY_PERMISSIONS = Set.of(
        PosixFilePermission.OWNER_READ,
        PosixFilePermission.OWNER_WRITE,
        PosixFilePermission.OWNER_EXECUTE);

    private final LoginApplicationService loginApplicationService;
    private final UserBucketNamingService userBucketNamingService;
    private final Path configuredStorageRoot;

    public ConnectorCredentialWorkspaceService(
        LoginApplicationService loginApplicationService,
        UserBucketNamingService userBucketNamingService,
        @Value("${file.storage.local.path:${byclaw.sandbox.volume.file-root:/tmp/byclaw-storage}}")
        String fileStorageRoot) {
        this.loginApplicationService = loginApplicationService;
        this.userBucketNamingService = userBucketNamingService;
        if (fileStorageRoot == null || fileStorageRoot.isBlank()) {
            throw new IllegalArgumentException("fileStorageRoot must not be blank");
        }
        try {
            this.configuredStorageRoot = Path.of(fileStorageRoot).toAbsolutePath().normalize();
        } catch (InvalidPathException e) {
            throw new IllegalArgumentException("fileStorageRoot is invalid");
        }
    }

    public ConnectorCliWorkspace resolve(Long userId, String providerCode) {
        if (userId == null || userId <= 0) {
            throw new IllegalArgumentException("userId must be positive");
        }
        if (providerCode == null || !PROVIDER_CODE_PATTERN.matcher(providerCode).matches()) {
            throw new IllegalArgumentException("providerCode must match [a-z0-9-]+");
        }

        LoginInfo loginInfo;
        try {
            loginInfo = loginApplicationService.getLoginInfo(userId);
        } catch (RuntimeException e) {
            throw new IllegalStateException("Unable to resolve login information for userId " + userId, e);
        }
        if (loginInfo == null || loginInfo.getUserCode() == null || loginInfo.getUserCode().isBlank()) {
            throw new IllegalStateException("Unable to resolve login information for userId " + userId);
        }

        String bucket;
        try {
            bucket = userBucketNamingService.buildUserBucketName(loginInfo.getUserCode());
        } catch (RuntimeException e) {
            throw new IllegalStateException("Unable to resolve credential bucket for userId " + userId, e);
        }
        if (bucket == null || !BUCKET_PATTERN.matcher(bucket).matches()) {
            throw new IllegalStateException("Unable to resolve credential bucket for userId " + userId);
        }

        try {
            Path trustedRoot = trustedStorageRoot();
            Path bucketDirectory = secureDirectory(trustedRoot, bucket, trustedRoot, userId);
            Path byDirectory = secureDirectory(bucketDirectory, "by", trustedRoot, userId);
            Path authDirectory = secureDirectory(byDirectory, ".connector-auth", trustedRoot, userId);
            Path home = secureDirectory(authDirectory, "." + providerCode, trustedRoot, userId);
            applyPrivatePermissions(authDirectory);
            applyPrivatePermissions(home);
            Path realHome = home.toRealPath();
            if (!realHome.startsWith(trustedRoot)) {
                throw new IllegalStateException("Credential workspace escapes storage root for userId " + userId);
            }
            return new ConnectorCliWorkspace(realHome, Map.of("HOME", realHome.toString()));
        } catch (IOException | SecurityException e) {
            throw new IllegalStateException("Unable to create credential workspace for userId " + userId, e);
        }
    }

    private Path trustedStorageRoot() throws IOException {
        Files.createDirectories(configuredStorageRoot);
        Path realRoot = configuredStorageRoot.toRealPath();
        if (!Files.isDirectory(realRoot, LinkOption.NOFOLLOW_LINKS)) {
            throw new IOException("Configured storage root is not a directory");
        }
        return realRoot;
    }

    private Path secureDirectory(Path parent, String segment, Path trustedRoot, Long userId) throws IOException {
        Path directory = parent.resolve(segment).normalize();
        if (!directory.startsWith(trustedRoot)) {
            throw new IllegalStateException("Credential workspace escapes storage root for userId " + userId);
        }
        rejectSymlink(directory, userId);
        if (Files.exists(directory, LinkOption.NOFOLLOW_LINKS)) {
            if (!Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)) {
                throw new IOException("Credential workspace component is not a directory");
            }
        } else {
            Files.createDirectory(directory);
        }
        rejectSymlink(directory, userId);
        Path realDirectory = directory.toRealPath();
        if (!realDirectory.startsWith(trustedRoot)) {
            throw new IllegalStateException("Credential workspace escapes storage root for userId " + userId);
        }
        return realDirectory;
    }

    private void rejectSymlink(Path path, Long userId) {
        if (Files.isSymbolicLink(path)) {
            throw new IllegalStateException("Credential workspace contains a symbolic link for userId " + userId);
        }
    }

    private void applyPrivatePermissions(Path directory) throws IOException {
        PosixFileAttributeView posixView = Files.getFileAttributeView(
            directory,
            PosixFileAttributeView.class,
            LinkOption.NOFOLLOW_LINKS);
        if (posixView != null) {
            Files.setPosixFilePermissions(directory, PRIVATE_DIRECTORY_PERMISSIONS);
        }
    }

    public record ConnectorCliWorkspace(Path home, Map<String, String> environment) {

        public ConnectorCliWorkspace {
            Objects.requireNonNull(home, "home");
            environment = Map.copyOf(environment);
        }
    }
}
