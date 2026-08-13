package com.iwhalecloud.byai.manager.connector;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.Date;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;

import com.alibaba.fastjson.JSON;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.config.JacksonConfig;
import com.iwhalecloud.byai.manager.dto.connector.ConnectorListDto;
@DisabledOnOs(OS.WINDOWS)
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
        {"authorizationTimeoutSeconds":120}
        """;
    private static final String EXPECTED_WECOM_RUNTIME_MANIFEST = """
        {"authStorage":{"environment":{"WECOM_HOME":"/by/.connector-auth/.wecom-cli"},"lock":"exclusive-per-instance","mode":"native-home","nativePath":"/by/.connector-auth/.wecom-cli","owner":"be-auth-job","runtimeMutation":"provider-refresh-only"},"id":"wecom","runtime":{"authorizeIn":"be-auth-job","commands":{"login":[["wecom-cli","init","--noninteractive","--no-open"]],"logout":[["wecom-cli","cache","clear"]],"status":[["wecom-cli","cache","status"],["wecom-cli","contact","get_userlist","{}"]]},"type":"cli"},"schemaVersion":"1.0","skill":{"code":"wecomcli","grantScope":"agent","installScope":"user","source":"system-builtin"},"version":"0.1.9"}
        """;

    @Test
    void connectorListQueryExposesCredentialLifecycleWithoutDisablingExpiredAccessTokens() throws Exception {
        String sql = read("byclaw-be/src/main/resources/com/iwhalecloud/byai/manager/mapper/connector/ConnectorInfoMapper.xml");

        assertThat(sql).contains("row_number() over");
        assertThat(sql).contains("partition by connector_id");
        assertThat(sql).contains("when enable_flag = 'y' then 0 else 1 end");
        assertThat(sql).contains("<result column=\"credential_expires_at\" property=\"credentialexpiresat\"/>");
        assertThat(sql).contains("<result column=\"credential_state\" property=\"credentialstate\"/>");
        assertThat(sql).contains("<result column=\"renewal_mode\" property=\"renewalmode\"/>");
        assertThat(sql).contains("<result column=\"access_expires_at\" property=\"accessexpiresat\"/>");
        assertThat(sql).contains("<result column=\"refresh_expires_at\" property=\"refreshexpiresat\"/>");
        assertThat(sql).contains("<result column=\"last_verified_at\" property=\"lastverifiedat\"/>");
        assertThat(sql).contains("b.access_expire_time as credential_expires_at");
        assertThat(sql).contains(
            "case when b.connector_id is null then null when b.enable_flag = 'y' "
                + "and coalesce(b.credential_state, 'unknown') "
                + "in ('ready', 'refresh_needed', 'expiring', 'unknown') then 'y' else 'n' end as enable_flag"
        );
        assertThat(connectorAuthorizationSubquery(
            sql, "left join (", ") b on a.connector_id = b.connector_id"))
                .contains("credential_state", "renewal_mode", "access_expire_time", "refresh_expire_time", "last_verified_at")
                .doesNotContain("expire_time <", "access_expire_time <", "refresh_expire_time <");
    }

    @Test
    void enabledConnectorMetadataQueryUsesCredentialStateInsteadOfAccessExpiration() throws Exception {
        String sql = read("byclaw-be/src/main/java/com/iwhalecloud/byai/manager/mapper/connector/ConnectorAuthMapper.java");

        assertThat(sql).contains("left join (");
        assertThat(sql).doesNotContain("inner join (");
        assertThat(sql).contains("info.skill_code");
        assertThat(sql).doesNotContain("info.runtime_manifest");
        assertThat(sql).contains(
            "case when auth.connector_id is null then false when auth.enable_flag = 'y' "
                + "and coalesce(auth.credential_state, 'unknown') "
                + "in ('ready', 'refresh_needed', 'expiring', 'unknown') then true "
                + "else false end as enabled"
        );
        assertThat(connectorAuthorizationSubquery(
            sql, "left join (", ") auth on auth.connector_id = info.connector_id"))
                .contains(
                    "select connector_id, enable_flag, credential_state from (",
                    "select connector_id, enable_flag, credential_state, row_number() over"
                )
                .doesNotContain("expire_time <", "access_expire_time <", "refresh_expire_time <");
    }

    @Test
    void connectorListDtoExposesCredentialExpirationAsDate() {
        Date expiration = new Date(1_000L);
        ConnectorListDto dto = new ConnectorListDto();

        dto.setCredentialExpiresAt(expiration);
        dto.setAccessExpiresAt(expiration);
        dto.setRefreshExpiresAt(expiration);
        dto.setCredentialState("READY");
        dto.setRenewalMode("REFRESH_TOKEN");
        dto.setLastVerifiedAt(expiration);

        assertThat(dto.getCredentialExpiresAt()).isEqualTo(expiration);
        assertThat(dto.getAccessExpiresAt()).isEqualTo(expiration);
        assertThat(dto.getRefreshExpiresAt()).isEqualTo(expiration);
        assertThat(dto.getCredentialState()).isEqualTo("READY");
        assertThat(dto.getRenewalMode()).isEqualTo("REFRESH_TOKEN");
        assertThat(dto.getLastVerifiedAt()).isEqualTo(expiration);
    }

    @Test
    void connectorCredentialLifecycleMigrationAddsMetadataWithoutPersistingTokens() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.2/V0.3.2__ddl.sql");

        assertThat(sql).contains(
            "'access_expire_time', 'timestamp'",
            "'refresh_expire_time', 'timestamp'",
            "'credential_state', 'varchar(32)'",
            "'renewal_mode', 'varchar(32)'",
            "'last_verified_at', 'timestamp'",
            "set access_expire_time = expire_time"
        );
        assertThat(sql).doesNotContain(
            "'byai_connector_auth', 'access_token'",
            "'byai_connector_auth', 'refresh_token'"
        );
    }

    @Test
    void userMcpMigrationAddsInstanceRevisionAndSnapshotContracts() throws Exception {
        String ddl = read("deploy/migrations/versions/V0.4.0/V0.4.0__ddl.sql").toLowerCase(Locale.ROOT);
        String dml = read("deploy/migrations/versions/V0.4.0/V0.4.0__dml.sql").toLowerCase(Locale.ROOT);

        assertThat(ddl).contains(
            "'resource_id', 'bigint'",
            "'instance_key', 'varchar(160) default ''default'' not null'",
            "'definition_revision', 'bigint default 1 not null'",
            "'endpoint_fingerprint', 'varchar(128)'",
            "drop index if exists byai.uk_byai_connector_auth_active_user_connector",
            "on byai.byai_connector_auth (user_id, connector_id, instance_key)",
            "where status_cd = '00a'",
            "uk_ss_resource_personal_mcp_owner_code",
            "create table if not exists byai.byai_user_mcp_tool_snapshot",
            "unique (resource_id, snapshot_version, tool_name)",
            "alter table byai.ss_res_ext_mcp"
        );
        assertThat(dml).contains(
            "'user-mcp'",
            "'instance_defined'",
            "'byai_mcp_allowed_addresses'",
            "'byai_mcp_read_tool_rules'",
            "where not exists"
        );
        assertThat(ddl).doesNotContain("access_token", "refresh_token");
        assertThat(dml).doesNotContain("authorization", "cookie", "api_key");
        assertThat(Files.exists(repoPath("deploy/migrations/versions/V0.6.1"))).isFalse();
    }

    @Test
    void connectorCredentialExpirationUsesGmt8IsoOffsetWithProjectJacksonConfig() throws Exception {
        ConnectorListDto dto = connectorListWithFixedExpiration();
        ObjectMapper objectMapper = new JacksonConfig().objectMapper(new Jackson2ObjectMapperBuilder());
        objectMapper.setTimeZone(TimeZone.getTimeZone("UTC"));

        JsonNode json = objectMapper.readTree(objectMapper.writeValueAsString(dto));

        assertThat(json.path("credentialExpiresAt").asText()).isEqualTo("2026-08-10T12:30:00+08:00");
    }

    @Test
    void connectorCredentialExpirationUsesGmt8IsoOffsetWithFastJson() throws Exception {
        TimeZone originalTimeZone = JSON.defaultTimeZone;
        try {
            JSON.defaultTimeZone = TimeZone.getTimeZone("UTC");

            JsonNode json = OBJECT_MAPPER.readTree(JSON.toJSONString(connectorListWithFixedExpiration()));

            assertThat(json.path("credentialExpiresAt").asText()).isEqualTo("2026-08-10T12:30:00+08:00");
        }
        finally {
            JSON.defaultTimeZone = originalTimeZone;
        }
    }

    @Test
    void connectorCredentialExpirationUsesGmt8IsoOffsetWithFastJson2() throws Exception {
        com.alibaba.fastjson2.JSONWriter.Context context = com.alibaba.fastjson2.JSONFactory.createWriteContext();
        context.setZoneId(java.time.ZoneOffset.UTC);

        String serialized = com.alibaba.fastjson2.JSON.toJSONString(connectorListWithFixedExpiration(), context);
        JsonNode json = OBJECT_MAPPER.readTree(serialized);

        assertThat(json.path("credentialExpiresAt").asText()).isEqualTo("2026-08-10T12:30:00+08:00");
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
            "order by case when enable_flag = 'y' then 0 else 1 end asc, update_time desc nulls last, "
                + "create_time desc nulls last, "
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
        assertThat(sql).doesNotContain("expire_time is null or expire_time > current_timestamp");
        assertThat(sql.indexOf("with ranked_active_authorizations")).isLessThan(
            sql.indexOf("create unique index if not exists uk_byai_connector_auth_active_user_connector")
        );
    }

    @Test
    void refreshLifecycleDdlRepairsLegacyActiveDuplicatesBeforeReassertingTheUniqueIndex() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.2/V0.3.2__ddl.sql").toLowerCase(Locale.ROOT);

        assertThat(sql).contains(
            "with ranked_active_authorizations",
            "partition by user_id, connector_id",
            "update byai.byai_connector_auth as duplicate_auth",
            "set status_cd = '00x',",
            "ranked.row_num > 1",
            "create unique index if not exists uk_byai_connector_auth_active_user_connector",
            "where status_cd = '00a'"
        );
        assertThat(sql.indexOf("with ranked_active_authorizations")).isLessThan(
            sql.indexOf("create unique index if not exists uk_byai_connector_auth_active_user_connector")
        );
    }

    @Test
    void refreshLifecycleDdlBackfillsLarkAsARefreshTokenConnector() throws Exception {
        String sql = read("deploy/migrations/versions/V0.3.2/V0.3.2__ddl.sql").toLowerCase(Locale.ROOT);

        assertThat(sql).contains("when 'lark-cli' then 'refresh_token'");
    }

    @Test
    void connectorCacheUsesExistingAuthoritativeTablesWithoutRefreshTaskDdl() throws Exception {
        String initdbSql = read("deploy/middleware/initdb/02_ddl.sql");

        assertThat(initdbSql).doesNotContain("byai_connector_cache_refresh_task");
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
    void bundledSkillUpdatesRepairDoubleEscapedAcpQuotes() throws Exception {
        String migrationSql = read("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = read("deploy/middleware/initdb/04_dml.sql");
        String doubleEscapedAcp =
            "chr(92) || chr(92) || chr(34) || 'acp' || chr(92) || chr(92) || chr(34)";
        String escapedAcp = "chr(92) || chr(34) || 'acp' || chr(92) || chr(34)";

        for (String sql : new String[] {migrationSql, initdbSql}) {
            assertThat(sql).contains("replace(c.param_value", doubleEscapedAcp, escapedAcp);
        }
    }

    @Test
    void backendImagePinsAndVerifiesWecomCli() throws Exception {
        String dockerfile = readPreservingCase("byclaw-be/Dockerfile");

        assertThat(dockerfile).contains(
            "ARG LARKSUITE_CLI_VERSION=1.0.85",
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
        assertThat(dockerfile)
            .containsOnlyOnce("@larksuite/cli@${LARKSUITE_CLI_VERSION}")
            .containsOnlyOnce("@wecom/cli@${WECOM_CLI_VERSION}");
    }

    @Test
    void wecomSeedPublishesEquivalentCliConfigAndManifestForUpgradeAndFreshInstall() throws Exception {
        String migrationSql = readPreservingCase("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = readPreservingCase("deploy/middleware/initdb/04_dml.sql");
        ConnectorSeed initdbSeed = extractWecomSeed(initdbSql);

        assertWecomProductionSeed(initdbSeed);
        assertThat(parseJson(extractUpgradeManifest(migrationSql, "wecom")))
            .isEqualTo(parseJson(initdbSeed.runtimeManifest()));

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

    @Test
    void builtInConnectorManifestCommandsAreTwoDimensionalAndCoverProviderStages() throws Exception {
        String migrationSql = readPreservingCase("deploy/middleware/initdb/04_dml.sql");
        for (String connectorCode : new String[] {"dingtalk", "lark", "wecom"}) {
            JsonNode commands = parseJson(extractSeedManifest(migrationSql, connectorCode))
                .path("runtime").path("commands");
            commands.fields().forEachRemaining(action -> {
                assertThat(action.getValue().isArray()).as(action.getKey()).isTrue();
                assertThat(action.getValue()).as(action.getKey()).isNotEmpty();
                action.getValue().forEach(argv -> {
                    assertThat(argv.isArray()).as(action.getKey()).isTrue();
                    assertThat(argv).as(action.getKey()).isNotEmpty();
                });
            });
        }

        JsonNode larkCommands = parseJson(extractSeedManifest(migrationSql, "lark"))
            .path("runtime").path("commands");
        assertThat(larkCommands.path("login")).hasSize(2);
        assertThat(larkCommands.fieldNames()).toIterable().contains(
            "configCheck", "configInitialize", "contextBind", "login", "status", "logout");

        JsonNode wecomStatus = parseJson(extractSeedManifest(migrationSql, "wecom"))
            .path("runtime").path("commands").path("status");
        assertThat(wecomStatus).hasSize(2);
    }

    @Test
    void connectorCommandUpgradeMigrationConvergesExistingRowsToFreshInstallManifests() throws Exception {
        String upgradeSql = readPreservingCase("deploy/migrations/versions/V0.3.1/V0.3.1__dml.sql");
        String initdbSql = readPreservingCase("deploy/middleware/initdb/04_dml.sql");

        assertThat(upgradeSql).contains(
            "UPDATE byai.byai_connector_info",
            "WHERE connector_code IN ('dingtalk', 'lark', 'wecom')"
        );
        assertThat(initdbSql).doesNotContain("V0.5.1 Runtime Manifest 命令执行");
        for (String connectorCode : new String[] {"dingtalk", "lark", "wecom"}) {
            JsonNode upgraded = parseJson(extractUpgradeManifest(upgradeSql, connectorCode));
            JsonNode fresh = parseJson(extractSeedManifest(initdbSql, connectorCode));
            assertThat(upgraded).as(connectorCode).isEqualTo(fresh);
        }
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

    private String extractUpgradeManifest(String sql, String connectorCode) {
        int runtimeCase = sql.indexOf("runtime_manifest = CASE connector_code");
        assertThat(runtimeCase).isGreaterThanOrEqualTo(0);
        Matcher matcher = Pattern.compile(
            "WHEN\\s+'" + Pattern.quote(connectorCode) + "'\\s+THEN\\s+'([^']*)'",
            Pattern.CASE_INSENSITIVE | Pattern.DOTALL
        ).matcher(sql.substring(runtimeCase));
        assertThat(matcher.find()).as(connectorCode + " upgrade Runtime Manifest").isTrue();
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

    private ConnectorListDto connectorListWithFixedExpiration() {
        ConnectorListDto dto = new ConnectorListDto();
        dto.setCredentialExpiresAt(Date.from(Instant.parse("2026-08-10T04:30:00Z")));
        return dto;
    }

    private String read(String relativePath) throws Exception {
        return readPreservingCase(relativePath).toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
    }

    private String connectorAuthorizationSubquery(String sql, String joinPrefix, String joinSuffix) {
        int start = sql.indexOf(joinPrefix);
        int end = sql.indexOf(joinSuffix, start);

        assertThat(start).isGreaterThanOrEqualTo(0);
        assertThat(end).isGreaterThan(start);
        return sql.substring(start, end);
    }

    private String readPreservingCase(String relativePath) throws Exception {
        return Files.readString(repoPath(relativePath));
    }

    private Path repoPath(String relativePath) {
        Path repoRoot = Path.of("").toAbsolutePath();
        while (repoRoot != null && !Files.exists(repoRoot.resolve("deploy/migrations/versions"))) {
            repoRoot = repoRoot.getParent();
        }
        assertThat(repoRoot).isNotNull();
        return repoRoot.resolve(relativePath);
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
