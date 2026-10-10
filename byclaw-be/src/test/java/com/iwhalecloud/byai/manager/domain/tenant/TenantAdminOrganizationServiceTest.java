package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
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
import com.iwhalecloud.byai.manager.mapper.tenant.TenantOrganizationMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantAdminOrganizationServiceTest {

    private final TenantOrganizationMapper organizationMapper = mock(TenantOrganizationMapper.class);
    private final TenantAdminMemberMapper memberMapper = mock(TenantAdminMemberMapper.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final TenantAdminOrganizationService service = new TenantAdminOrganizationService(
        organizationMapper, memberMapper, sequenceService, new ObjectMapper());

    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void rejectsWholeOrganizationWhenPackageLimitWouldBeExceeded() {
        platformAdmin();
        when(organizationMapper.selectBranchOrgIds(202L)).thenReturn(List.of(202L));
        when(memberMapper.selectPackageSnapshotForUpdate(123L)).thenReturn("{\"memberLimit\":1}");
        when(organizationMapper.selectActiveUsersByOrgIds(List.of(202L))).thenReturn(List.of(user(2L)));
        when(memberMapper.selectMembers(123L)).thenReturn(List.of(activeOwner(1L)));

        assertThatThrownBy(() -> service.attach("123", "202", true, true))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("package limit");
        verify(organizationMapper, never()).insertAttachment(anyLong(), anyLong(), anyLong());
        verify(memberMapper, never()).insertMember(anyLong(), anyLong(), anyLong(), anyLong());
    }

    @Test
    void attachesBranchAndAddsOnlyMissingMembers() {
        platformAdmin();
        when(organizationMapper.selectBranchOrgIds(202L)).thenReturn(List.of(202L, 203L));
        when(memberMapper.selectPackageSnapshotForUpdate(123L)).thenReturn("{\"memberLimit\":3}");
        when(organizationMapper.selectActiveUsersByOrgIds(List.of(202L, 203L)))
            .thenReturn(List.of(user(1L), user(2L)));
        when(memberMapper.selectMembers(123L)).thenReturn(List.of(activeOwner(1L)));
        when(organizationMapper.selectAttachedOrgIds(123L)).thenReturn(List.of(202L));
        when(sequenceService.nextVal()).thenReturn(99L);

        TenantAdminOrganizationService.AttachResult result = service.attach("123", "202", true, true);

        assertThat(result.attachedOrganizations()).isEqualTo(1);
        assertThat(result.addedMembers()).isEqualTo(1);
        assertThat(result.existingMembers()).isEqualTo(1);
        verify(organizationMapper).insertAttachment(123L, 203L, 1L);
        verify(memberMapper).insertMember(99L, 123L, 2L, 1L);
    }

    private TenantMemberRow user(long id) {
        TenantMemberRow row = new TenantMemberRow();
        row.setUserId(id);
        row.setUserCode("user" + id);
        return row;
    }

    private TenantMemberRow activeOwner(long id) {
        TenantMemberRow row = user(id);
        row.setRole("OWNER");
        row.setStatus("ACTIVE");
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
