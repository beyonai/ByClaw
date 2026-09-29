package com.iwhalecloud.byai.manager.application.service.enterprise;

import com.iwhalecloud.byai.common.constants.enterprise.TenantUserMembershipRole;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.TenantUserMembershipService;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseInfoDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseRemoveDTO;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class EnterpriseInfoApplicationServiceTest {

    private EnterpriseInfoService enterpriseInfoService;

    private TenantUserMembershipService tenantUserMembershipService;

    private EnterpriseInfoApplicationService service;

    @BeforeEach
    void setUp() {
        enterpriseInfoService = mock(EnterpriseInfoService.class);
        tenantUserMembershipService = mock(TenantUserMembershipService.class);
        service = new EnterpriseInfoApplicationService();
        ReflectionTestUtils.setField(service, "enterpriseInfoService", enterpriseInfoService);
        ReflectionTestUtils.setField(service, "tenantUserMembershipService", tenantUserMembershipService);
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
}
