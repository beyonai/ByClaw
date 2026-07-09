package com.iwhalecloud.byai.manager.domain.resource.service;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class SsResExtDigEmployeeSchemaTest {

    @Test
    void migrationWidensMachineChannelForChannelConfigJson() throws IOException {
        Path repoRoot = findRepoRoot();
        Path ddl = repoRoot.resolve("deploy/migrations/versions/V0.2.0/V0.2.0__ddl.sql");

        String sql = Files.readString(ddl).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");

        assertThat(sql).contains("alter table byai.ss_res_ext_dig_employee alter column machine_channel type text");
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
