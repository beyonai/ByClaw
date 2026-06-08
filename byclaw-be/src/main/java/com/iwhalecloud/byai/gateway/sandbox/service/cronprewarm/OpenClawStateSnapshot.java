package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.nio.file.Path;

public class OpenClawStateSnapshot implements AutoCloseable {

    private final Path directory;

    private final Path databaseFile;

    private final boolean missingDatabase;

    private final boolean retainOnFailure;

    private boolean failed;

    private OpenClawStateSnapshot(Path directory, Path databaseFile, boolean missingDatabase, boolean retainOnFailure) {
        this.directory = directory;
        this.databaseFile = databaseFile;
        this.missingDatabase = missingDatabase;
        this.retainOnFailure = retainOnFailure;
    }

    public static OpenClawStateSnapshot missing() {
        return new OpenClawStateSnapshot(null, null, true, false);
    }

    public static OpenClawStateSnapshot present(Path directory, Path databaseFile, boolean retainOnFailure) {
        return new OpenClawStateSnapshot(directory, databaseFile, false, retainOnFailure);
    }

    public Path getDatabaseFile() {
        return databaseFile;
    }

    public boolean isMissingDatabase() {
        return missingDatabase;
    }

    public void markFailed() {
        failed = true;
    }

    @Override
    public void close() {
        if (directory != null && (!failed || !retainOnFailure)) {
            SnapshotFileUtils.deleteDirectoryQuietly(directory);
        }
    }
}
