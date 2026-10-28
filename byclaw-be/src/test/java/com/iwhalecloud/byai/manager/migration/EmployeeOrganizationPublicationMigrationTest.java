package com.iwhalecloud.byai.manager.migration;

import static org.assertj.core.api.Assertions.*;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;

class EmployeeOrganizationPublicationMigrationTest {
    @Test void legacyCompanyPublicationIsPreservedWithoutWideningManualResourcesOrChangingNewScopedRequests() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (!Files.isDirectory(root.resolve("deploy/migrations/versions"))) root = root.getParent();
        Path version = root.resolve("deploy/migrations/versions/V0.5.1");
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;INIT=CREATE SCHEMA IF NOT EXISTS byai\\;SET SCHEMA byai");
        var jdbc = new JdbcTemplate(ds);
        jdbc.execute("""
            CREATE TABLE digital_employee_publication(request_id BIGINT PRIMARY KEY, tenant_id BIGINT,
                official_id BIGINT, status VARCHAR(16), scope_update BOOLEAN DEFAULT FALSE,
                reviewer_id BIGINT, reviewer_name VARCHAR(255), reviewed_at TIMESTAMP,
                comment VARCHAR(2000), created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)
            """);
        jdbc.execute("""
            CREATE TABLE ss_resource(resource_id BIGINT PRIMARY KEY, com_acct_id BIGINT,
                resource_biz_type VARCHAR(30), owner_type VARCHAR(30), publication_source_id BIGINT,
                publication_request_id BIGINT, publish_time TIMESTAMP, create_time TIMESTAMP)
            """);
        String ddl = Files.readString(version.resolve("V0.5.1__ddl.sql"));
        for (String table : new String[]{"digital_employee_publication_target", "digital_employee_publish_scope"}) {
            var statement = Pattern.compile("CREATE TABLE byai\\." + table + " \\(.*?\\);", Pattern.DOTALL).matcher(ddl);
            assertThat(statement.find()).isTrue();
            jdbc.execute(statement.group());
        }
        jdbc.update("INSERT INTO digital_employee_publication(request_id,tenant_id,official_id,status) VALUES(1,7,101,'PUBLISHED'),(2,7,101,'PENDING'),(3,7,NULL,'DRAFT'),(4,7,101,'REJECTED')");
        jdbc.update("INSERT INTO ss_resource(resource_id,com_acct_id,resource_biz_type,owner_type,publication_source_id) VALUES(101,7,'DIG_EMPLOYEE','enterprise',11),(102,7,'DIG_EMPLOYEE','enterprise',NULL),(103,7,'DIG_EMPLOYEE','enterprise',103)");
        jdbc.update("INSERT INTO digital_employee_publication_target(target_id,tenant_id,request_id,org_id,org_name,status) VALUES(400,7,4,20,'Org B','REJECTED')");
        var script = new ByteArrayResource(Files.readAllBytes(version.resolve("V0.5.1__dml.sql")));
        for (int attempt = 0; attempt < 2; attempt++) {
            try (var connection = ds.getConnection()) { ScriptUtils.executeSqlScript(connection, script); }
            assertThat(jdbc.queryForList("SELECT resource_id FROM digital_employee_publish_scope", Long.class)).containsExactly(101L);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM digital_employee_publication_target", Integer.class)).isEqualTo(4);
            assertThat(jdbc.queryForObject("SELECT scope_update FROM digital_employee_publication WHERE request_id=2", Boolean.class)).isTrue();
            assertThat(jdbc.queryForObject("SELECT scope_update FROM digital_employee_publication WHERE request_id=4", Boolean.class)).isFalse();
            assertThat(jdbc.queryForObject("SELECT org_id FROM digital_employee_publication_target WHERE request_id=4", Long.class)).isEqualTo(20L);
        }
    }

    @Test
    void ddlRecreatesNewObjectsPreservesMainRowsAndStoresChineseComments() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (!Files.isDirectory(root.resolve("deploy/migrations/versions"))) root = root.getParent();
        String ddl = Files.readString(root.resolve("deploy/migrations/versions/V0.5.1/V0.5.1__ddl.sql"));
        assertThat(ddl).doesNotContainIgnoringCase("IF NOT EXISTS", "FOR UPDATE");
        // H2 does not support partial indexes; leave that PostgreSQL/openGauss statement to dialect validation.
        String h2Ddl = ddl.replaceFirst("(?s)CREATE UNIQUE INDEX uq_employee_pending_permission\\b.*?;", "");
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID()
            + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1;INIT=CREATE SCHEMA IF NOT EXISTS byai\\;SET SCHEMA byai");
        var jdbc = new JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE ss_resource(resource_id BIGINT PRIMARY KEY, name VARCHAR(50))");
        jdbc.execute("CREATE TABLE digital_employee_publication(request_id BIGINT PRIMARY KEY, status VARCHAR(16))");
        jdbc.execute("CREATE TABLE au_privilege_grant(grant_id BIGINT PRIMARY KEY)");
        jdbc.update("INSERT INTO ss_resource VALUES(1,'保留的资源')");
        jdbc.update("INSERT INTO digital_employee_publication VALUES(1,'PUBLISHED')");
        jdbc.update("INSERT INTO au_privilege_grant VALUES(1)");
        List<String> tables = List.of("byai_resource_binding_source", "byai_resource_sync_job",
            "digital_employee_publication_target", "digital_employee_publish_scope");
        String tableNames = "'BYAI_RESOURCE_BINDING_SOURCE','BYAI_RESOURCE_SYNC_JOB',"
            + "'DIGITAL_EMPLOYEE_PUBLICATION_TARGET','DIGITAL_EMPLOYEE_PUBLISH_SCOPE'";
        for (int attempt = 0; attempt < 2; attempt++) {
            try (var connection = ds.getConnection()) {
                ScriptUtils.executeSqlScript(connection, new ByteArrayResource(h2Ddl.getBytes(StandardCharsets.UTF_8)));
            }
            for (String table : tables) {
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM byai." + table, Integer.class)).isZero();
            }
            assertThat(jdbc.queryForList("SELECT name FROM ss_resource", String.class)).containsExactly("保留的资源");
            assertThat(jdbc.queryForList("SELECT status FROM digital_employee_publication", String.class)).containsExactly("PUBLISHED");
            assertThat(jdbc.queryForList("SELECT grant_id FROM au_privilege_grant", Long.class)).containsExactly(1L);
            assertThat(jdbc.queryForObject("SELECT view_auth_controlled FROM ss_resource", Boolean.class)).isFalse();
            assertThat(jdbc.queryForObject("SELECT use_auth_controlled FROM ss_resource", Boolean.class)).isFalse();
            assertThat(jdbc.queryForObject("SELECT third_sync_revision FROM ss_resource", Long.class)).isZero();
            assertThat(jdbc.queryForObject("SELECT scope_update FROM digital_employee_publication", Boolean.class)).isFalse();
            assertThat(jdbc.queryForList("SELECT REMARKS FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA='BYAI' AND TABLE_NAME IN ("
                + tableNames + ")", String.class)).hasSize(4)
                .allSatisfy(comment -> assertThat(comment).containsPattern("[\\p{IsHan}]"));
            assertThat(jdbc.queryForList("SELECT REMARKS FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='BYAI' AND TABLE_NAME IN ("
                + tableNames + ")", String.class)).hasSize(46)
                .allSatisfy(comment -> assertThat(comment).containsPattern("[\\p{IsHan}]"));
            assertThat(jdbc.queryForList("""
                SELECT REMARKS FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA='BYAI' AND
                    ((TABLE_NAME='SS_RESOURCE' AND COLUMN_NAME IN ('VIEW_AUTH_CONTROLLED','USE_AUTH_CONTROLLED','THIRD_SYNC_REVISION'))
                    OR (TABLE_NAME='DIGITAL_EMPLOYEE_PUBLICATION' AND COLUMN_NAME='SCOPE_UPDATE'))
                """, String.class)).hasSize(4)
                .allSatisfy(comment -> assertThat(comment).containsPattern("[\\p{IsHan}]"));
            if (attempt == 0) {
                jdbc.update("UPDATE ss_resource SET view_auth_controlled=TRUE, use_auth_controlled=TRUE, third_sync_revision=10");
                jdbc.update("UPDATE digital_employee_publication SET scope_update=TRUE");
                jdbc.update("INSERT INTO byai_resource_binding_source(binding_source_id,com_acct_id,resource_id,digital_employee_id,source_type,source_key) VALUES(1,7,10,20,'MANUAL','MANUAL')");
                jdbc.update("INSERT INTO byai_resource_sync_job(sync_job_id,com_acct_id,resource_id,sync_revision,operator_user_id,association_mode) VALUES(1,7,10,1,2,'RECONCILE')");
                jdbc.update("INSERT INTO digital_employee_publication_target(target_id,tenant_id,request_id,org_id,org_name) VALUES(1,7,1,-1,'全公司')");
                jdbc.update("INSERT INTO digital_employee_publish_scope(scope_id,tenant_id,resource_id,org_id) VALUES(1,7,20,-1)");
            }
        }
    }
}
