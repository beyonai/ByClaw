package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.auth.DigitalEmployeeAuthQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeAuthVo;

class ResourceAuthApplicationServiceTest {

    @Test
    void listDigitalEmployeeAuthByUser_usesAncestorOrganizationsForPermissionCalculation() {
        ResourceAuthApplicationService service = new ResourceAuthApplicationService();
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        OrganizationService organizationService = mock(OrganizationService.class);
        UserService userService = mock(UserService.class);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "userService", userService);

        Users user = new Users();
        user.setUserId(1001L);
        UsersOrganization directOrganization = new UsersOrganization();
        directOrganization.setOrgId(20L);
        directOrganization.setPositionId(30L);
        when(userService.findById(1001L)).thenReturn(user);
        when(organizationService.findUsersOrganizationByUserId(1001L)).thenReturn(List.of(directOrganization));
        when(organizationService.findEffectiveOrganizationIdsByUserId(1001L)).thenReturn(Set.of(10L, 20L));
        PageInfo<DigitalEmployeeAuthVo> emptyPage = new PageInfo<>();
        emptyPage.setList(List.of());
        when(privilegeGrantService.listDigitalEmployeeAuthByUser(any())).thenReturn(emptyPage);

        DigitalEmployeeAuthQo qo = new DigitalEmployeeAuthQo();
        qo.setGrantToObjId(1001L);
        service.listDigitalEmployeeAuthByUser(qo);

        ArgumentCaptor<AuthQo> captor = ArgumentCaptor.forClass(AuthQo.class);
        verify(privilegeGrantService).listDigitalEmployeeAuthByUser(captor.capture());
        assertThat(captor.getValue().getUserOrgIds()).containsExactlyInAnyOrder(10L, 20L);
        assertThat(captor.getValue().getUserPositionIds()).containsExactly(30L);
    }
}
