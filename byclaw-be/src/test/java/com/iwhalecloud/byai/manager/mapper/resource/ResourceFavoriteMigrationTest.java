package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.sql.Connection;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.session.Configuration;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;

/** 使用实际迁移段验证重复执行、唯一键和计数约束；H2 不替代目标数据库发布验证。 */
class ResourceFavoriteMigrationTest {
    @Test
    void schemaReadinessRequiresBothTablesInTheActiveSchema() throws Exception {
        try (var connection = DriverManager.getConnection(
            "jdbc:h2:mem:favorite_schema_readiness;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE")) {
            try (var statement = connection.createStatement()) {
                statement.execute("CREATE SCHEMA byai");
                statement.execute("SET SCHEMA byai");
                assertThat(schemaReady(connection)).isFalse();
                statement.execute("CREATE TABLE byai_resource_favorite(id BIGINT)");
                assertThat(schemaReady(connection)).isFalse();
                statement.execute("CREATE SCHEMA other");
                statement.execute("CREATE TABLE other.byai_resource_favorite_count(id BIGINT)");
                assertThat(schemaReady(connection)).isFalse();
                statement.execute("CREATE TABLE byai_resource_favorite_count(id BIGINT)");
                assertThat(schemaReady(connection)).isTrue();
            }
        }
    }

    private boolean schemaReady(Connection connection) throws Exception {
        try (var input = getClass().getResourceAsStream(
            "/com/iwhalecloud/byai/manager/mapper/resource/ResourceFavoriteMapper.xml")) {
            assertThat(input).isNotNull();
            String xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            int start = xml.indexOf("<select id=\"isSchemaReady\"");
            String body = xml.substring(xml.indexOf('>', start) + 1, xml.indexOf("</select>", start));
            String sql = new XMLLanguageDriver().createSqlSource(new Configuration(),
                "<script>" + body + "</script>", Object.class).getBoundSql(null).getSql();
            try (var statement = connection.createStatement(); var result = statement.executeQuery(sql)) {
                assertThat(result.next()).isTrue();
                return result.getBoolean(1);
            }
        }
    }

    @Test
    void migrationIsIdempotentAndEnforcesFavoriteAndCountKeys() throws Exception {
        Path root = Path.of(System.getProperty("basedir", ".")).toAbsolutePath();
        if (!Files.isDirectory(root.resolve("deploy/migrations"))) {
            root = root.getParent();
        }
        String migration = Files.readString(root.resolve("deploy/migrations/versions/V0.5.0/V0.5.0__ddl.sql"));
        String marker = "-- 商业版本官方推荐资源收藏：";
        assertThat(migration).contains(marker);
        String sql = migration.substring(migration.indexOf(marker));

        try (var connection = DriverManager.getConnection(
            "jdbc:h2:mem:favorite_migration;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE")) {
            try (var statement = connection.createStatement()) {
                statement.execute("CREATE SCHEMA byai");
                // V0.5.0 尾部同时包含已有客户线索表的增量个人资料字段。
                statement.execute("CREATE TABLE byai.byai_customer_leads(id BIGINT, company_name VARCHAR(100), contact_name VARCHAR(100))");
                RunScript.execute(connection, new StringReader(sql));
                statement.executeUpdate("INSERT INTO byai_resource_favorite(com_acct_id, user_id, resource_id) VALUES (22, 11, 33)");
                statement.executeUpdate("INSERT INTO byai_resource_favorite_count(com_acct_id, resource_id, favorite_count) VALUES (22, 33, 5)");

                RunScript.execute(connection, new StringReader(sql));
                try (var result = statement.executeQuery("SELECT favorite_count FROM byai_resource_favorite_count")) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getLong(1)).isEqualTo(5L);
                    assertThat(result.next()).isFalse();
                }
                assertThatThrownBy(() -> statement.executeUpdate(
                    "INSERT INTO byai_resource_favorite(com_acct_id, user_id, resource_id) VALUES (22, 11, 33)"))
                    .isInstanceOf(SQLException.class);
                statement.executeUpdate("INSERT INTO byai_resource_favorite(com_acct_id, user_id, resource_id) VALUES (22, 12, 33)");
                statement.executeUpdate("INSERT INTO byai_resource_favorite(com_acct_id, user_id, resource_id) VALUES (23, 11, 33)");
                assertThatThrownBy(() -> statement.executeUpdate(
                    "INSERT INTO byai_resource_favorite(com_acct_id, user_id, resource_id) VALUES (22, NULL, 34)"))
                    .isInstanceOf(SQLException.class);
                assertThatThrownBy(() -> statement.executeUpdate(
                    "INSERT INTO byai_resource_favorite_count(com_acct_id, resource_id) VALUES (22, 33)"))
                    .isInstanceOf(SQLException.class);
                assertThatThrownBy(() -> statement.executeUpdate(
                    "UPDATE byai_resource_favorite_count SET favorite_count = -1 WHERE resource_id = 33"))
                    .isInstanceOf(SQLException.class);
            }
        }
    }
}
