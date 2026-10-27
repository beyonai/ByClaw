package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.quota.QuotaSnapshot;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.common.quota.SharedQuotaReader;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminMemberMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantMemberRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantAdminMemberServiceTest {

    private final TenantAdminMemberMapper memberMapper = mock(TenantAdminMemberMapper.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final SharedQuotaReader quotaReader = mock(SharedQuotaReader.class);
    private final JdbcTemplate quotaJdbc = mock(JdbcTemplate.class);
    private final SharedQuotaAdmission quota = org.mockito.Mockito.spy(new SharedQuotaAdmission(quotaReader, quotaJdbc));

    @org.junit.jupiter.api.BeforeEach
    void quotaCountsUseMembershipState() {
        when(memberMapper.countEnterprise(123L)).thenReturn(1);
        when(quotaJdbc.queryForObject(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.eq(Long.class),
            org.mockito.ArgumentMatchers.eq(123L))).thenAnswer(ignored -> (long) memberMapper.countActiveMembers(123L));
    }

    private final TenantAdminMemberService service = new TenantAdminMemberService(memberMapper, new ObjectMapper(),
        sequenceService, quota);

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void rejectsNonPlatformAdminBeforeReadingMemberships() {
        assertThatThrownBy(() -> service.add("123", "0027024710"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403");
        verify(quota, never()).beginEnterprise(123L);
    }

    @Test
    void addsActiveUserWithinPackageLimit() {
        platformAdmin();
        readyBasicTenant();
        when(sequenceService.nextVal()).thenReturn(88L);
        when(memberMapper.selectActiveUserByCode("0027024710")).thenReturn(user());
        when(memberMapper.countActiveMembers(123L)).thenReturn(9);

        TenantAdminMemberService.TenantMemberView member = service.add("123", "0027024710");

        assertThat(member.userId()).isEqualTo("77");
        assertThat(member.role()).isEqualTo("MEMBER");
        verify(memberMapper).insertMember(88L, 123L, 77L, 1L);
    }

    @Test
    void respectsPackageMemberLimit() {
        platformAdmin();
        readyBasicTenant();
        when(memberMapper.selectActiveUserByCode("0027024710")).thenReturn(user());
        when(memberMapper.countActiveMembers(123L)).thenReturn(10);

        assertThatThrownBy(() -> service.add("123", "0027024710"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("tenant.member.limit.reached");
        verify(memberMapper, never()).insertMember(org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void aValidGroupInvitationCanAdmitAnOrdinaryUserToTheTenant() {
        LoginInfo login = new LoginInfo();
        login.setUserId(77L);
        CurrentUserHolder.setLoginInfo(login);
        readyBasicTenant();
        TenantMemberRow inviter = user();
        inviter.setUserId(1L);
        inviter.setStatus("ACTIVE");
        when(memberMapper.selectMember(123L, 1L)).thenReturn(inviter);
        when(sequenceService.nextVal()).thenReturn(88L);
        when(memberMapper.insertMember(88L, 123L, 77L, 1L)).thenReturn(1);
        service.joinByInvitation(123L, 1L);
        verify(memberMapper).insertMember(88L, 123L, 77L, 1L);
    }

    @Test
    void anInvitationCannotReactivateADisabledTenantMember() {
        LoginInfo login = new LoginInfo();
        login.setUserId(77L);
        CurrentUserHolder.setLoginInfo(login);
        readyBasicTenant();
        TenantMemberRow inviter = user();
        inviter.setUserId(1L);
        inviter.setStatus("ACTIVE");
        when(memberMapper.selectMember(123L, 1L)).thenReturn(inviter);
        TenantMemberRow disabled = user();
        disabled.setStatus("DISABLED");
        when(memberMapper.selectMember(123L, 77L)).thenReturn(disabled);
        assertThatThrownBy(() -> service.joinByInvitation(123L, 1L))
            .hasMessageContaining("tenant.member.disabled");
        verify(memberMapper, never()).insertMember(org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong());
    }

    @Test
    void invitationAdmissionStillRespectsTenantMemberLimit() {
        LoginInfo login = new LoginInfo();
        login.setUserId(77L);
        CurrentUserHolder.setLoginInfo(login);
        readyBasicTenant();
        TenantMemberRow inviter = user();
        inviter.setUserId(1L);
        inviter.setStatus("ACTIVE");
        when(memberMapper.selectMember(123L, 1L)).thenReturn(inviter);
        when(memberMapper.countActiveMembers(123L)).thenReturn(10);
        assertThatThrownBy(() -> service.joinByInvitation(123L, 1L)).hasMessageContaining("tenant.member.limit.reached");
    }

    @Test
    void repeatedAdmissionPreservesExistingMembershipEvenWhenTheQuotaIsFull() {
        LoginInfo login = new LoginInfo();
        login.setUserId(77L);
        CurrentUserHolder.setLoginInfo(login);
        readyBasicTenant();
        TenantMemberRow inviter = user();
        inviter.setUserId(1L);
        inviter.setStatus("ACTIVE");
        when(memberMapper.selectMember(123L, 1L)).thenReturn(inviter);
        TenantMemberRow existing = user();
        existing.setStatus("ACTIVE");
        existing.setRole("OWNER");
        when(memberMapper.selectMember(123L, 77L)).thenReturn(existing);
        when(memberMapper.countActiveMembers(123L)).thenReturn(10);
        service.joinByInvitation(123L, 1L);
        service.joinByInvitation(123L, 1L);
        verify(memberMapper, never()).insertMember(org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong());
        assertThat(existing.getRole()).isEqualTo("OWNER");
    }

    @Test
    void missingPackageAllowsExistingEnterpriseButCannotCreateAnOrphanMembership() {
        platformAdmin();
        org.mockito.Mockito.doReturn(Optional.empty()).when(quota).beginEnterprise(123L);
        when(memberMapper.selectActiveUserByCode("0027024710")).thenReturn(user());
        when(sequenceService.nextVal()).thenReturn(88L);
        service.add("123", "0027024710");
        verify(memberMapper).insertMember(88L, 123L, 77L, 1L);
        when(memberMapper.countEnterprise(123L)).thenReturn(0);
        assertThatThrownBy(() -> service.add("123", "0027024710")).hasMessageContaining("tenant.notFound");
    }

    private void readyBasicTenant() {
        org.mockito.Mockito.doReturn(Optional.of(new QuotaSnapshot(123L, "1", 10, 5, 5, 5))).when(quota).beginEnterprise(123L);
        when(memberMapper.selectProvisionState(123L)).thenReturn("{\"status\":\"READY\"}");
    }

    private TenantMemberRow user() {
        TenantMemberRow row = new TenantMemberRow();
        row.setUserId(77L);
        row.setUserCode("0027024710");
        row.setUserName("tester");
        return row;
    }

    private void platformAdmin() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }
}
