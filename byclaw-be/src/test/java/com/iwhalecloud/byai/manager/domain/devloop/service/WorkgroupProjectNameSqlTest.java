package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import java.nio.file.Path;
import java.sql.DriverManager;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

class WorkgroupProjectNameSqlTest {
    @TempDir
    Path tempDir;

    @Test
    void isolatesNamesAndReleasesDissolvedGroupsWithoutChangingHistory() throws Exception {
        String url = "jdbc:sqlite:" + tempDir.resolve("names.sqlite");
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE TABLE byai_project(project_id BIGINT,project_name TEXT,create_by BIGINT,enterprise_id BIGINT,delete_flag TEXT,project_type TEXT)");
            sql.execute("CREATE TABLE byai_session(session_id BIGINT,session_name TEXT,creator_id BIGINT,enterprise_id BIGINT,session_type TEXT,state TEXT,project_id BIGINT)");
            sql.execute("INSERT INTO byai_project VALUES(1,'Team',88,10,'0','hacu'),(2,'Team',88,11,'0','normal'),(3,'Team',89,10,'0','normal'),(4,'Default',88,NULL,'0','normal')");
            sql.execute("INSERT INTO byai_session VALUES(1,'Team',88,10,'hs_as','GROUP_DISSOLVED',1),(2,'Team',88,11,'hs_as','ACTIVE',2),(3,'Team',89,10,'hs_as','ACTIVE',3),(4,'Default',88,NULL,'hs_as',NULL,4)");
        }
        MybatisConfiguration configuration = new MybatisConfiguration(new Environment("names",
            new JdbcTransactionFactory(), new UnpooledDataSource("org.sqlite.JDBC", url, null, null)));
        configuration.addMapper(ProjectMapper.class);
        configuration.addMapper(ByaiSessionMapper.class);
        try (SqlSession session = new MybatisSqlSessionFactoryBuilder().build(configuration).openSession()) {
            ProjectService projects = new ProjectService();
            ReflectionTestUtils.setField(projects, "projectMapper", session.getMapper(ProjectMapper.class));
            WorkgroupNameService groups = new WorkgroupNameService(mock(TenantNodeClient.class),
                session.getMapper(ByaiSessionMapper.class));

            assertThat(projects.existsProjectName("Team", 88L, 10L, null)).isTrue();
            assertThat(projects.existsNonWorkgroupProjectName("Team", 88L, 10L)).isFalse();
            assertThat(groups.exists("Team", 88L, 10L)).isFalse();
            assertThat(projects.existsNonWorkgroupProjectName("Team", 88L, 11L)).isTrue();
            assertThat(groups.exists("Team", 88L, 11L)).isTrue();
            assertThat(projects.existsProjectName("Default", 88L, 1L, null)).isTrue();
            assertThat(groups.exists("Default", 88L, 1L)).isTrue();
            assertThat(projects.existsProjectName("Default", 88L, 10L, null)).isFalse();
            assertThat(groups.exists("Default", 88L, 10L)).isFalse();
        }
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            try (var row = sql.executeQuery("SELECT delete_flag,project_name FROM byai_project WHERE project_id=1")) {
                assertThat(row.next()).isTrue();
                assertThat(row.getString("delete_flag")).isEqualTo("0");
                assertThat(row.getString("project_name")).isEqualTo("Team");
            }
            try (var row = sql.executeQuery("SELECT state,project_id FROM byai_session WHERE session_id=1")) {
                assertThat(row.next()).isTrue();
                assertThat(row.getString("state")).isEqualTo("GROUP_DISSOLVED");
                assertThat(row.getLong("project_id")).isEqualTo(1L);
            }
        }
    }
}
