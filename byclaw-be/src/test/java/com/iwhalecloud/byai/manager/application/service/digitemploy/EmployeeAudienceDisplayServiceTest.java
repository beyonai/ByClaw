package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.MybatisSqlSessionFactoryBuilder;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationAdminService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.resource.EmployeePublishScope;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.EmployeePublishScopeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.pagehelper.parser.CountSqlParser;
import java.nio.charset.StandardCharsets;
import org.apache.ibatis.scripting.xmltags.XMLLanguageDriver;
import org.apache.ibatis.mapping.MappedStatement;
import org.apache.ibatis.mapping.SqlCommandType;
import org.apache.ibatis.scripting.defaults.DefaultParameterHandler;
import java.sql.DriverManager;
import java.util.*;
import org.apache.ibatis.datasource.unpooled.UnpooledDataSource;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSession;
import org.apache.ibatis.transaction.jdbc.JdbcTransactionFactory;
import org.junit.jupiter.api.*;

class EmployeeAudienceDisplayServiceTest {
    SqlSession session;
    EmployeeAudienceDisplayService service;
    OrganizationAdminService admins = mock(OrganizationAdminService.class);
    OrganizationService organizations = mock(OrganizationService.class);
    long sequence = 1000;

    @BeforeEach void setup() throws Exception {
        EmployeePublicationApplicationServiceTest.login("member", 8L, List.of());
        String url = "jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
        var config = new MybatisConfiguration(new Environment("audience", new JdbcTransactionFactory(),
            new UnpooledDataSource("org.h2.Driver", url, null, null)));
        config.addMapper(SsResourceMapper.class); config.addMapper(EmployeePublishScopeMapper.class);
        config.addMapper(PrivilegeGrantMapper.class);
        TableInfoHelper.initTableInfo(new org.apache.ibatis.builder.MapperBuilderAssistant(config, "org"), Organization.class);
        try (var connection = DriverManager.getConnection(url); var sql = connection.createStatement()) {
            sql.execute("CREATE SCHEMA byai");
            for (Class<?> entity : List.of(SsResource.class, EmployeePublishScope.class, PrivilegeGrant.class)) {
                var table = TableInfoHelper.getTableInfo(entity);
                List<String> columns = new ArrayList<>(List.of(table.getKeyColumn() + " BIGINT PRIMARY KEY"));
                table.getFieldList().forEach(field -> {
                    Class<?> type = field.getPropertyType();
                    String sqlType = Date.class.isAssignableFrom(type) ? "TIMESTAMP"
                        : type == Boolean.class || type == boolean.class ? "BOOLEAN"
                        : Number.class.isAssignableFrom(type) ? "BIGINT" : "VARCHAR(8000)";
                    columns.add(field.getColumn() + " " + sqlType);
                });
                sql.execute("CREATE TABLE " + table.getTableName() + " (" + String.join(",", columns) + ")");
            }
            sql.execute("CREATE VIEW ss_resource AS SELECT * FROM byai.ss_resource");
            sql.execute("CREATE TABLE po_users (user_id BIGINT, user_name VARCHAR(100))");
            sql.execute("CREATE TABLE byai_session_member (mem_obj_id BIGINT, mem_obj_type VARCHAR(100))");
            sql.execute("""
                CREATE TABLE ss_res_ext_dig_employee (resource_id BIGINT PRIMARY KEY,
                agent_type VARCHAR(100), agent_home_url VARCHAR(100), prologue VARCHAR(100),
                integration_type VARCHAR(100), agent_dev_type VARCHAR(100), create_type VARCHAR(100),
                terminal VARCHAR(100), open_super_helper VARCHAR(100), tag_name VARCHAR(100), skills VARCHAR(100))
                """);
        }
        session = new MybatisSqlSessionFactoryBuilder().build(config).openSession(true);
        service = new EmployeeAudienceDisplayService(session.getMapper(SsResourceMapper.class),
            session.getMapper(EmployeePublishScopeMapper.class), session.getMapper(PrivilegeGrantMapper.class), admins, organizations);
        when(admins.allowedOrgIds()).thenReturn(Set.of(1L, 10L, 11L, 20L));
        when(admins.userOrgIds(8L)).thenReturn(Set.of(11L));
        when(organizations.selectList(isNull(), any())).thenReturn(List.of(org(1L, 0L), org(10L, 1L), org(11L, 10L), org(20L, 1L)));
    }

