package com.iwhalecloud.byai.manager.mapper.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;

import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.session.SqlSessionFactory;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePageDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;

/**
 * 入口 4 {@code /open/api/v1/getResourceListByPage} 的 SQLite 真实 SQL 分页集成测试。
 *
 * <p>覆盖 AC-008 与 AC-004：停用类型在分页之前被过滤，{@code total} / {@code pages} / 条目自洽；
 * {@code parent_resource_id = -1} 豁免的规则派生开关与基线逐行一致（混合请求仍返回正常类型的子行）；
 * 名称含「对象/视图/本体/场景」但类型正常的资源仍返回；{@code resource_biz_type} 为 null 的历史行不被排除。
 */
class ResourceListByPageDisabledBizTypePaginationIntegrationTest {

    @TempDir
    Path tempDir;

    @Test
    void disabledTypesFilteredBeforePagination() throws Exception {
        try (SqlSession session = openSession()) {
            Page<ResourcePageDto> page = query(session, List.of("KG_DOC"), 1, 1);

            // fixture 共 6 行：3 条正常顶层（含 1 条 null 类型）+ 1 条正常子行 + 2 条停用；
            // 显式 KG_DOC 过滤后 total=2 ⇒ 过滤发生在分页之前（否则 total 会偏大或出现空页）。
            assertThat(page.getTotal()).isEqualTo(2L);
            assertThat(page.getPages()).isEqualTo(2);
            assertThat(page.getRecords()).hasSize(1);
            assertThat(page.getRecords()).extracting(ResourcePageDto::getResourceBizType)
                .doesNotContain("OBJECT", "VIEW");
        }
    }

    @Test
    void mixedRequestKeepsBaselineChildRowBehavior() throws Exception {
        try (SqlSession session = openSession()) {
            Page<ResourcePageDto> pureNormal = query(session, List.of("KG_DOC"), 1, 10);
            // 纯正常类型请求：豁免不触发 ⇒ 只返回顶层行（301 是子行，被 parent_resource_id = -1 排除）。
            assertThat(pureNormal.getTotal()).isEqualTo(2L);
            assertThat(pureNormal.getRecords()).extracting(ResourcePageDto::getResourceId)
                .containsExactlyInAnyOrder(300L, 303L);

            Page<ResourcePageDto> mixed = query(session, List.of("KG_DOC", "OBJECT"), 1, 10);
            // 混合请求：豁免仍触发 ⇒ 正常类型的子行仍返回（与基线一致），停用类型被排除。
            assertThat(mixed.getTotal()).isEqualTo(3L);
            assertThat(mixed.getRecords()).extracting(ResourcePageDto::getResourceId)
                .containsExactlyInAnyOrder(300L, 301L, 303L);
            assertThat(mixed.getRecords()).extracting(ResourcePageDto::getResourceBizType)
                .doesNotContain("OBJECT", "VIEW");
        }
    }

    @Test
    void normalTypeWithObjectKeywordInNameIsStillReturned() throws Exception {
        try (SqlSession session = openSession()) {
            Page<ResourcePageDto> page = query(session, List.of("KG_DOC"), 1, 10);

            // 名称含关键词但类型正常 ⇒ 仍返回（证明不按名称/描述关键词过滤）。
            assertThat(page.getRecords()).extracting(ResourcePageDto::getResourceName)
                .contains("对象视图本体场景说明");
        }
    }

    @Test
    void nullBizTypeRowIsStillReturned() throws Exception {
        try (SqlSession session = openSession()) {
            Page<ResourcePageDto> page = query(session, new ArrayList<>(), 1, 10);

            assertThat(page.getRecords()).extracting(ResourcePageDto::getResourceId).contains(305L);
        }
    }

    @Test
    void explicitDisabledTypeRequestReturnsEmptyPage() throws Exception {
        try (SqlSession session = openSession()) {
            Page<ResourcePageDto> page = query(session, List.of("OBJECT"), 1, 10);

            assertThat(page.getTotal()).isZero();
            assertThat(page.getRecords()).isEmpty();
        }
    }

    private static Page<ResourcePageDto> query(SqlSession session, List<String> resourceBizTypeList, int pageNum,
        int pageSize) {
        ResourceQueryRequest request = new ResourceQueryRequest();
        request.setResourceBizTypeList(new ArrayList<>(resourceBizTypeList));
        request.setResourceTypeList(new ArrayList<>());
        request.setPageNum(pageNum);
        request.setPageSize(pageSize);

        Page<ResourcePageDto> page = new Page<>(pageNum, pageSize);
        List<ResourcePageDto> records = session.getMapper(SsResourceMapper.class).getResourceListByPage(page, request);
        page.setRecords(records);
        return page;
    }

    private SqlSession openSession() throws Exception {
        String jdbcUrl = "jdbc:sqlite:" + tempDir.resolve("resource-list-by-page.sqlite").toAbsolutePath();
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
            statement.execute("CREATE TABLE ss_resource_catalog (catalog_id INTEGER PRIMARY KEY, "
                + "catalog_name TEXT, catalog_type INTEGER, catalog_path TEXT)");
            statement.execute("CREATE TABLE po_organization (org_id INTEGER PRIMARY KEY, org_name TEXT)");
            statement.execute("CREATE TABLE ss_res_ext_agent (resource_id INTEGER, agent_type TEXT)");
            statement.execute("CREATE TABLE ss_res_ext_doc (resource_id INTEGER, plugin_machine_id TEXT, "
                + "type TEXT, kdb_id TEXT)");
            statement.execute("CREATE TABLE ss_res_ext_dig_employee (resource_id INTEGER, create_type TEXT)");
            statement.execute("CREATE TABLE men_task (task_id INTEGER PRIMARY KEY, resource_id INTEGER, "
                + "deal_desc TEXT)");
            statement.execute("""
                INSERT INTO ss_resource(resource_id, resource_biz_type, resource_name, resource_code,
                                        resource_status, parent_resource_id, create_time, update_time)
                VALUES (300,'KG_DOC','文档A',              'code-300',2,-1,'2026-01-06 10:00:00','2026-01-06 10:00:00'),
                       (301,'KG_DOC','文档A子行',          'code-301',2,300,'2026-01-05 10:00:00','2026-01-05 10:00:00'),
                       (302,'OBJECT','旧对象',             'code-302',2,-1,'2026-01-04 10:00:00','2026-01-04 10:00:00'),
                       (303,'KG_DOC','对象视图本体场景说明','code-303',2,-1,'2026-01-03 10:00:00','2026-01-03 10:00:00'),
                       (304,'VIEW',  '旧视图',             'code-304',2,-1,'2026-01-02 10:00:00','2026-01-02 10:00:00'),
                       (305,NULL,    '无类型历史行',       'code-305',2,-1,'2026-01-01 10:00:00','2026-01-01 10:00:00')
                """);
        }
    }

    private SqlSessionFactory buildSqlSessionFactory(String jdbcUrl) {
        UnpooledDataSource dataSource = new UnpooledDataSource("org.sqlite.JDBC", jdbcUrl, null, null);
        MybatisConfiguration configuration = new MybatisConfiguration(
            new Environment("sqlite-test", new JdbcTransactionFactory(), dataSource));
        configuration.setMapUnderscoreToCamelCase(true);
        MybatisPlusInterceptor pagination = new MybatisPlusInterceptor();
        pagination.addInnerInterceptor(new PaginationInnerInterceptor(DbType.SQLITE));
        configuration.addInterceptor(pagination);
        configuration.addMapper(SsResourceMapper.class);
        return new MybatisSqlSessionFactoryBuilder().build(configuration);
    }
}
