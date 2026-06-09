package com.iwhalecloud.byai.gateway.sandbox.service.cronprewarm;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Comparator;

final class SnapshotFileUtils {

    private SnapshotFileUtils() {
    }

    static void deleteDirectoryQuietly(Path directory) {
        try {
            if (!Files.exists(directory)) {
                return;
            }
            try (var paths = Files.walk(directory)) {
                paths.sorted(Comparator.reverseOrder())
                    .forEach(path -> {
                        try {
                            Files.deleteIfExists(path);
                        }
                        catch (IOException ignored) {
                        }
                    });
            }
        }
        catch (IOException ignored) {
        }
    }
}
