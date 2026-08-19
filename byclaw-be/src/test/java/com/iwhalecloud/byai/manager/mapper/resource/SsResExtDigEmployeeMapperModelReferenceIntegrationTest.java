package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class SsResExtDigEmployeeMapperModelReferenceIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void selectDigitalEmployeeNamesByModelId_matchesExactActiveImageAndLegacyReferences() throws Exception {
        Path database = tempDir.resolve("model-reference.sqlite");
        String jdbcUrl = "jdbc:sqlite:" + database.toAbsolutePath();
        initializeSchema(jdbcUrl);

        SqlSessionFactory sqlSessionFactory = buildSqlSessionFactory(jdbcUrl);
        try (SqlSession session = sqlSessionFactory.openSession()) {
            List<String> names = session.getMapper(SsResExtDigEmployeeMapper.class)
                .selectDigitalEmployeeNamesByModelId(42L);

            assertThat(names).containsExactlyInAnyOrder("image-model-42", "legacy-prologue-42");
        }
    }

    private void initializeSchema(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE ss_resource (
                    resource_id INTEGER PRIMARY KEY,
                    resource_name TEXT NOT NULL,
                    resource_biz_type TEXT NOT NULL,
                    resource_status TEXT NOT NULL
                )
                """);
            statement.execute("""
                CREATE TABLE ss_res_ext_dig_employee (
                    resource_id INTEGER PRIMARY KEY,
                    prologue TEXT,
                    target_content TEXT
                )
                """);
        }
        try (Connection connection = DriverManager.getConnection(jdbcUrl)) {
            insertEmployee(connection, 1L, "image-model-42", "2", null, "{\"imageModelId\":\"42\"}");
            insertEmployee(connection, 2L, "image-model-142", "2", null, "{\"imageModelId\":\"142\"}");
            insertEmployee(connection, 3L, "disabled-image-model-42", "1", null, "{\"imageModelId\":\"42\"}");
            insertEmployee(connection, 4L, "legacy-prologue-42", "2", "{\"modelInfo\":{\"modelId\":\"42\"}}", null);
        }
    }

    private void insertEmployee(Connection connection, Long resourceId, String resourceName, String resourceStatus,
        String prologue, String targetContent) throws Exception {
        try (PreparedStatement resource = connection.prepareStatement("""
            INSERT INTO ss_resource(resource_id, resource_name, resource_biz_type, resource_status)
            VALUES (?, ?, 'DIG_EMPLOYEE', ?)
            """);
            PreparedStatement extension = connection.prepareStatement("""
                INSERT INTO ss_res_ext_dig_employee(resource_id, prologue, target_content)
                VALUES (?, ?, ?)
                """)) {
            resource.setLong(1, resourceId);
            resource.setString(2, resourceName);
            resource.setString(3, resourceStatus);
            resource.executeUpdate();
            extension.setLong(1, resourceId);
            extension.setString(2, prologue);
            extension.setString(3, targetContent);
            extension.executeUpdate();
        }
    }

    private SqlSessionFactory buildSqlSessionFactory(String jdbcUrl) {
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC", jdbcUrl, null, null);
        Environment environment = new Environment("sqlite-test", new JdbcTransactionFactory(), dataSource);
        MybatisConfiguration configuration = new MybatisConfiguration(environment);
        configuration.addMapper(SsResourceMapper.class);
        configuration.addMapper(SsResExtDigEmployeeMapper.class);
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
