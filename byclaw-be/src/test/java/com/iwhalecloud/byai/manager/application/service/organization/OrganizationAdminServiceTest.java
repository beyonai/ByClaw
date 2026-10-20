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
    OrganizationAdminService service = new OrganizationAdminService(memberships, writes, organizations, users, tenantOrgs, tenantMembers);

    @BeforeEach void setup() {
        LoginInfo login = new LoginInfo(); login.setEnterpriseId(1L); login.setUserId(7L); login.setUserCode("reviewer");
        login.setUsersOrganizations(List.of()); CurrentUserHolder.setLoginInfo(login);
        when(organizations.getTopOrgList()).thenReturn(List.of(10L));
        when(organizations.findSelfAndDescendantOrgIds(10L)).thenReturn(List.of(10L, 11L));
        when(organizations.findById(10L)).thenReturn(new Organization());
    }

    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    UsersOrganization role(long id, long user, String type) {
        var row = new UsersOrganization(); row.setId(id); row.setUserId(user); row.setOrgId(10L); row.setUserType(type); return row;
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
}
