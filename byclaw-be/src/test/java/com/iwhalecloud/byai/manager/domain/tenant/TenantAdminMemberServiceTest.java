package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import com.fasterxml.jackson.databind.ObjectMapper;
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
    private final TenantAdminMemberService service = new TenantAdminMemberService(memberMapper, new ObjectMapper(),
        sequenceService);

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void rejectsNonPlatformAdminBeforeReadingMemberships() {
        assertThatThrownBy(() -> service.add("123", "0027024710"))
            .isInstanceOf(ResponseStatusException.class)
            .hasMessageContaining("403");
        verify(memberMapper, never()).selectPackageSnapshotForUpdate(123L);
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
            .hasMessageContaining("member limit reached");
        verify(memberMapper, never()).insertMember(org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong(),
            org.mockito.ArgumentMatchers.anyLong());
    }

    private void readyBasicTenant() {
        when(memberMapper.selectPackageSnapshotForUpdate(123L)).thenReturn("{\"memberLimit\":10}");
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
