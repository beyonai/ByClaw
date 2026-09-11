package com.iwhalecloud.byai.manager.domain.datasource;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.iwhalecloud.byai.manager.dto.datasource.SessionResourceQueryDto;
import com.iwhalecloud.byai.manager.entity.datasource.Datasource;
import com.iwhalecloud.byai.manager.mapper.datasource.DataSourceMapper;
import com.iwhalecloud.byai.manager.mapper.datasource.ProjectDataSourceMapper;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.annotation.DbType;
import com.iwhalecloud.byai.manager.application.service.datasource.ProjectDataSourceService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.List;
import static org.mockito.Mockito.*;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import static org.assertj.core.api.Assertions.assertThat;

class DataSourceMapperIntegrationTest {
    @TempDir
    Path directory;
    private SqlSessionFactory factory;

    @BeforeEach
    void setup() throws Exception {
        String url = "jdbc:sqlite:" + directory.resolve("datasources.sqlite");
        try (Connection connection = DriverManager.getConnection(url); Statement sql = connection.createStatement()) {
            sql.execute("""
                CREATE TABLE byai_datasource (
                    datasource_id BIGINT PRIMARY KEY, datasource_name VARCHAR(128) NOT NULL, description VARCHAR(2000), datasource_type VARCHAR(32) NOT NULL,
                    connection_config TEXT NOT NULL, password_cipher TEXT NOT NULL, create_by BIGINT NOT NULL, create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    update_by BIGINT NOT NULL, update_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)
                """);
            sql.execute("""
                CREATE TABLE byai_project_datasource (
                    project_id BIGINT NOT NULL, datasource_id BIGINT NOT NULL, create_by BIGINT NOT NULL, create_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY(project_id, datasource_id))
                """);
            sql.execute("""
                INSERT INTO byai_datasource(datasource_id,datasource_name,datasource_type,create_by,create_time,connection_config,password_cipher,update_by)
                VALUES (1,'Report 100%','opengauss',7,100,'{}','test-cipher',7),
                       (2,'Report secondary','opengauss',7,100,'{}','test-cipher',7),
                       (4,'Other project','opengauss',7,102,'{}','test-cipher',7),
                       (5,'Another owner','opengauss',8,103,'{}','test-cipher',8),
                       (6,'Report future','future',7,104,'{}','test-cipher',7)
                """);
            sql.execute("""
                INSERT INTO byai_project_datasource(project_id,datasource_id,create_by)
                VALUES (10,1,7),(10,2,7),(20,4,7),(10,5,7),(10,6,7)
                """);
        }
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC", url, null, null);
        MybatisConfiguration configuration = new MybatisConfiguration(
            new Environment("test", new JdbcTransactionFactory(), dataSource));
        configuration.setMapUnderscoreToCamelCase(true);
        MybatisPlusInterceptor pagination = new MybatisPlusInterceptor();
        pagination.addInnerInterceptor(new PaginationInnerInterceptor(DbType.SQLITE));
        configuration.addInterceptor(pagination);
        configuration.addMapper(DataSourceMapper.class);
        configuration.addMapper(ProjectDataSourceMapper.class);
        factory = new MybatisSqlSessionFactoryBuilder().build(configuration);
    }

    @Test
    void renamedColumnsRoundTripThroughGeneratedAndCustomStatements() {
        try (SqlSession session = factory.openSession()) {
            DataSourceMapper sources = session.getMapper(DataSourceMapper.class);
            Datasource source = new Datasource();
            source.setDatasourceId(90L);
            source.setDatasourceName("新增数据源");
            source.setDatasourceType("opengauss");
            source.setConnectionConfig("{\"host\":\"db.example.com\"}");
            source.setCreateBy(7L);
            source.setUpdateBy(7L);
            source.setPasswordCipher("test-cipher");
            sources.insert(source);
            Datasource stored = sources.lockById(90L);
            assertThat(stored.getDatasourceName()).isEqualTo(source.getDatasourceName());
            assertThat(stored.getDatasourceType()).isEqualTo(source.getDatasourceType());
            assertThat(stored.getConnectionConfig()).isEqualTo(source.getConnectionConfig());
            source.setDatasourceName("更新数据源");
            source.setConnectionConfig("{\"host\":\"updated.example.com\"}");
            sources.updateById(source);
            session.getMapper(ProjectDataSourceMapper.class).bind(30L, 90L, 7L);
            Datasource linked = sources.listByProject(30L).get(0);
            assertThat(linked.getDatasourceName()).isEqualTo(source.getDatasourceName());
            assertThat(linked.getDatasourceType()).isEqualTo(source.getDatasourceType());
            assertThat(linked.getConnectionConfig()).isEqualTo(source.getConnectionConfig());
            assertThat(sources.listAvailable(10L, 7L)).filteredOn(row -> row.getDatasourceId().equals(90L))
                .singleElement().extracting(Datasource::getDatasourceName).isEqualTo("更新数据源");
        }
    }

