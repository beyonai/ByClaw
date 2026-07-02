package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.UUID;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;

@Service
public class OpenClawStateSnapshotReader {

    private static final String WAL_SUFFIX = "-wal";

    private static final String SHM_SUFFIX = "-shm";

    private final SandboxCronPrewarmProperties properties;

    private final SandboxUserContextRunner userContextRunner;

    private final UserFS userFS;

    public OpenClawStateSnapshotReader(SandboxCronPrewarmProperties properties,
        SandboxUserContextRunner userContextRunner, UserFS userFS) {
        this.properties = properties;
        this.userContextRunner = userContextRunner;
        this.userFS = userFS;
    }

    public OpenClawStateSnapshot snapshot(String userCode) throws IOException {
        String sqliteFile = StringUtils.defaultIfBlank(properties.getSqliteFile(), "openclaw.sqlite");
        String stateDir = normalizeStateDir(properties.getStateDir());
        Path userSnapshotDir = Path.of(StringUtils.defaultIfBlank(properties.getSnapshotDir(),
            "/tmp/byclaw-cron-prewarm-snapshots"), userDirectoryName(userCode), UUID.randomUUID().toString());
        Files.createDirectories(userSnapshotDir);

        Path databaseFile = userSnapshotDir.resolve(sqliteFile);
        boolean copied = copyRequired(userCode, stateDir + "/" + sqliteFile, databaseFile);
        if (!copied) {
            SnapshotFileUtils.deleteDirectoryQuietly(userSnapshotDir);
            return OpenClawStateSnapshot.missing();
        }
        copyOptional(userCode, stateDir + "/" + sqliteFile + WAL_SUFFIX, userSnapshotDir.resolve(sqliteFile + WAL_SUFFIX));
        copyOptional(userCode, stateDir + "/" + sqliteFile + SHM_SUFFIX, userSnapshotDir.resolve(sqliteFile + SHM_SUFFIX));
        return OpenClawStateSnapshot.present(userSnapshotDir, databaseFile, properties.isSnapshotRetainOnFailure());
    }

    private boolean copyRequired(String userCode, String sourcePath, Path targetPath) throws IOException {
        for (int attempt = 1; attempt <= properties.normalizedSnapshotCopyRetry(); attempt++) {
            if (copyOnce(userCode, sourcePath, targetPath)) {
                return true;
            }
        }
        return false;
    }

    private void copyOptional(String userCode, String sourcePath, Path targetPath) throws IOException {
        copyOnce(userCode, sourcePath, targetPath);
    }

    private boolean copyOnce(String userCode, String sourcePath, Path targetPath) throws IOException {
        InputStream inputStream = userContextRunner.callAsUser(userCode, () -> {
            try {
                return userFS.read(sourcePath);
            }
            catch (RuntimeException e) {
                return null;
            }
        });
        if (inputStream == null) {
            return false;
        }
        try (InputStream source = inputStream) {
            Files.copy(source, targetPath, StandardCopyOption.REPLACE_EXISTING);
            return true;
        }
    }

    private String normalizeStateDir(String stateDir) {
        String value = StringUtils.defaultIfBlank(stateDir, "/.openclaw/state").trim();
        while (value.endsWith("/") && value.length() > 1) {
            value = value.substring(0, value.length() - 1);
        }
        return value;
    }

    private String userDirectoryName(String userCode) {
        return "user-" + sha256(userCode).substring(0, 16);
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(StringUtils.defaultString(value)
                .getBytes(StandardCharsets.UTF_8)));
        }
        catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 digest is unavailable", e);
        }
    }
}
