package com.iwhalecloud.byai.manager.application.service.enterprise;

import com.iwhalecloud.byai.common.constants.enterprise.TenantUserMembershipRole;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.TenantUserMembershipService;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseInfoDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseRemoveDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseSwitchDTO;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.vo.enterprise.UserEnterpriseVo;
import jakarta.servlet.http.HttpSession;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EnterpriseInfoApplicationServiceTest {

    private EnterpriseInfoService enterpriseInfoService;

    private TenantUserMembershipService tenantUserMembershipService;

    private LoginApplicationService loginApplicationService;

    private UserService userService;

    private EnterpriseInfoApplicationService service;

    @BeforeEach
    void setUp() {
        enterpriseInfoService = mock(EnterpriseInfoService.class);
        tenantUserMembershipService = mock(TenantUserMembershipService.class);
        loginApplicationService = mock(LoginApplicationService.class);
        userService = mock(UserService.class);
        service = new EnterpriseInfoApplicationService();
        ReflectionTestUtils.setField(service, "enterpriseInfoService", enterpriseInfoService);
        ReflectionTestUtils.setField(service, "tenantUserMembershipService", tenantUserMembershipService);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginApplicationService);
        ReflectionTestUtils.setField(service, "userService", userService);
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.setUseCodeAsDefaultMessage(true);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(7L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void updateAllowsEnterpriseOwnerWithoutPlatformAdmin() {
        when(tenantUserMembershipService.findActiveByUserIdAndEnterpriseId(7L, 21L))
            .thenReturn(membership(TenantUserMembershipRole.OWNER));
        when(enterpriseInfoService.findById(21L)).thenReturn(new EnterpriseInfo());
        when(enterpriseInfoService.existsByComAcctCode("acme", 21L)).thenReturn(false);

        service.update(enterprise(21L));

        verify(enterpriseInfoService).update(any(EnterpriseInfo.class));
    }

    @Test
    void updateRejectsNonOwner() {
        when(tenantUserMembershipService.findActiveByUserIdAndEnterpriseId(7L, 21L))
            .thenReturn(membership(TenantUserMembershipRole.ADMIN));

        assertThatThrownBy(() -> service.update(enterprise(21L)))
            .isInstanceOf(BaseException.class)
            .hasMessage("enterprise.edit.permission.deny");
        verify(enterpriseInfoService, never()).update(any());
    }

    @Test
    void removeAllowsEnterpriseOwner() {
        when(tenantUserMembershipService.findActiveByUserIdAndEnterpriseId(7L, 21L))
            .thenReturn(membership(TenantUserMembershipRole.OWNER));
        when(enterpriseInfoService.findById(21L)).thenReturn(new EnterpriseInfo());

        EnterpriseRemoveDTO removeDTO = new EnterpriseRemoveDTO();
        removeDTO.setEnterpriseId(21L);
        service.remove(removeDTO);

        verify(tenantUserMembershipService).removeByEnterpriseId(21L);
        verify(enterpriseInfoService).removeById(21L);
    }

    @Test
    void removeRejectsNonOwner() {
        when(tenantUserMembershipService.findActiveByUserIdAndEnterpriseId(7L, 21L)).thenReturn(null);

        EnterpriseRemoveDTO removeDTO = new EnterpriseRemoveDTO();
        removeDTO.setEnterpriseId(21L);
        assertThatThrownBy(() -> service.remove(removeDTO))
            .isInstanceOf(BaseException.class)
            .hasMessage("enterprise.edit.permission.deny");
        verify(enterpriseInfoService, never()).removeById(any());
    }

    @Test
    void listUserEnterprisesIncludesDefaultEnterpriseWithoutMembership() {
        UserEnterpriseVo tenant = userEnterprise(21L, "Acme", "acme",
            TenantUserMembershipRole.MEMBER, "ACTIVE");
        when(tenantUserMembershipService.listUserEnterprises(7L)).thenReturn(List.of(tenant));
        when(enterpriseInfoService.findById(1L)).thenReturn(enterpriseInfo(1L, "Default", "default"));

        List<UserEnterpriseVo> enterprises = service.listUserEnterprises();

        assertThat(enterprises).hasSize(2);
        assertThat(enterprises.get(0).getEnterpriseId()).isEqualTo(1L);
        assertThat(enterprises.get(0).getComAcctName()).isEqualTo("Default");
        assertThat(enterprises.get(0).getComAcctCode()).isEqualTo("default");
        assertThat(enterprises.get(0).getRole()).isEqualTo(TenantUserMembershipRole.MEMBER);
        assertThat(enterprises.get(0).getStatus()).isEqualTo("ACTIVE");
        assertThat(enterprises.get(1)).isSameAs(tenant);
    }

    @Test
    void listUserEnterprisesDoesNotDuplicateDefaultEnterpriseMembership() {
        UserEnterpriseVo defaultEnterprise = userEnterprise(1L, "Default", "default",
            TenantUserMembershipRole.MEMBER, "ACTIVE");
        when(tenantUserMembershipService.listUserEnterprises(7L)).thenReturn(List.of(defaultEnterprise));

        List<UserEnterpriseVo> enterprises = service.listUserEnterprises();

        assertThat(enterprises).containsExactly(defaultEnterprise);
        verify(enterpriseInfoService, never()).findById(1L);
    }

    @Test
    void switchToDefaultEnterpriseDoesNotRequireTenantMembership() {
        EnterpriseSwitchDTO switchDTO = new EnterpriseSwitchDTO();
        switchDTO.setEnterpriseId(1L);
        HttpSession session = mock(HttpSession.class);
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        when(enterpriseInfoService.findById(1L)).thenReturn(enterpriseInfo(1L, "Default", "default"));

        Long enterpriseId = service.switchTo(switchDTO, session);

        assertThat(enterpriseId).isEqualTo(1L);
        assertThat(loginInfo.getEnterpriseId()).isEqualTo(1L);
        assertThat(loginInfo.getComAcctId()).isEqualTo(1L);
        verify(tenantUserMembershipService, never()).findActiveByUserIdAndEnterpriseId(7L, 1L);
        verify(loginApplicationService).shareSession(session, loginInfo);
    }

    @Test
    void switchToTenantStillRequiresActiveMembership() {
        EnterpriseSwitchDTO switchDTO = new EnterpriseSwitchDTO();
        switchDTO.setEnterpriseId(21L);
        HttpSession session = mock(HttpSession.class);
        when(enterpriseInfoService.findById(21L)).thenReturn(enterpriseInfo(21L, "Acme", "acme"));
        when(tenantUserMembershipService.findActiveByUserIdAndEnterpriseId(7L, 21L)).thenReturn(null);

        assertThatThrownBy(() -> service.switchTo(switchDTO, session))
            .isInstanceOf(BaseException.class)
            .hasMessage("enterprise.membership.required");
        verify(loginApplicationService, never()).shareSession(any(), any());
    }

    private EnterpriseInfoDTO enterprise(Long enterpriseId) {
        EnterpriseInfoDTO dto = new EnterpriseInfoDTO();
        dto.setEnterpriseId(enterpriseId);
        dto.setComAcctName("Acme");
        dto.setComAcctCode("acme");
        return dto;
    }

    private TenantUserMembership membership(String role) {
        TenantUserMembership membership = new TenantUserMembership();
        membership.setUserId(7L);
        membership.setEnterpriseId(21L);
        membership.setRole(role);
        return membership;
    }

    private EnterpriseInfo enterpriseInfo(Long enterpriseId, String name, String code) {
        EnterpriseInfo enterpriseInfo = new EnterpriseInfo();
        enterpriseInfo.setEnterpriseId(enterpriseId);
        enterpriseInfo.setComAcctName(name);
        enterpriseInfo.setComAcctCode(code);
        return enterpriseInfo;
    }

    private UserEnterpriseVo userEnterprise(Long enterpriseId, String name, String code, String role, String status) {
        UserEnterpriseVo enterprise = new UserEnterpriseVo();
        enterprise.setEnterpriseId(enterpriseId);
        enterprise.setComAcctName(name);
        enterprise.setComAcctCode(code);
        enterprise.setRole(role);
        enterprise.setStatus(status);
        return enterprise;
    }
}
