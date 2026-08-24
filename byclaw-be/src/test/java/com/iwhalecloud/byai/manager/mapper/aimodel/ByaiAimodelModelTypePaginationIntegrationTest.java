package com.iwhalecloud.byai.manager.mapper.aimodel;

import static org.assertj.core.api.Assertions.assertThat;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.pagehelper.PageInterceptor;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.aimodel.service.ByaiAimodelDomainService;
import com.iwhalecloud.byai.manager.dto.aimodel.ModelListRequest;
import com.iwhalecloud.byai.manager.entity.aimodel.ByaiAimodel;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.util.Properties;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class ByaiAimodelModelTypePaginationIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void modelTypeIsFilteredBySqlBeforePagination() throws Exception {
        try (SqlSession session = openSessionWithMixedModelTypes()) {
            ModelListRequest request = new ObjectMapper().readValue("""
                {"pageNum":1,"pageSize":1,"status":"ENABLED","modelType":"IMAGE_GENERATION"}
                """, ModelListRequest.class);

            PageInfo<ByaiAimodel> page = service(session).listByCondition(request);

            assertThat(page.getList()).extracting(ByaiAimodel::getModelId, ByaiAimodel::getModelType)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(301L, "IMAGE_GENERATION"));
            assertThat(page.getTotal()).isEqualTo(2L);
            assertThat(page.getTotalPages()).isEqualTo(2);
        }
    }

    @Test
    void blankModelTypeKeepsTheUnfilteredPaginationBehavior() throws Exception {
        try (SqlSession session = openSessionWithMixedModelTypes()) {
            ModelListRequest request = new ObjectMapper().readValue("""
                {"pageNum":1,"pageSize":1,"status":"ENABLED","modelType":" "}
                """, ModelListRequest.class);

            PageInfo<ByaiAimodel> page = service(session).listByCondition(request);

            assertThat(page.getList()).extracting(ByaiAimodel::getModelId, ByaiAimodel::getModelType)
                .containsExactly(org.assertj.core.groups.Tuple.tuple(102L, "LLM"));
            assertThat(page.getTotal()).isEqualTo(4L);
            assertThat(page.getTotalPages()).isEqualTo(4);
        }
    }

    private SqlSession openSessionWithMixedModelTypes() throws Exception {
        Path database = tempDir.resolve("model-type-pagination.sqlite");
        String jdbcUrl = "jdbc:sqlite:" + database.toAbsolutePath();
        initializeSchema(jdbcUrl);
        return buildSqlSessionFactory(jdbcUrl).openSession();
    }

    private ByaiAimodelDomainService service(SqlSession session) {
        ByaiAimodelDomainService service = new ByaiAimodelDomainService();
        ReflectionTestUtils.setField(service, "byaiAimodelMapper", session.getMapper(ByaiAimodelMapper.class));
        return service;
    }

    private void initializeSchema(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE byai_aimodel (
                    model_id INTEGER PRIMARY KEY,
                    model_type TEXT,
                    model_name TEXT,
                    model_no TEXT,
                    url TEXT,
                    ori_url TEXT,
                    auth_token TEXT,
                    status TEXT,
                    is_support_chart INTEGER,
                    is_deepthink INTEGER,
                    max_content_token INTEGER,
                    in_params TEXT,
                    inparam_template TEXT,
                    create_by INTEGER,
                    owner_type TEXT,
                    create_time TEXT
                )
                """);
            statement.execute("""
                CREATE TABLE byai_tag_relation (
                    relation_id INTEGER PRIMARY KEY,
                    tag_id INTEGER,
                    obj_id INTEGER,
                    obj_type TEXT
                )
                """);
        }
        try (Connection connection = DriverManager.getConnection(jdbcUrl)) {
            insertModel(connection, 102L, "LLM", "2026-08-18 12:04:00");
            insertModel(connection, 101L, "LLM", "2026-08-18 12:03:00");
            insertModel(connection, 301L, "IMAGE_GENERATION", "2026-08-18 12:02:00");
            insertModel(connection, 302L, "IMAGE_GENERATION", "2026-08-18 12:01:00");
        }
    }

    private void insertModel(Connection connection, Long modelId, String modelType, String createTime)
        throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
            INSERT INTO byai_aimodel(
                model_id, model_type, model_name, model_no, status, create_time
            ) VALUES (?, ?, ?, ?, 'OOA', ?)
            """)) {
            statement.setLong(1, modelId);
            statement.setString(2, modelType);
            statement.setString(3, modelType + " model " + modelId);
            statement.setString(4, "model-" + modelId);
            statement.setString(5, createTime);
            statement.executeUpdate();
        }
    }

    private SqlSessionFactory buildSqlSessionFactory(String jdbcUrl) {
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC", jdbcUrl, null, null);
        Environment environment = new Environment("sqlite-test", new JdbcTransactionFactory(), dataSource);
        MybatisConfiguration configuration = new MybatisConfiguration(environment);
        PageInterceptor pageInterceptor = new PageInterceptor();
        Properties properties = new Properties();
        properties.setProperty("helperDialect", "sqlite");
        pageInterceptor.setProperties(properties);
        configuration.addInterceptor(pageInterceptor);
        configuration.addMapper(ByaiAimodelMapper.class);
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
