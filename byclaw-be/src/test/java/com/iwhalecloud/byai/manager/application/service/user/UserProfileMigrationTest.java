package com.iwhalecloud.byai.manager.application.service.user;

import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import org.h2.tools.RunScript;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

/** 执行实际 ALTER 片段验证字段新增和历史数据保留，H2 不替代目标数据库发布验证。 */
class UserProfileMigrationTest {
    @Test
    void alterAddsOptionalFieldsWithoutLosingHistoricalOrSavedProfiles() throws Exception {
        Path root = Path.of(System.getProperty("basedir", ".")).toAbsolutePath();
        if (!Files.isDirectory(root.resolve("deploy/migrations"))) root = root.getParent();
        String migration = Files.readString(root.resolve("deploy/migrations/versions/V0.5.0/V0.5.0__ddl.sql"));
        String marker = "-- 完善个人资料：";
        assertThat(migration).contains(marker);
        String sql = migration.substring(migration.indexOf(marker));
        assertThat(sql.toUpperCase()).contains("ALTER TABLE").doesNotContain("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", "ADD COLUMN IF NOT EXISTS", "SET SEARCH_PATH");
        try (var connection = DriverManager.getConnection(
            "jdbc:h2:mem:user_profile_migration;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE")) {
            try (var statement = connection.createStatement()) {
                statement.execute("CREATE SCHEMA byai");
                statement.execute("CREATE TABLE byai.po_users(user_id BIGINT, user_name VARCHAR(255))");
                statement.execute("CREATE TABLE byai.byai_customer_leads(id BIGINT, company_name VARCHAR(100), contact_name VARCHAR(100), industry VARCHAR(100), phone VARCHAR(20), wechat VARCHAR(50), demand TEXT, create_time TIMESTAMP)");
                statement.execute("INSERT INTO byai.byai_customer_leads(id, contact_name, company_name, industry, demand) VALUES(42, '吴杰', '鲸智科技', '教育', '历史咨询')");
                RunScript.execute(connection, new StringReader(sql));
                try (var result = statement.executeQuery("SELECT * FROM byai.byai_customer_leads WHERE id=42")) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getString("contact_name")).isEqualTo("吴杰");
                    assertThat(result.getString("company_name")).isEqualTo("鲸智科技");
                    assertThat(result.getObject("user_id")).isNull();
                    assertThat(result.getString("industry")).isEqualTo("教育");
                    assertThat(result.getString("demand")).isEqualTo("历史咨询");
                    assertThat(result.getString("profile_interests")).isNull();
                }
                statement.execute("UPDATE byai.byai_customer_leads SET user_id=1001, company_name='个人', profile_role='学生', profile_interests='[]' WHERE id=42");
                try (var result = statement.executeQuery("SELECT * FROM byai.byai_customer_leads WHERE id=42")) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getString("company_name")).isEqualTo("个人");
                    assertThat(result.getString("profile_role")).isEqualTo("学生");
                    assertThat(result.getString("profile_interests")).isEqualTo("[]");
                }
                try (var result = statement.executeQuery("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='byai' AND table_name='po_users'")) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getInt(1)).isEqualTo(2);
                }
            }
        }
    }
}
