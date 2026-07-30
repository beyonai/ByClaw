package com.iwhalecloud.byai.manager.connector;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectorSchemaTest {

    @Test
    void connectorListQuerySelectsOneAuthorizationAndIgnoresExpiredEnablement() throws Exception {
        String sql = read("byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/connector/ConnectorInfoMapper.xml");

        assertThat(sql).contains("row_number() over");
        assertThat(sql).contains("partition by connector_id");
        assertThat(sql).contains("expire_time is null or expire_time > current_timestamp");
        assertThat(sql).contains("then 'y' else 'n' end");
    }

    @Test
    void connectorDdlDefinesReferentialIntegrityAndLookupIndexes() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql");

        assertThat(sql).contains("set search_path to byai;");
        assertThat(sql).contains("foreign key (connector_id)");
        assertThat(sql).contains("idx_byai_connector_auth_user_connector");
        assertThat(sql).contains("idx_byai_connector_info_status_sort");
    }

    @Test
    void connectorDdlIsIdempotentForUniqueConstraint() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql");

        assertThat(sql).contains("create unique index if not exists uk_byai_connector_info_code");
        assertThat(sql).doesNotContain("add constraint uk_byai_connector_info_code unique");
    }

    private String read(String relativePath) throws Exception {
        Path repoRoot = Path.of("").toAbsolutePath();
        while (repoRoot != null && !Files.exists(repoRoot.resolve("deploy/migrations/versions"))) {
            repoRoot = repoRoot.getParent();
        }
        assertThat(repoRoot).isNotNull();
        Path path = repoRoot.resolve(relativePath);
        return Files.readString(path).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }
}
