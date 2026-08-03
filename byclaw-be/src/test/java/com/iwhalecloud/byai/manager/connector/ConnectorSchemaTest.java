package com.iwhalecloud.byai.manager.connector;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

class ConnectorSchemaTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final Pattern WECOM_SEED_ROW = Pattern.compile(
        "SELECT\\s+'wecom'\\s*,\\s*'企业微信'\\s*,\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*,\\s*'([^']*)'\\s*,"
            + "\\s*'([^']*)'\\s*,\\s*'([^']*)'(?:\\s+AS\\s+auth_config)?\\s*,"
            + "\\s*'([^']*)'(?:\\s+AS\\s+runtime_manifest)?\\s*,"
            + "\\s*30",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );
    private static final String EXPECTED_WECOM_DESCRIPTION = "通过 wecom-cli 连接企业微信工作空间";
    private static final String EXPECTED_WECOM_AUTH_CONFIG = """
        {"authorizationTimeoutSeconds":120,"probeCommand":["wecom-cli","contact","get_userlist","{}"]}
        """;
    private static final String EXPECTED_WECOM_RUNTIME_MANIFEST = """
        {"authStorage":{"environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.wecom-cli","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"wecom","runtime":{"authorizeIn":"be-auth-job","commands":{"login":["wecom-cli","init","--noninteractive","--no-open"],"logout":["wecom-cli","cache","clear"],"status":["wecom-cli","cache","status"]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"wecomcli","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"0.1.9"}
        """;

    @Test
    void connectorListQueryUsesEnableFlagWithoutExpirationJudgement() throws Exception {
        String sql = read("byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/connector/ConnectorInfoMapper.xml");

        assertThat(sql).contains("row_number() over");
        assertThat(sql).contains("partition by connector_id");
        assertThat(sql).contains("when enable_flag = 'y' then 0 else 1 end");
        assertThat(sql).contains("then 'y' else 'n' end");
        assertThat(sql).doesNotContain("expire_time is null or expire_time > current_timestamp");
    }

    @Test
    void enabledConnectorMetadataQueryReturnsOnlyAuthorizedConnectorsWithoutExpirationJudgement() throws Exception {
        String sql = read("byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/connector/ConnectorAuthMapper.java");

        assertThat(sql).contains("inner join (");
        assertThat(sql).doesNotContain("left join (");
        assertThat(sql).contains("auth.enable_flag = 'y'");
        assertThat(sql).contains("info.skill_code");
        assertThat(sql).doesNotContain("info.runtime_manifest");
        assertThat(sql).doesNotContain("auth.expire_time");
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
        assertThat(sql).contains("skill_code varchar(64)");
        assertThat(sql).contains("comment on column byai.byai_connector_info.provider_code");
        assertThat(sql).contains("comment on column byai.byai_connector_info.skill_code");
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
    void connectorWriteMappersUseOpenGaussCompatibleMergeInsteadOfPostgresOnConflict() throws Exception {
        String authSql = read("byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/connector/ConnectorAuthMapper.java");
        String manifestSql = read("byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/users/UserPrivateParamMapper.java");

        assertThat(authSql).contains("merge into byai_connector_auth");
        assertThat(authSql).doesNotContain("on conflict");
        assertThat(manifestSql).contains("merge into po_user_private_param");
        assertThat(manifestSql).doesNotContain("on conflict");
    }

    @Test
    void connectorManagedParametersAllowMultipleKeysPerConnector() throws Exception {
        String migrationSql = read("deploy/migrations/versions/V0.3.1/V0.3.1__ddl.sql");
        String baseMigrationSql = read("deploy/migrations/versions/V0.2.0/V0.2.0__ddl.sql");
        String initdbSql = read("deploy/middleware/initdb/02_ddl.sql");

        assertThat(migrationSql).contains("drop index if exists byai.uk_po_user_private_param_connector");
        assertThat(migrationSql).contains(
            "on byai.po_user_private_param (user_id, param_source, source_ref, param_key)");
        assertThat(initdbSql).contains(
            "on byai.po_user_private_param (user_id, param_source, source_ref, param_key)");
        assertThat(baseMigrationSql).contains("on byai.po_user_private_param (user_id, param_key)");
        assertThat(initdbSql).contains("on byai.po_user_private_param (user_id, param_key)");
        assertThat(migrationSql).doesNotContain("同一用户、同一连接器仅保留一份");
        assertThat(initdbSql).doesNotContain("同一用户、同一连接器仅保留一份");
    }

    @Test
    void providerRoutingDmlUsesSequenceAndDefinesProviderMappings() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");

        assertThat(sql).contains("nextval('byai.seq_any_table')");
        assertThat(sql).doesNotContain("max(connector_id)");
        assertThat(sql).contains("dws-dingtalk", "lark-cli", "wecom-cli");
        assertThat(sql).contains("device_flow", "cli_init");
    }

    @Test
    void connectorSeedDisablesConnectorsOutsideSupportedCodes() throws Exception {
        String migrationSql = read("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = read("deploy/middleware/initdb/04_dml.sql");
        String disableUnsupportedConnectors =
            "update byai.byai_connector_info set status_cd = '00x', update_time = current_timestamp";

        assertThat(migrationSql).doesNotContain(disableUnsupportedConnectors);
        assertThat(initdbSql).doesNotContain(disableUnsupportedConnectors);
    }

    @Test
    void bundledSkillUpdatesIgnoreJsonWhitespaceWhenCheckingExistingSkills() throws Exception {
        String migrationSql = read("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = read("deploy/middleware/initdb/04_dml.sql");
        String normalizedJson = "regexp_replace(c.param_value, '\\s', '', 'g')";

        for (String sql : new String[] {migrationSql, initdbSql}) {
            assertThat(sql).contains(
                normalizedJson + " not like '%\"skillcode\":\"knowledge-collection\"%'",
                normalizedJson + " not like '%\"skillcode\":\"agent-reach\"%'",
                normalizedJson + " not like '%\"skillcode\":\"bycli\"%'"
            );
        }
    }

    @Test
    void backendImagePinsAndVerifiesWecomCli() throws Exception {
        String dockerfile = readPreservingCase("byclaw-be/Dockerfile");

        assertThat(dockerfile).contains(
            "ARG LARKSUITE_CLI_VERSION=1.0.78",
            "ARG WECOM_CLI_VERSION=0.1.9",
            "@larksuite/cli@${LARKSUITE_CLI_VERSION}",
            "@wecom/cli@${WECOM_CLI_VERSION}",
            "lark-cli --version",
            "wecom-cli --version",
            "npm cache clean --force",
            "ARG DWS_VERSION=1.0.52",
            "/home/appuser/.local/bin/dws --version",
            "DWS_NO_SKILLS=1",
            "DWS_DISABLE_KEYCHAIN=1"
        );
        assertThat(dockerfile).containsOnlyOnce("RUN npm install --global");
    }

    @Test
    void wecomSeedPublishesEquivalentCliConfigAndManifestForUpgradeAndFreshInstall() throws Exception {
        String migrationSql = readPreservingCase("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = readPreservingCase("deploy/middleware/initdb/04_dml.sql");
        ConnectorSeed migrationSeed = extractWecomSeed(migrationSql);
        ConnectorSeed initdbSeed = extractWecomSeed(initdbSql);

        assertWecomProductionSeed(migrationSeed);
        assertWecomProductionSeed(initdbSeed);
        assertThat(migrationSeed).isEqualTo(initdbSeed);

        assertThat(migrationSql).contains("WHERE existing.connector_code = seed.connector_code");
        assertThat(initdbSql).contains("WHERE existing.connector_code = seed.connector_code");
        assertThat(migrationSql).doesNotContain("企业微信授权能力即将开放", "runtime_manifest = NULL");
        assertThat(initdbSql).doesNotContain("企业微信授权能力即将开放");
    }

    @Test
    void builtInConnectorManifestsUseGloballyUniqueEnvironmentKeys() throws Exception {
        String migrationSql = readPreservingCase("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = readPreservingCase("deploy/middleware/initdb/04_dml.sql");
        Map<String, Set<String>> expected = Map.of(
            "dingtalk", Set.of("DWS_HOME", "DWS_CONFIG_DIR", "DWS_DISABLE_KEYCHAIN"),
            "lark", Set.of("LARK_HOME"),
            "wecom", Set.of("WECOM_HOME")
        );
        Set<String> allKeys = new LinkedHashSet<>();

        for (Map.Entry<String, Set<String>> entry : expected.entrySet()) {
            JsonNode manifest = parseJson(extractSeedManifest(migrationSql, entry.getKey()));
            Set<String> keys = new LinkedHashSet<>();
            manifest.path("authStorage").path("environment").fieldNames().forEachRemaining(keys::add);
            assertThat(keys).containsExactlyInAnyOrderElementsOf(entry.getValue());
            for (String key : keys) {
                assertThat(allKeys.add(key)).as("duplicate environment key " + key).isTrue();
                assertThat(initdbSql).contains("\"" + key + "\"");
            }
        }

        assertThat(allKeys).hasSize(5);
        assertThat(migrationSql).doesNotContain("\"environment\":{\"HOME\"");
        assertThat(initdbSql).doesNotContain("\"environment\":{\"HOME\"");
    }

    private void assertWecomProductionSeed(ConnectorSeed seed) throws Exception {
        assertThat(seed.description()).isEqualTo(EXPECTED_WECOM_DESCRIPTION);
        assertThat(seed.providerCode()).isEqualTo("wecom-cli");
        assertThat(seed.skillCode()).isEqualTo("wecomcli");
        assertThat(seed.authMode()).isEqualTo("CLI_INIT");
        assertThat(parseJson(seed.authConfig())).isEqualTo(parseJson(EXPECTED_WECOM_AUTH_CONFIG));
        assertThat(parseJson(seed.runtimeManifest())).isEqualTo(parseJson(EXPECTED_WECOM_RUNTIME_MANIFEST));
    }

    private ConnectorSeed extractWecomSeed(String sql) {
        return extractConnectorSeed(sql, WECOM_SEED_ROW, "WeCom seed row");
    }

    private String extractSeedManifest(String sql, String connectorCode) {
        Pattern pattern = Pattern.compile(
            "SELECT\\s+'" + Pattern.quote(connectorCode) + "'(?:(?!\\bSELECT\\s+').)*?"
                + "'([^']*)'(?:\\s+AS\\s+runtime_manifest)?\\s*,\\s*(?:10|20|30)",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL
        );
        Matcher matcher = pattern.matcher(sql);
        assertThat(matcher.find()).as(connectorCode + " runtime Manifest seed").isTrue();
        return matcher.group(1);
    }

    private ConnectorSeed extractConnectorSeed(String sql, Pattern pattern, String label) {
        Matcher matcher = pattern.matcher(sql);
        assertThat(matcher.find()).as(label).isTrue();
        ConnectorSeed seed = new ConnectorSeed(
            matcher.group(1), matcher.group(2), matcher.group(3), matcher.group(4), matcher.group(5), matcher.group(6)
        );
        assertThat(matcher.find()).as(label + " must be unique").isFalse();
        return seed;
    }

    private JsonNode parseJson(String json) throws Exception {
        return OBJECT_MAPPER.readTree(json);
    }

    private String read(String relativePath) throws Exception {
        return readPreservingCase(relativePath).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private String readPreservingCase(String relativePath) throws Exception {
        Path repoRoot = Path.of("").toAbsolutePath();
        while (repoRoot != null && !Files.exists(repoRoot.resolve("deploy/migrations/versions"))) {
            repoRoot = repoRoot.getParent();
        }
        assertThat(repoRoot).isNotNull();
        Path path = repoRoot.resolve(relativePath);
        return Files.readString(path);
    }

    private record ConnectorSeed(
        String description,
        String providerCode,
        String skillCode,
        String authMode,
        String authConfig,
        String runtimeManifest
    ) {
    }
}
