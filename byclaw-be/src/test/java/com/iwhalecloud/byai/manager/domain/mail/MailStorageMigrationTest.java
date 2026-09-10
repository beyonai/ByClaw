package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class MailStorageMigrationTest {
    @Test
    void v050OnlyConfiguresConnectorsAndInitializesRowsBeforeUpdatingConfiguration() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        if (!Files.isDirectory(root.resolve("deploy"))) root = root.getParent();
        Path version = root.resolve("deploy/migrations/versions/V0.5.0");
        assertThat(Files.exists(version.resolve("V0.5.0__ddl.sql"))).isFalse();
        String sql = Files.readString(version.resolve("V0.5.0__dml.sql"));
        assertThat(sql).doesNotContain("po_user_mail_account", "ALTER TABLE", "DROP TABLE");
        assertThat(sql.indexOf("INSERT INTO byai.byai_connector_info"))
            .isLessThan(sql.indexOf("UPDATE byai.byai_connector_info"));
        for (String code : new String[]{"gmail-mail", "microsoft-mail", "qq-mail", "netease-163-mail",
                "aliyun-mail", "fastmail-mail", "custom-imap-mail"}) {
            assertThat(sql).contains(code);
        }
    }

    @Test
    void productionSourcesHaveNoOldMailTableMapperOrTableDependency() throws Exception {
        Path sources = Path.of("src/main");
        if (!Files.isDirectory(sources)) sources = Path.of("byclaw-be/src/main");
        try (var paths = Files.walk(sources)) {
            for (Path file : paths.filter(Files::isRegularFile)
                    .filter(path -> path.toString().endsWith(".java") || path.toString().endsWith(".xml")).toList()) {
                assertThat(Files.readString(file)).as(file.toString())
                    .doesNotContain("po_user_mail_account", "UserMailAccountMapper");
            }
        }
    }
}