    @Test
    void sharedBindingsAreIdempotentAndUnlinkPreservesOtherProject() {
        try (SqlSession session = factory.openSession()) {
            ProjectDataSourceMapper bindings = session.getMapper(ProjectDataSourceMapper.class);
            DataSourceMapper sources = session.getMapper(DataSourceMapper.class);
            DataSourceAccessService access = mock(DataSourceAccessService.class);
            when(access.currentUserId()).thenReturn(7L);
            when(access.requireProject(20L, true)).thenReturn(new Project());
            ProjectDataSourceService service = new ProjectDataSourceService(sources, bindings, access,
                mock(SequenceService.class), new ObjectMapper(), List.of(new OpenGaussDataSourceProvider()));
            service.bind(20L, 1L);
            service.bind(20L, 1L);
            assertThat(bindings.countBinding(20L, 1L)).isEqualTo(1);
            bindings.unbind(10L, 1L);
            assertThat(bindings.countBinding(10L, 1L)).isZero();
            assertThat(sources.listByProject(20L)).extracting(Datasource::getDatasourceId).contains(1L, 4L);
            assertThat(sources.selectById(1L)).isNotNull();
            bindings.deleteForSource(1L);
            sources.deleteById(1L);
            assertThat(sources.selectById(1L)).isNull();
            assertThat(sources.listAvailable(10L, 7L)).extracting(Datasource::getDatasourceId).doesNotContain(1L);
            assertThat(bindings.countBinding(20L, 1L)).isZero();
            assertThat(sources.listByProject(20L)).extracting(Datasource::getDatasourceId).containsExactly(4L);
        }
    }

    @Test
    void availableSourcesExcludeAlreadyBoundAndOtherOwners() {
        try (SqlSession session = factory.openSession()) {
            DataSourceMapper sources = session.getMapper(DataSourceMapper.class);
            assertThat(sources.listAvailable(10L, 7L)).extracting(Datasource::getDatasourceId).containsExactly(4L);
        }
    }

    @Test
    void queryAndCountShareFiltersWithStablePaginationAndLiteralKeyword() throws Exception {
        try (SqlSession session = factory.openSession()) {
            DataSourceMapper sources = session.getMapper(DataSourceMapper.class);
            SessionResourceQueryDto query = new SessionResourceQueryDto();
            query.setKeyword("REPORT");
            query.setDatasourceType("opengauss");
            query.setPageSize(1);
            assertThat(sources.countQuery(10L, query)).isEqualTo(2);
            assertThat(sources.query(10L, query, query.offset())).extracting(Datasource::getDatasourceId).containsExactly(2L);
            query.setPageNum(2);
            assertThat(sources.query(10L, query, query.offset())).extracting(Datasource::getDatasourceId).containsExactly(1L);
            query.setPageNum(1);
            query.setKeyword("100%");
            assertThat(sources.countQuery(10L, query)).isEqualTo(1);
            assertThat(sources.query(10L, query, 0)).extracting(Datasource::getDatasourceId).containsExactly(1L);
            Datasource literal = new Datasource();
            literal.setDatasourceId(90L);
            literal.setDatasourceName("Report_100%!");
            literal.setDatasourceType("opengauss");
            literal.setCreateBy(7L);
            literal.setUpdateBy(7L);
            literal.setConnectionConfig("{}");
            literal.setPasswordCipher("test-cipher");
            sources.insert(literal);
            session.getMapper(ProjectDataSourceMapper.class).bind(10L, 90L, 7L);
            query.setKeyword("_100%!");
            assertThat(sources.countQuery(10L, query)).isEqualTo(1);
            assertThat(sources.query(10L, query, 0)).extracting(Datasource::getDatasourceId).containsExactly(90L);
            query.setKeyword("100%");
            query.setResourceId(2L);
            assertThat(sources.countQuery(10L, query)).isZero();
            query.setResourceId(null);
            query.setKeyword("' OR 1=1 --");
            assertThat(sources.countQuery(10L, query)).isZero();
        }
    }
}
