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
import com.iwhalecloud.byai.manager.domain.resource.request.DigEmployeeRelResourceQo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;

/**
 * 入口 2 {@code queryDigEmployeeRelResourceAuth} 的 SQLite 真实 SQL 分页集成测试。
 *
 * <p>覆盖 AC-006：停用类型在分页之前被过滤，{@code total} / {@code pages} / 条目三者自洽，
 * 且默认正向清单不再包含 {@code OBJECT} / {@code VIEW}。
 */
class DigEmployeeRelResourceAuthDisabledBizTypePaginationIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void disabledTypesAreFilteredBeforePaginationAndTotalMatches() throws Exception {
        try (SqlSession session = openSession()) {
            DigEmployeeRelResourceQo qo = new DigEmployeeRelResourceQo();
            qo.setResourceId(9L);
            qo.setResourceBizTypeList(List.of());

            PageHelper.startPage(1, 2);
            PageInfo<ResourceAuthVo> firstPage = new PageInfo<>(
                session.getMapper(SsResourceMapper.class).queryDigEmployeeRelResourceAuthList(qo));

            // fixture：3 条正常（KG_DOC / KG_QA / TOOLKIT）+ 2 条停用（OBJECT / VIEW）。
            assertThat(firstPage.getTotal()).isEqualTo(3L);
            assertThat(firstPage.getPages()).isEqualTo(2);
            assertThat(firstPage.getList()).hasSize(2);
            assertThat(firstPage.getList()).extracting(ResourceAuthVo::getResourceBizType)
                .doesNotContain("OBJECT", "VIEW");

            PageHelper.startPage(2, 2);
            PageInfo<ResourceAuthVo> secondPage = new PageInfo<>(
                session.getMapper(SsResourceMapper.class).queryDigEmployeeRelResourceAuthList(qo));

            assertThat(secondPage.getList()).hasSize(1);
            assertThat(secondPage.getList().get(0).getResourceBizType()).isNotIn("OBJECT", "VIEW");
        }
    }

    @Test
    void explicitDisabledTypeRequestReturnsEmptyPage() throws Exception {
        try (SqlSession session = openSession()) {
            DigEmployeeRelResourceQo qo = new DigEmployeeRelResourceQo();
            qo.setResourceId(9L);
            qo.setResourceBizTypeList(List.of("OBJECT"));

            PageHelper.startPage(1, 10);
            PageInfo<ResourceAuthVo> page = new PageInfo<>(
                session.getMapper(SsResourceMapper.class).queryDigEmployeeRelResourceAuthList(qo));

            assertThat(page.getTotal()).isZero();
            assertThat(page.getList()).isEmpty();
        }
    }

    @Test
    void mixedTypeRequestKeepsNormalEntriesOnly() throws Exception {
        try (SqlSession session = openSession()) {
            DigEmployeeRelResourceQo qo = new DigEmployeeRelResourceQo();
            qo.setResourceId(9L);
            qo.setResourceBizTypeList(List.of("KG_DOC", "OBJECT"));

            PageHelper.startPage(1, 10);
            PageInfo<ResourceAuthVo> page = new PageInfo<>(
                session.getMapper(SsResourceMapper.class).queryDigEmployeeRelResourceAuthList(qo));

            assertThat(page.getTotal()).isEqualTo(1L);
            assertThat(page.getList()).extracting(ResourceAuthVo::getResourceBizType).containsExactly("KG_DOC");
        }
    }

    private SqlSession openSession() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("rel-resource-auth.sqlite").toAbsolutePath();
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
            statement.execute("""
                CREATE TABLE ss_resource_rel_detail (
                    rel_detail_id INTEGER PRIMARY KEY, resource_id INTEGER, rel_resource_id INTEGER
                )
                """);
            statement.execute("""
                CREATE TABLE ss_res_ext_skill (
                    resource_id INTEGER, skill_type TEXT, source_type TEXT, version TEXT, skill_url TEXT,
                    skill_package_format TEXT, skill_original_filename TEXT, skill_package_size INTEGER,
                    skill_package_hash TEXT, target_content TEXT, sync_status TEXT, sync_error TEXT,
                    last_sync_time TEXT
                )
                """);
            statement.execute("""
                INSERT INTO ss_resource(resource_id, resource_biz_type, resource_name, resource_code,
                                        resource_status, update_time)
                VALUES (100,'KG_DOC','文档',   'code-100',2,'2026-01-05 10:00:00'),
                       (101,'KG_QA', '问答',   'code-101',2,'2026-01-04 10:00:00'),
                       (102,'TOOLKIT','工具集','code-102',2,'2026-01-03 10:00:00'),
                       (103,'OBJECT','旧对象', 'code-103',2,'2026-01-02 10:00:00'),
                       (104,'VIEW',  '旧视图', 'code-104',2,'2026-01-01 10:00:00')
                """);
            statement.execute("""
                INSERT INTO ss_resource_rel_detail(rel_detail_id, resource_id, rel_resource_id)
                VALUES (1,9,100),(2,9,101),(3,9,102),(4,9,103),(5,9,104)
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
        configuration.addMapper(SsResourceMapper.class);
        return new SqlSessionFactoryBuilder().build(configuration);
    }
}
