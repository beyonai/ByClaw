package com.iwhalecloud.byai.manager.migration;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import org.junit.jupiter.api.Test;

class DraftSessionProjectIndexMigrationTest {

    @Test
    void addsAPartialIndexForCheckingWhetherAUserQuestionExists() throws IOException {
        assertIndex(read("deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql"));
        assertIndex(read("deploy/migrations/versions/V0.6.0/tenant/V0.6.0__baseline__ddl.sql"));
        assertIndex(read("deploy/middleware/initdb/02_ddl.sql"));
    }

    private void assertIndex(String sql) {
        assertThat(sql).contains(
            "create index if not exists idx_byai_message_user_question_session",
            "on byai.byai_message (session_id) where usage = 1"
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
        if (path == null) throw new IllegalStateException("Cannot locate repository root");
        return path;
    }
}