    Organization org(Long id, Long parent) {
        var org = new Organization(); org.setOrgId(id); org.setParentOrgId(parent); org.setOrgName("Org " + id); return org;
    }

    DigitEmployMarketVo employee(long id, boolean published, long tenant) {
        var resource = EmployeePublicationApplicationServiceTest.employee(id, 7L);
        resource.setOwnerType("enterprise"); resource.setComAcctId(tenant); resource.setManOrgId(20L);
        resource.setResourceStatus(2);
        if (published) resource.setPublicationSourceId(id - 1);
        session.getMapper(SsResourceMapper.class).insert(resource);
        execute("INSERT INTO ss_res_ext_dig_employee(resource_id, agent_type) VALUES (?, '016')", id);
        var row = new DigitEmployMarketVo(); row.setId(id); row.setOwnerType("enterprise"); return row;
    }

    void scope(long resource, long org) {
        var scope = new EmployeePublishScope(); scope.setScopeId(++sequence); scope.setResourceId(resource);
        scope.setTenantId(1L); scope.setOrgId(org); session.getMapper(EmployeePublishScopeMapper.class).insert(scope);
    }

    PrivilegeGrant grant(long resource, long org, String type, String color) {
        var grant = new PrivilegeGrant(); grant.setPrivilegeGrantId(++sequence); grant.setGrantObjId(resource);
        grant.setGrantObjType("DIG_EMPLOYEE"); grant.setGrantToObjType("ORG"); grant.setGrantToObjId(org);
        grant.setGrantType(type); grant.setGrantToType(color); grant.setStatusCd("A"); return grant;
    }

    @AfterEach void close() { if (session != null) session.close(); CurrentUserHolder.clearLoginInfo(); }

    @Test void publishedAudienceUsesOnlyLiveScopesAndFiltersOrganizationsForTheViewer() {
        var row = employee(100L, true, 1L); scope(100L, 10L); scope(100L, 20L);
        service.fill(List.of(row));
        assertThat(row.getAudienceOrganizations()).extracting("orgId").containsExactly("10");
        when(admins.userOrgIds(8L)).thenReturn(Set.of()); when(admins.managedOrgIds()).thenReturn(Set.of(20L));
        service.fill(List.of(row));
        assertThat(row.getAudienceOrganizations()).extracting("orgId").containsExactly("20");
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        service.fill(List.of(row));
        assertThat(row.getAudienceOrganizations()).extracting("orgId").containsExactly("10", "20");
        var pending = employee(200L, true, 1L);
        var unrelatedGrant = grant(200L, 20L, "FORCE_USE", "RED");
        session.getMapper(PrivilegeGrantMapper.class).insert(unrelatedGrant);
        service.fill(List.of(pending));
        assertThat(pending.getAudienceOrganizations()).isEmpty();
    }

    @Test void directEmployeesAndGroupsUseEffectiveOrganizationUseGrantsInsteadOfCreatorOrManagingOrganization() {
        var row = employee(100L, false, 1L); row.setAgentType("017");
        var mapper = session.getMapper(PrivilegeGrantMapper.class);
        mapper.insert(grant(100L, 10L, "FORCE_USE", "RED"));
        mapper.insert(grant(100L, 11L, "AVAILABLE_USE", "RED"));
        var expired = grant(100L, 20L, "FORCE_USE", "RED"); expired.setExpDate(new Date(1)); mapper.insert(expired);
        var future = grant(100L, 20L, "AVAILABLE_USE", "RED"); future.setEffDate(new Date(System.currentTimeMillis() + 86400000)); mapper.insert(future);
        mapper.insert(grant(100L, 20L, "ALLOW_MANAGE", "RED"));
        service.fill(List.of(row));
        assertThat(row.getAudienceOrganizations()).extracting("orgId").containsExactly("10");
        mapper.insert(grant(100L, 10L, "AVAILABLE_USE", "BLACK"));
        service.fill(List.of(row));
        assertThat(row.getAudienceOrganizations()).extracting("orgId").containsExactly("11");
    }

