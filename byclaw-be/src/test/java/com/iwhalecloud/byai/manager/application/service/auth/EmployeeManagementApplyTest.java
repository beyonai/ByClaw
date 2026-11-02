package com.iwhalecloud.byai.manager.application.service.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationScopeService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyQo;
import java.util.List;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;

class EmployeeManagementApplyTest {
    AuthApplicationService service = spy(new AuthApplicationService());
    PrivilegeGrantMapper grants = mock(PrivilegeGrantMapper.class);
    PrivilegeGrantService writes = mock(PrivilegeGrantService.class);
    SsResourceMapper resources = mock(SsResourceMapper.class);
    EmployeePublicationScopeService scopes = mock(EmployeePublicationScopeService.class);
    SsResource employee = new SsResource();
    DigitalEmployeeResourceAuthorizationService synchronization = mock(DigitalEmployeeResourceAuthorizationService.class);

    @BeforeEach void setup() {
        LoginInfo login = new LoginInfo(); login.setUserId(7L); login.setUserCode("reviewer");
        login.setEnterpriseId(1L); login.setUsersOrganizations(List.of()); CurrentUserHolder.setLoginInfo(login);
        employee.setResourceId(900L); employee.setComAcctId(1L); employee.setOwnerType("enterprise");
        employee.setCreateBy(8L); employee.setResourceCode("employee-900");
        employee.setResourceBizType("DIG_EMPLOYEE"); employee.setResourceStatus(2);
        ReflectionTestUtils.setField(service, "privilegeGrantMapper", grants);
        ReflectionTestUtils.setField(service, "privilegeGrantService", writes);
        ReflectionTestUtils.setField(service, "ssResourceMapper", resources);
        ReflectionTestUtils.setField(service, "employeeScopes", scopes);
        when(resources.selectById(900L)).thenReturn(employee);
        ReflectionTestUtils.setField(service, "employeeResourceAuthorizationService", synchronization);
        when(synchronization.lockForAuthorization(employee)).thenReturn(employee);
        doReturn(false).when(service).hasCurrentUserAllowManagePrivilege(employee);
        var messages = mock(org.springframework.context.MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(java.util.Locale.class))).thenAnswer(call ->
            "auth.application.review.denied".equals(call.getArgument(0)) ? "没有该申请的审核权限" : call.getArgument(0));
        ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class, "messageSource", messages);
        doNothing().when(service).synchronizeDigitalEmployeeResourceUsers(any(), any());
        doNothing().when(service).syncUserAuthToRedis(anyLong());
    }

    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    @Test void manageApplicationDoesNotCreateEffectiveManagementPermission() {
        doReturn(true).when(service).hasResourceAccessPermission(employee);
        doReturn(false).when(service).hasResourceManagePermission(employee);
        var request = new ResourceUseApplyQo(); request.setResourceId(900L); request.setPermissionType("MANAGE");
        service.applyUse(request);
        verify(writes).save(argThat(p -> "MANAGE_APPLY".equals(p.getGrantType()) && "P".equals(p.getStatusCd())
            && p.getGrantToObjId() == 7L && "WRITE".equals(p.getOperType())));
        verify(writes, never()).save(argThat(p -> "ALLOW_MANAGE".equals(p.getGrantType())));
    }

    ResourceUseApplyApproveQo pending() {
        var apply = new PrivilegeGrant(); apply.setPrivilegeGrantId(100L); apply.setGrantType("MANAGE_APPLY");
        apply.setStatusCd("P"); apply.setGrantObjId(900L); apply.setGrantToObjId(42L);
        when(grants.selectOne(any())).thenReturn(apply);
        var request = new ResourceUseApplyApproveQo(); request.setResourceId(900L); request.setApplyUserId(42L); request.setAuditType("MANAGE");
        when(scopes.canReviewApplicant(employee, 42L)).thenReturn(true);
        return request;
    }

    @Test void approvedManageApplicationGrantsManageAndRefreshesUserPermissions() {
        var request = pending(); when(grants.update(any(), any())).thenReturn(1);
        service.approveUseApply(request);
        verify(writes).save(argThat(p -> "ALLOW_MANAGE".equals(p.getGrantType()) && "A".equals(p.getStatusCd()) && p.getGrantToObjId() == 42L));
        verify(synchronization).synchronizeApprovedApplicant(employee, 42L);
        verify(service).syncUserAuthToRedis(42L);
    }

    @Test void lostConcurrentDecisionCannotCreateASecondGrant() {
        var request = pending(); when(grants.update(any(), any())).thenReturn(0);
        assertThatThrownBy(() -> service.approveUseApply(request)).hasMessageContaining("已被处理");
        verifyNoInteractions(writes);
        verify(synchronization, never()).synchronizeApprovedApplicant(any(), any());
    }

    @Test void anOrganizationAdministratorCannotApproveAcrossThePublishedAudience() {
        var request = pending(); when(scopes.canReviewApplicant(employee, 42L)).thenReturn(false);
        assertThatThrownBy(() -> service.approveUseApply(request)).hasMessageContaining("审核权限");
        verify(grants, never()).update(any(), any()); verifyNoInteractions(writes);
    }
}
