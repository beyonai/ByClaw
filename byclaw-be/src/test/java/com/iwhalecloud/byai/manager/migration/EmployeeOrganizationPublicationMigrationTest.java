package com.iwhalecloud.byai.manager.migration;

import static org.assertj.core.api.Assertions.*;

import java.nio.file.Files;
import java.nio.file.Path;
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
            var statement = Pattern.compile("CREATE TABLE IF NOT EXISTS byai\\." + table + " \\(.*?\\);", Pattern.DOTALL).matcher(ddl);
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
}