    @Test void allCompanyUnsetAndForeignTenantResourcesRemainDistinct() {
        var published = employee(100L, true, 1L); scope(100L, -1L);
        var direct = employee(200L, false, 1L);
        session.getMapper(PrivilegeGrantMapper.class).insert(grant(200L, 1L, "FORCE_USE", "RED"));
        var unset = employee(300L, false, 1L);
        var foreign = employee(400L, false, 2L);
        session.getMapper(PrivilegeGrantMapper.class).insert(grant(400L, 1L, "FORCE_USE", "RED"));
        service.fill(List.of(published, direct, unset, foreign));
        assertThat(published.getAudienceOrganizations()).extracting("orgId").containsExactly("-1");
        assertThat(direct.getAudienceOrganizations()).extracting("orgId").containsExactly("-1");
        assertThat(unset.getAudienceOrganizations()).isEmpty(); assertThat(foreign.getAudienceOrganizations()).isEmpty();
    }

    @Test void filterMatchesDisplayedLabelsWithHierarchyMultiSelectAndSeparateCompany() throws Exception {
        employee(100L, true, 1L); scope(100L, 10L);
        employee(101L, true, 1L); scope(101L, 11L);
        employee(102L, true, 1L); scope(102L, 10L); scope(102L, 20L);
        employee(103L, true, 1L); scope(103L, -1L);
        employee(104L, false, 1L); session.getMapper(PrivilegeGrantMapper.class).insert(grant(104L, 1L, "FORCE_USE", "RED"));
        employee(105L, true, 1L); scope(105L, 10L); scope(105L, 11L);
        employee(106L, false, 1L); // 未设置组织只属于“全部”。
        var query = filter(10L);
        assertThat(query(query)).containsExactly(105L, 102L, 101L, 100L);
        query.setAudienceIncludeDescendants(false);
        assertThat(query(query)).containsExactly(105L, 102L, 100L);
        query.setAudienceOrgIds(List.of(11L));
        assertThat(query(query)).containsExactly(101L); // 105 卡片只有 10，不能匹配被折叠的 11。
        query.setAudienceOrgIds(List.of(10L, 11L, 20L));
        assertThat(query(query)).containsExactly(105L, 102L, 101L, 100L);
        query.setAudienceScopeMode(DiscoverQo.AudienceScopeMode.COMPANY);
        assertThat(query(query)).containsExactly(104L, 103L);
        query.setAudienceScopeMode(DiscoverQo.AudienceScopeMode.ALL);
        assertThat(query(query)).containsExactly(106L, 105L, 104L, 103L, 102L, 101L, 100L);
        assertThat(query.getAudienceFilter()).isNull();
    }

    @Test void filteredPaginationPreservesKeywordTypePermissionAndBlacklist() throws Exception {
        for (long id : List.of(100L, 101L, 102L, 103L)) { employee(id, true, 1L); scope(id, 10L); }
        execute("UPDATE byai.ss_resource SET resource_name = 'Support' WHERE resource_id IN (100, 101, 102)");
        execute("UPDATE ss_res_ext_dig_employee SET agent_type = '017' WHERE resource_id IN (100, 101)");
        var query = filter(10L); query.setKeyword("supp"); query.setAgentType("017");
        assertThat(query(query)).containsExactly(101L, 100L);
        query.setPermission("CREATED_BY_ME");
        assertThat(query(query)).isEmpty();
        execute("UPDATE byai.ss_resource SET create_by = 8 WHERE resource_id = 100");
        assertThat(query(query)).containsExactly(100L);
        query.setPermission(null);
        var denied = grant(101L, 8L, "FORCE_USE", "BLACK"); denied.setGrantToObjType("USER");
        session.getMapper(PrivilegeGrantMapper.class).insert(denied);
        assertThat(query(query)).containsExactly(100L);
    }

