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
        if (published) resource.setPublicationSourceId(id - 1);
        session.getMapper(SsResourceMapper.class).insert(resource);
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
}
