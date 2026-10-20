package com.iwhalecloud.byai.manager.application.service.organization;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminMemberMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantOrganizationMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.manager.mapper.organization.OrganizationMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.*;

class OrganizationAdminServiceTest {
    UsersOrganizationMapper memberships = mock(UsersOrganizationMapper.class);
    UsersOrganizationService writes = mock(UsersOrganizationService.class);
    OrganizationService organizations = mock(OrganizationService.class);
    UsersMapper users = mock(UsersMapper.class);
    TenantOrganizationMapper tenantOrgs = mock(TenantOrganizationMapper.class);
    TenantAdminMemberMapper tenantMembers = mock(TenantAdminMemberMapper.class);
    OrganizationMapper organizationMapper = mock(OrganizationMapper.class);
    OrganizationAdminService service = new OrganizationAdminService(memberships, writes, organizations, users, tenantOrgs, tenantMembers, organizationMapper);

    @BeforeEach void setup() {
        com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
            new org.apache.ibatis.builder.MapperBuilderAssistant(new com.baomidou.mybatisplus.core.MybatisConfiguration(), "test"),
            UsersOrganization.class);
        LoginInfo login = new LoginInfo(); login.setEnterpriseId(1L); login.setUserId(7L); login.setUserCode("reviewer");
        login.setUsersOrganizations(List.of()); CurrentUserHolder.setLoginInfo(login);
        when(organizations.getTopOrgList()).thenReturn(List.of(10L));
        when(organizations.findSelfAndDescendantOrgIds(10L)).thenReturn(List.of(10L, 11L));
        when(organizations.findById(10L)).thenReturn(new Organization());
        when(tenantOrgs.selectActiveUsersByOrgIds(any())).thenReturn(List.of(member(7L), member(8L), member(9L)));
    }

    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    UsersOrganization role(long id, long user, String type) {
        var row = new UsersOrganization(); row.setId(id); row.setUserId(user); row.setOrgId(10L); row.setUserType(type); return row;
    }

    TenantMemberRow member(long user) {
        var row = new TenantMemberRow(); row.setUserId(user); row.setStatus("ACTIVE"); return row;
    }

    Users user(long id, String state) {
        var row = new Users(); row.setUserId(id); row.setUserName("User " + id); row.setState(state); return row;
    }

    @Test void roleRemovalTakesEffectWithoutLoggingInAgainAndParentCoversChildren() {
        when(memberships.selectList(any())).thenReturn(List.of(role(1L, 7L, "ORG_MAN")));
        assertThat(service.managedOrgIds()).containsExactlyInAnyOrder(10L, 11L);
        when(memberships.selectList(any())).thenReturn(List.of(role(2L, 7L, "ORD_USER")));
        assertThat(service.managedOrgIds()).isEmpty();
    }

    @Test void managedTenantsCannotInheritUnattachedOrganizations() {
        when(tenantMembers.selectProvisionState(1L)).thenReturn("READY");
        var membership = new com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow(); membership.setStatus("ACTIVE");
        when(tenantMembers.selectMember(1L, 7L)).thenReturn(membership);
        when(tenantOrgs.selectAttachedOrgIds(1L)).thenReturn(List.of(11L));
        when(memberships.selectList(any())).thenReturn(List.of(role(1L, 7L, "ORG_MAN")));
        assertThat(service.managedOrgIds()).containsExactly(11L);
        membership.setStatus("DISABLED"); assertThat(service.managedOrgIds()).isEmpty();
    }

    @Test void settingMultipleAdministratorsPreservesUnrelatedRolesAndMembership() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        var oldAdmin = role(1L, 7L, "ORG_MAN");
        var platform = role(2L, 8L, "PLAT_MAN");
        var member = role(3L, 9L, "ORD_USER");
        when(memberships.selectList(any())).thenReturn(List.of(oldAdmin, platform, member));
        Users a = new Users(); a.setUserId(7L); a.setUserName("A"); a.setState("A");
        Users b = new Users(); b.setUserId(8L); b.setUserName("B"); b.setState("A");
        Users c = new Users(); c.setUserId(9L); c.setUserName("C"); c.setState("A");
        when(users.selectBatchIds(any())).thenReturn(List.of(a, b, c));
        service.setAdministrators(10L, List.of(8L, 9L));
        verify(writes).removeByPrimaryKey(1L);
        verify(writes, never()).removeByPrimaryKey(2L);
        verify(writes, never()).removeByPrimaryKey(3L);
        verify(writes).save(argThat(r -> r.getUserId() == 7L && "ORD_USER".equals(r.getUserType())));
        verify(writes).save(argThat(r -> r.getUserId() == 8L && "ORG_MAN".equals(r.getUserType())));
        verify(writes).save(argThat(r -> r.getUserId() == 9L && "ORG_MAN".equals(r.getUserType())));
        assertThatThrownBy(() -> service.setAdministrators(10L, List.of(99L))).hasMessageContaining("有效成员");
    }

    @Test void ordinaryMemberCannotAssignAdministrators() {
        when(memberships.selectList(any())).thenReturn(List.of(role(1L, 7L, "ORD_USER")));
        assertThatThrownBy(() -> service.setAdministrators(10L, List.of(7L))).hasMessageContaining("无权");
        verifyNoInteractions(writes);
    }

    @Test void creationAssignsMultipleAdministratorsWithoutChangingTheirOtherOrganizations() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(users.selectBatchIds(any())).thenReturn(List.of(user(8, "A"), user(9, "A")));
        var organization = new Organization(); organization.setParentOrgId(10L);
        organization.setAdministratorIds(List.of(8L, 9L, 8L));
        doAnswer(invocation -> { organization.setOrgId(20L); return null; }).when(organizations).addOrg(organization);
        service.createOrganization(organization);
        verify(writes).save(argThat(row -> row.getOrgId() == 20L && row.getUserId() == 8L && "ORG_MAN".equals(row.getUserType())));
        verify(writes).save(argThat(row -> row.getOrgId() == 20L && row.getUserId() == 9L && "ORG_MAN".equals(row.getUserType())));
        verify(writes, times(2)).save(any());
        verify(writes, never()).removeByPrimaryKey(any());
    }

    @Test void managedTenantCreationRegistersOrganizationAndRejectsInactiveAndForeignMembersBeforeWriting() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(tenantMembers.selectProvisionState(1L)).thenReturn("READY");
        when(tenantOrgs.selectAttachedOrgIds(1L)).thenReturn(List.of(10L));
        when(tenantMembers.selectMembers(1L)).thenReturn(List.of(member(8), member(9)));
        when(users.selectBatchIds(any())).thenReturn(List.of(user(8, "A"), user(9, "X")));
        var organization = new Organization(); organization.setParentOrgId(10L);
        for (Long invalid : List.of(9L, 99L)) {
            organization.setAdministratorIds(List.of(invalid));
            assertThatThrownBy(() -> service.createOrganization(organization)).hasMessageContaining("有效成员");
        }
        verify(organizations, never()).addOrg(any());
        verifyNoInteractions(writes);
        organization.setAdministratorIds(List.of(8L));
        doAnswer(invocation -> { organization.setOrgId(20L); return null; }).when(organizations).addOrg(organization);
        service.createOrganization(organization);
        verify(tenantOrgs).insertAttachment(1L, 20L, 7L);
        verify(writes).save(argThat(row -> row.getOrgId() == 20 && row.getUserId() == 8));
    }

    @Test void candidateQueryUsesOnlyDirectOrganizationMembersAndDoesNotExposeForeignOrganizations() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(memberships.selectList(any())).thenReturn(List.of(role(1L, 8L, "ORD_USER")));
        when(users.selectBatchIds(any())).thenReturn(List.of(user(8, "A")));
        assertThat(service.getAdministratorCandidates(10L, null, 10L)).extracting(OrganizationAdminService.Member::userId).containsExactly("8");
        var wrapper = org.mockito.ArgumentCaptor.forClass(com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper.class);
        verify(memberships).selectList(wrapper.capture());
        assertThat(wrapper.getValue().getSqlSegment()).contains("org_id =").doesNotContain(" IN ");
        assertThat(wrapper.getValue().getParamNameValuePairs().values()).contains(10L);
        assertThatThrownBy(() -> service.getAdministratorCandidates(10L, null, 99L)).hasMessageContaining("不属于当前企业");
    }

    @Test void creationRequiresCurrentParentAdministratorRole() {
        var organization = new Organization(); organization.setParentOrgId(10L); organization.setAdministratorIds(List.of());
        when(memberships.selectList(any())).thenReturn(List.of(role(1L, 7L, "ORD_USER")));
        assertThatThrownBy(() -> service.createOrganization(organization)).hasMessageContaining("无权");
        verify(organizations, never()).addOrg(any());
        when(memberships.selectList(any())).thenReturn(List.of(role(1L, 7L, "ORG_MAN")));
        service.createOrganization(organization);
        verify(organizations).addOrg(organization);
    }

    @Test void editingCanAssignAnAdministratorFromAnotherOrganizationWithoutRemovingOtherRoles() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(memberships.selectList(any())).thenReturn(List.of(role(1, 7, "ORG_MAN"), role(2, 9, "PLAT_MAN")));
        when(users.selectBatchIds(argThat(ids -> ids.contains(8L)))).thenReturn(List.of(user(7, "A"), user(8, "A")));
        service.setAdministrators(10L, List.of(7L, 8L));
        verify(writes).save(argThat(row -> row.getOrgId() == 10L && row.getUserId() == 8L && "ORG_MAN".equals(row.getUserType())));
        verify(writes, never()).removeByPrimaryKey(any());
    }

    @Test void roleWriteFailureRollsBackTheOrganizationAndEarlierRoleWrites() {
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        when(users.selectBatchIds(any())).thenReturn(List.of(user(8, "A"), user(9, "A")));
        var ds = new org.springframework.jdbc.datasource.DriverManagerDataSource(
            "jdbc:h2:mem:" + java.util.UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(ds);
        jdbc.execute("CREATE TABLE organization(id BIGINT PRIMARY KEY)");
        jdbc.execute("CREATE TABLE administrator(user_id BIGINT PRIMARY KEY)");
        var organization = new Organization(); organization.setParentOrgId(10L); organization.setAdministratorIds(List.of(8L, 9L));
        doAnswer(invocation -> { organization.setOrgId(20L); jdbc.update("INSERT INTO organization VALUES(20)"); return null; })
            .when(organizations).addOrg(organization);
        doAnswer(invocation -> {
            UsersOrganization role = invocation.getArgument(0);
            if (role.getUserId() == 9L) throw new IllegalStateException("role write failed");
            jdbc.update("INSERT INTO administrator VALUES(?)", role.getUserId()); return null;
        }).when(writes).save(any());
        var proxy = new org.springframework.aop.framework.ProxyFactory(service);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new org.springframework.transaction.interceptor.TransactionInterceptor(
            new org.springframework.jdbc.datasource.DataSourceTransactionManager(ds),
            new org.springframework.transaction.annotation.AnnotationTransactionAttributeSource()));
        assertThatThrownBy(() -> ((OrganizationAdminService) proxy.getProxy()).createOrganization(organization))
            .hasMessage("role write failed");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM organization", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM administrator", Integer.class)).isZero();
    }
}