    @Test void filterUsesLiveScopesAndEffectiveUseGrantsWithoutLeakingOtherAudiences() throws Exception {
        employee(100L, true, 1L); // 未审批的副本即使有旧使用授权，也不当作已发布。
        employee(101L, true, 2L); scope(101L, 10L); // 跨企业的错误范围不能命中。
        employee(102L, false, 1L); employee(103L, false, 1L); employee(104L, false, 1L);
        employee(105L, false, 1L); employee(106L, false, 1L); employee(107L, false, 1L);
        var mapper = session.getMapper(PrivilegeGrantMapper.class);
        mapper.insert(grant(100L, 10L, "FORCE_USE", "RED"));
        mapper.insert(grant(102L, 10L, "AVAILABLE_USE", "RED"));
        mapper.insert(grant(102L, 10L, "FORCE_USE", "RED")); // 多个授权不产生重复卡片。
        var expired = grant(103L, 10L, "FORCE_USE", "RED"); expired.setExpDate(new Date(1)); mapper.insert(expired);
        var future = grant(104L, 10L, "FORCE_USE", "RED"); future.setEffDate(new Date(System.currentTimeMillis() + 86400000)); mapper.insert(future);
        mapper.insert(grant(105L, 10L, "ALLOW_MANAGE", "RED"));
        mapper.insert(grant(106L, 10L, "FORCE_USE", "RED")); mapper.insert(grant(106L, 10L, "AVAILABLE_USE", "BLACK"));
        var inactive = grant(107L, 10L, "FORCE_USE", "RED"); inactive.setStatusCd("X"); mapper.insert(inactive);
        assertThat(query(filter(10L))).containsExactly(102L);
        employee(200L, true, 1L); scope(200L, 20L);
        assertThat(query(filter(20L))).isEmpty(); // 普通成员卡片不展示 20，筛选也不能泄露它。
        when(admins.managedOrgIds()).thenReturn(Set.of(20L));
        assertThat(query(filter(20L))).containsExactly(200L);
        when(admins.managedOrgIds()).thenReturn(Set.of());
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        assertThat(query(filter(20L))).containsExactly(200L);
        EmployeePublicationApplicationServiceTest.login("adminvip", 9L, List.of());
        assertThat(query(filter(20L))).containsExactly(200L);
    }

    @Test void companyRequiresEveryTenantRootAndIgnoresExpiredDenials() throws Exception {
        when(admins.allowedOrgIds()).thenReturn(Set.of(1L, 2L, 10L));
        when(organizations.selectList(isNull(), any())).thenReturn(List.of(org(1L, 0L), org(2L, 0L), org(10L, 1L)));
        employee(100L, false, 1L); employee(101L, false, 1L);
        var mapper = session.getMapper(PrivilegeGrantMapper.class);
        mapper.insert(grant(100L, 1L, "FORCE_USE", "RED"));
        mapper.insert(grant(101L, 1L, "FORCE_USE", "RED")); mapper.insert(grant(101L, 2L, "AVAILABLE_USE", "RED"));
        var expired = grant(101L, 2L, "AVAILABLE_USE", "BLACK"); expired.setExpDate(new Date(1)); mapper.insert(expired);
        var query = filter(1L); query.setAudienceScopeMode(DiscoverQo.AudienceScopeMode.COMPANY);
        assertThat(query(query)).containsExactly(101L);
        when(admins.allowedOrgIds()).thenReturn(Set.of());
        assertThat(query(query)).isEmpty();
    }

