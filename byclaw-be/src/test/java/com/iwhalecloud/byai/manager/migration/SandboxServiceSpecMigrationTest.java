package com.iwhalecloud.byai.manager.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import org.junit.jupiter.api.Test;

/**
 * 校验已下线私网沙箱规格的禁用迁移 (Issue #286)。
 */
class SandboxServiceSpecMigrationTest {

    @Test
    void disablesUnreachablePrivateSandboxSpecsInV060Dml() throws IOException {
        String dml = read("deploy/migrations/versions/V0.6.0/V0.6.0__dml.sql");
        assertThat(dml).contains(
            "update byai.sandbox_service_spec set enabled = 0 where service_key in ('uiagent', 'byclaw-code-agent')"
        );
    }

    private String read(String relativePath) throws IOException {
        return Files.readString(findRepoRoot().resolve(relativePath))
            .toLowerCase(Locale.ROOT)
            .replaceAll("\\s+", " ")
            .trim();
    }

    private Path findRepoRoot() {
        Path path = Path.of("").toAbsolutePath();
        while (path != null && !Files.exists(path.resolve("deploy/migrations/versions"))) {
            path = path.getParent();
        }
        if (path == null) {
            throw new IllegalStateException("Cannot locate repository root");
        }
        return path;
    }
}
