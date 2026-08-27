package com.iwhalecloud.byai.manager.migration;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

class V032BaselineCompensationMigrationTest {

    @Test
    void insertsMissingPhaseExtractionPromptWithoutOverwritingCustomization() throws IOException {
        String sql = readMigration();

        assertThat(sql).contains(
            "'devloop_phase_extract_prompt'",
            "where not exists ( select 1 from byai.byai_system_config "
                + "where param_code = 'devloop_phase_extract_prompt' )"
        );
        assertThat(sql).doesNotContain(
            "delete from byai.byai_system_config where param_code in ('devloop_phase_extract_prompt')"
        );
    }

    @Test
    void removesRetiredDocTaggerDependenciesBeforeResourceByBusinessCode() throws IOException {
        String sql = readMigration();

        int privilegeDelete = sql.indexOf("delete from byai.au_privilege_grant");
        int extensionDelete = sql.indexOf("delete from byai.ss_res_ext_skill");
        int resourceDelete = sql.indexOf("delete from byai.ss_resource");

        assertThat(privilegeDelete).isGreaterThanOrEqualTo(0);
        assertThat(extensionDelete).isGreaterThan(privilegeDelete);
        assertThat(resourceDelete).isGreaterThan(extensionDelete);
        assertThat(sql).contains("resource_code = 'doc-tagger'");
        assertThat(sql).doesNotContain("resource_id in (24)", "grant_obj_id in (24)");
    }

    @Test
    void retainsKnowledgeCollectionAndDistinctByCliRepair() throws IOException {
        String sql = readMigration();

        assertThat(sql).contains(
            "resource_code = 'knowledge-collection'",
            "'bycli'",
            "resource_name = 'bycli'"
        );
    }

    @Test
    void separatesV031SuperSchemaStructureFromVersionSeedData() throws IOException {
        String ddl = read("deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql");
        String dml = read("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");

        assertThat(ddl).doesNotContain("insert into byai_super_schema_migrations");
        assertThat(dml).contains(
            "insert into byai.byai_super_schema_migrations",
            "select 9, 'run_ingress_context'"
        );
    }

    @Test
    void keepsV032CredentialStructureInDdlAndBackfillsInDml() throws IOException {
        String ddl = read("deploy/migrations/versions/V0.3.2/V0.3.2__ddl.sql");
        String dml = readMigration();

        assertThat(ddl).contains(
            "'credential_state', 'varchar(32) default ''unknown'' not null'",
            "'renewal_mode', 'varchar(32) default ''none'' not null'"
        );
        assertThat(dml).contains(
            "set access_expire_time = expire_time",
            "when 'dws-dingtalk' then 'refresh_token'",
            "when 'wecom-cli' then 'probe_only'"
        );
    }

    @Test
    void synchronizesSuperSchemaAndCurrentCompensationIntoInitdb() throws IOException {
        String ddl = read("deploy/middleware/initdb/02_ddl.sql");
        String dml = read("deploy/middleware/initdb/04_dml.sql");

        assertThat(ddl).contains(
            "create table if not exists byai_super_sessions",
            "create table if not exists byai_super_runs",
            "create table if not exists byai_super_agent_capability_cards",
            "'access_expire_time', 'timestamp'",
            "'credential_state', 'varchar(32) default ''unknown'' not null'"
        );
        assertThat(dml).contains(
            "insert into byai.byai_super_schema_migrations",
            "select 9, 'run_ingress_context'",
            "v0.3.2 增量数据"
        );
        assertThat(dml).doesNotContain("v0.5.0 增量数据");
    }

    private String readMigration() throws IOException {
        return read("deploy/migrations/versions/V0.3.2/V0.3.2__dml.sql");
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
