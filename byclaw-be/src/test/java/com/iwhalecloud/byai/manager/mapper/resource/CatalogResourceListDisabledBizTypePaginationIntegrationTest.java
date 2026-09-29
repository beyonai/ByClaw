package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.List;
import java.util.Properties;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.github.pagehelper.PageInterceptor;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogDto;
import com.iwhalecloud.byai.manager.qo.resource.CatalogDto;

/**
 * 入口 12 {@code /catalog/queryResourceListByCatalogId} 的 SQLite 真实 SQL 分页集成测试。
 *
 * <p>覆盖 AC-013：停用类型在分页之前被过滤，{@code total} / {@code pages} / 条目自洽；
 * {@code resource_biz_type} 为 null 的历史行不被静默排除。
 */
class CatalogResourceListDisabledBizTypePaginationIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void disabledTypesFilteredBeforePaginationAndTotalMatches() throws Exception {
        try (SqlSession session = openSession()) {
            CatalogDto catalogDto = catalogDto(null);

            PageHelper.startPage(1, 2);
            PageInfo<ResourceCatalogDto> firstPage = new PageInfo<>(
                session.getMapper(SsResourceCatalogMapper.class).queryResourceListByCatalogId(catalogDto));

            // fixture：2 条正常（KG_DOC / SKILL）+ 2 条停用（OBJECT / SCENE）+ 1 条 null 类型。
            assertThat(firstPage.getTotal()).isEqualTo(3L);
            assertThat(firstPage.getPages()).isEqualTo(2);
            assertThat(firstPage.getList()).hasSize(2);
            assertThat(firstPage.getList()).extracting(ResourceCatalogDto::getResourceBizType)
                .doesNotContain("OBJECT", "SCENE");

            PageHelper.startPage(2, 2);
            PageInfo<ResourceCatalogDto> secondPage = new PageInfo<>(
                session.getMapper(SsResourceCatalogMapper.class).queryResourceListByCatalogId(catalogDto));

            assertThat(secondPage.getList()).hasSize(1);
        }
    }

    @Test
    void nullBizTypeRowIsStillReturned() throws Exception {
        try (SqlSession session = openSession()) {
            PageHelper.startPage(1, 10);
            PageInfo<ResourceCatalogDto> page = new PageInfo<>(
                session.getMapper(SsResourceCatalogMapper.class).queryResourceListByCatalogId(catalogDto(null)));

            assertThat(page.getList()).extracting(ResourceCatalogDto::getResourceId)
                .contains(204L);
        }
    }

    @Test
    void explicitDisabledTypeRequestReturnsEmptyPage() throws Exception {
        try (SqlSession session = openSession()) {
            PageHelper.startPage(1, 10);
            PageInfo<ResourceCatalogDto> page = new PageInfo<>(
                session.getMapper(SsResourceCatalogMapper.class)
                    .queryResourceListByCatalogId(catalogDto(List.of("OBJECT"))));

            assertThat(page.getTotal()).isZero();
            assertThat(page.getList()).isEmpty();
        }
    }

    private static CatalogDto catalogDto(List<String> resourceBizTypeList) {
        CatalogDto catalogDto = new CatalogDto();
        catalogDto.setIsQueryParent(true);
        catalogDto.setCatalogId(1L);
        catalogDto.setResourceBizTypeList(resourceBizTypeList);
        return catalogDto;
    }

    private SqlSession openSession() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("catalog-resource-list.sqlite").toAbsolutePath();
        initializeSchema(jdbcUrl);
        return buildSqlSessionFactory(jdbcUrl).openSession();
    }

    private void initializeSchema(String jdbcUrl) throws Exception {
        try (Connection connection = DriverManager.getConnection(jdbcUrl);
            Statement statement = connection.createStatement()) {
            statement.execute("""
                CREATE TABLE ss_resource (
                    resource_id INTEGER PRIMARY KEY,
                    system_code TEXT, resource_source_pk_id INTEGER, resource_biz_type TEXT, resource_type TEXT,
                    resource_name TEXT, resource_code TEXT, resource_desc TEXT, avatar TEXT, sample TEXT, tags TEXT,
                    resource_version_id INTEGER, host_type TEXT, catalog_id INTEGER, man_org_id INTEGER,
                    man_user_id INTEGER, index_list TEXT, create_by INTEGER, create_time TEXT, update_by INTEGER,
                    update_time TEXT, com_acct_id INTEGER, resource_status INTEGER, resource_d_verid TEXT,
                    resource_r_verid TEXT, publish_time TEXT, shelf_time TEXT, unshelf_time TEXT, auth_status TEXT,
                    publish_portal TEXT, parent_resource_id INTEGER, publish_type TEXT, owner_type TEXT
                )
                """);
            statement.execute("CREATE TABLE ss_resource_catalog (catalog_id INTEGER PRIMARY KEY, catalog_name TEXT)");
            statement.execute("CREATE TABLE po_organization (org_id INTEGER PRIMARY KEY, org_name TEXT)");
            statement.execute("INSERT INTO ss_resource_catalog(catalog_id, catalog_name) VALUES (1,'目录A')");
            statement.execute("""
                INSERT INTO ss_resource(resource_id, resource_biz_type, resource_name, resource_code,
                                        resource_status, catalog_id, parent_resource_id, update_time)
                VALUES (200,'KG_DOC','文档',  'code-200',2,1,-1,'2026-01-05 10:00:00'),
                       (201,'SKILL', '技能',  'code-201',2,1,-1,'2026-01-04 10:00:00'),
                       (202,'OBJECT','旧对象','code-202',2,1,-1,'2026-01-03 10:00:00'),
                       (203,'SCENE', '旧场景','code-203',2,1,-1,'2026-01-02 10:00:00'),
                       (204,NULL,    '无类型','code-204',2,1,-1,'2026-01-01 10:00:00')
                """);
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
        configuration.addMapper(SsResourceCatalogMapper.class);
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
