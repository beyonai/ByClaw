package com.iwhalecloud.byai.manager.application.service.login;

import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class LoginApplicationServiceTest {

    @Test
    void getLoginInfo_populatesDefaultDigEmployeeIdFromSuperassist() {
        OrganizationService organizationService = mock(OrganizationService.class);
        EnterpriseInfoService enterpriseInfoService = mock(EnterpriseInfoService.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        SuasSuperassistService suasSuperassistService = mock(SuasSuperassistService.class);

        LoginApplicationService service = new LoginApplicationService();
        ReflectionTestUtils.setField(service, "organizationService", organizationService);
        ReflectionTestUtils.setField(service, "enterpriseInfoService", enterpriseInfoService);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "suasSuperassistService", suasSuperassistService);

        Users users = new Users();
        users.setUserId(1L);
        users.setUserCode("zhangsan");
        users.setUserName("张三");
        users.setAssistantId(7L);

        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setDefaultDigEmployeeId(200L);

        when(enterpriseInfoService.getEnterpriseId()).thenReturn(99L);
        when(organizationService.findUsersOrganizationByUserId(1L)).thenReturn(List.of());
        when(privilegeGrantService.findUserManageOrg(1L)).thenReturn(List.of());
        when(suasSuperassistService.findByUserId(1L)).thenReturn(superassist);

        LoginInfo result = service.getLoginInfo(users);

        assertThat(result.getUserId()).isEqualTo(1L);
        assertThat(result.getAssistantId()).isEqualTo(7L);
        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(200L);
        assertThat(result.getEnterpriseId()).isEqualTo(99L);
        assertThat(result.getComAcctId()).isEqualTo(99L);
    }
}
