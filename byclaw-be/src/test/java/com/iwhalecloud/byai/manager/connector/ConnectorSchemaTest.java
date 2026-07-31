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

    @Test
    void providerRoutingDdlDefinesAndDocumentsMetadata() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql");

        assertThat(sql).contains("provider_code varchar(64)");
        assertThat(sql).contains("comment on column byai.byai_connector_info.provider_code");
        assertThat(sql).contains("comment on column byai.byai_connector_info.auth_mode");
        assertThat(sql).contains("device_flow", "cli_init");
    }

    @Test
    void connectorAuthorizationDdlUniquelyConstrainsOnlyActiveUserConnectorBindings() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql");

        assertThat(sql).contains(
            "row_number() over",
            "partition by user_id, connector_id",
            "order by case when enable_flag = 'y' and (expire_time is null or expire_time > current_timestamp) "
                + "then 0 else 1 end asc, update_time desc nulls last, create_time desc nulls last, "
                + "auth_id desc nulls last",
            "update byai.byai_connector_auth as duplicate_auth",
            "set status_cd = '00x', enable_flag = 'n', update_time = current_timestamp",
            "from ranked_active_authorizations as ranked",
            "duplicate_auth.auth_id = ranked.auth_id",
            "ranked.row_num > 1"
        );
        assertThat(sql).contains(
            "create unique index if not exists uk_byai_connector_auth_active_user_connector",
            "on byai.byai_connector_auth (user_id, connector_id)",
            "where status_cd = '00a'"
        );
        assertThat(sql).doesNotContain("on byai.byai_connector_auth (user_id, connector_id, status_cd)");
        assertThat(sql).doesNotContain("delete from byai.byai_connector_auth");
        assertThat(sql.indexOf("with ranked_active_authorizations")).isLessThan(
            sql.indexOf("create unique index if not exists uk_byai_connector_auth_active_user_connector")
        );
    }

    @Test
    void providerRoutingDmlUsesSequenceAndDefinesProviderMappings() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");

        assertThat(sql).contains("nextval('byai.seq_any_table')");
        assertThat(sql).doesNotContain("max(connector_id)");
        assertThat(sql).contains("dws-dingtalk", "lark-cli", "wecom-cli");
        assertThat(sql).contains("device_flow", "cli_init");
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
