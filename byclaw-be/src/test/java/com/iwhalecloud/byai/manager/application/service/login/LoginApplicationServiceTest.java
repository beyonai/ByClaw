package com.iwhalecloud.byai.manager.application.service.login;

import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.common.constants.login.ShareSessionKey;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLoginAutoStartService;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.mock.web.MockHttpServletRequest;

import java.util.List;

import jakarta.servlet.http.HttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LoginApplicationServiceTest {

    @Test
    void logoutDoesNotCreateSessionWhenRequestHasNoSession() {
        LoginApplicationService service = new LoginApplicationService();
        HttpServletRequest request = mock(HttpServletRequest.class);
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        when(request.getSession(false)).thenReturn(null);

        service.logout(request);

        verify(request).getSession(false);
        verify(request, never()).getSession();
    }

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
        users.setAvatar("/commonFile/preview?filePath=avatar.png");

        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setDefaultDigEmployeeId(200L);

        when(enterpriseInfoService.getEnterpriseId()).thenReturn(99L);
        when(organizationService.findUsersOrganizationByUserId(1L)).thenReturn(List.of());
        when(privilegeGrantService.findUserManageOrg(1L)).thenReturn(List.of());
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        LoginInfo result = service.getLoginInfo(users);

        assertThat(result.getUserId()).isEqualTo(1L);
        assertThat(result.getAssistantId()).isEqualTo(7L);
        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(200L);
        assertThat(result.getEnterpriseId()).isEqualTo(99L);
        assertThat(result.getComAcctId()).isEqualTo(99L);
        assertThat(result.getAvatar()).isEqualTo(users.getAvatar());
        assertThat(service.buildShareCurrentUserObjectMap(result)).containsEntry("avatar", users.getAvatar());
    }

    @Test
    void currentUserReturnsSavedAvatarInsteadOfOldSessionAvatar() {
        LoginApplicationService service = new LoginApplicationService();
        UserService userService = mock(UserService.class);
        SuasSuperassistService superassistService = mock(SuasSuperassistService.class);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "userApplicationService", mock(UserApplicationService.class));
        ReflectionTestUtils.setField(service, "suasSuperassistService", superassistService);
        ReflectionTestUtils.setField(service, "sandboxLoginAutoStartService", mock(SandboxLoginAutoStartService.class));
        ReflectionTestUtils.setField(service, "authRedisSyncService", mock(AuthRedisSyncService.class));
        Users user = new Users();
        user.setUserId(1L);
        user.setUserName("新名字");
        user.setAvatar("saved-avatar");
        when(userService.findById(1L)).thenReturn(user);
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSessionDatasetId(10L);
        superassist.setDefaultDigEmployeeId(20L);
        when(superassistService.findById(1L)).thenReturn(superassist);
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.getSession().setAttribute("userCode", "tester");
        request.getSession().setAttribute(ShareSessionKey.SHARE_CURRENT_USER,
            "{\"userId\":1,\"userCode\":\"tester\",\"avatar\":\"old-avatar\"}");

        LoginInfo result = service.currentUser(request).getData();

        assertThat(result.getUserName()).isEqualTo("新名字");
        assertThat(result.getAvatar()).isEqualTo("saved-avatar");
    }

    @Test
    void doAsyncJobAfterLogin_usesUnifiedAutoStartAndKeepsAuthSyncIndependent() {
        LoginApplicationService service = new LoginApplicationService();
        SandboxLoginAutoStartService autoStartService = mock(SandboxLoginAutoStartService.class);
        AuthRedisSyncService authRedisSyncService = mock(AuthRedisSyncService.class);
        ReflectionTestUtils.setField(service, "sandboxLoginAutoStartService", autoStartService);
        ReflectionTestUtils.setField(service, "authRedisSyncService", authRedisSyncService);
        doThrow(new IllegalStateException("submit failed")).when(autoStartService).trigger("user001");

        ReflectionTestUtils.invokeMethod(service, "doAsyncJobAfterLogin", "user001", 1L);

        verify(autoStartService).trigger("user001");
        verify(authRedisSyncService).asyncSyncUserAuthToRedis(1L);
        verify(authRedisSyncService).asyncSyncUserManageAuthToRedis(1L);
    }
}