    @Test void ignoresClientAuthorizationContextAndRejectsInvalidOrganizationFilters() throws Exception {
        var mapper = new ObjectMapper();
        var query = mapper.readValue("""
            {"audienceScopeMode":"ORGS","audienceOrgIds":[10],
             "audienceFilter":{"administrator":true,"tenantId":2,"viewerId":7}}
            """, DiscoverQo.class);
        assertThat(query.getAudienceFilter()).isNull();
        service.prepareFilter(query);
        assertThat(query.getAudienceFilter().getTenantId()).isEqualTo(1L);
        assertThat(query.getAudienceFilter().isAdministrator()).isFalse();
        assertThat(query.getAudienceFilter().getMatches().getFirst().getOrgIds()).containsExactly(10L, 11L);
        for (var ids : List.of(List.<Long>of(), List.of(-1L), List.of(999L))) {
            query.setAudienceOrgIds(ids);
            assertThatThrownBy(() -> service.prepareFilter(query)).isInstanceOf(com.iwhalecloud.byai.common.exception.BaseException.class);
        }
        assertThatThrownBy(() -> mapper.readValue("{\"audienceScopeMode\":\"UNKNOWN\"}", DiscoverQo.class)).isInstanceOf(Exception.class);
    }

    private DiscoverQo filter(Long orgId) {
        var query = new DiscoverQo(); query.setAudienceScopeMode(DiscoverQo.AudienceScopeMode.ORGS);
        query.setAudienceOrgIds(List.of(orgId)); query.setIncludeEmployeeGroup(true);
        query.setEmployeeGroupFirst(true);
        query.setOwnerType("enterprise"); query.setOrderField("updateTime"); query.setOrderBy("desc");
        return query;
    }

    /** 执行实际 discover SQL 及 PageHelper 总数 SQL，并逐页取回，防止分页后过滤。 */
    private List<Long> query(DiscoverQo query) throws Exception {
        query.setUserId(CurrentUserHolder.getCurrentUserId());
        service.prepareFilter(query);
        String xml;
        try (var input = getClass().getResourceAsStream("/com/iwhalecloud/byai/manager/mapper/index/IndexMapper.xml")) {
            xml = new String(input.readAllBytes(), StandardCharsets.UTF_8);
        }
        int start = xml.indexOf("<select id=\"discover\"");
        String script = "<script>" + xml.substring(xml.indexOf('>', start) + 1, xml.indexOf("</select>", start)) + "</script>";
        var config = session.getConfiguration();
        var source = new XMLLanguageDriver().createSqlSource(config, script, DiscoverQo.class);
        var bound = source.getBoundSql(query);
        var statement = new MappedStatement.Builder(config, "audience-test", source, SqlCommandType.SELECT).build();
        var parameters = new DefaultParameterHandler(statement, query, bound);
        String countSql = new CountSqlParser().getSmartCountSql(bound.getSql());
        long total;
        try (var sql = session.getConnection().prepareStatement(countSql)) {
            parameters.setParameters(sql);
            try (var result = sql.executeQuery()) { result.next(); total = result.getLong(1); }
        }
        List<Long> ids = new ArrayList<>();
        for (int offset = 0; offset <= total; offset++) {
            try (var sql = session.getConnection().prepareStatement(bound.getSql() + " LIMIT 1 OFFSET " + offset)) {
                parameters.setParameters(sql);
                try (var rows = sql.executeQuery()) { while (rows.next()) ids.add(rows.getLong("resource_id")); }
            }
        }
        assertThat(ids).hasSize((int) total).doesNotHaveDuplicates();
        return ids;
    }

    private void execute(String sql, Object... parameters) {
        try (var statement = session.getConnection().prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) statement.setObject(i + 1, parameters[i]);
            statement.executeUpdate();
        } catch (java.sql.SQLException error) { throw new AssertionError(error); }
    }
}
