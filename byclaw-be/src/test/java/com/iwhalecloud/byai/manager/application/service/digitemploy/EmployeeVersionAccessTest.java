package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class EmployeeVersionAccessTest {
    @Test void creatorExplicitManagerAndSuperAdminAreAllowedButPlatformRoleAloneIsNot() {
        var auth = mock(AuthApplicationService.class); var access = new EmployeeVersionAccess(auth);
        var resource = new SsResource(); resource.setResourceId(10L); resource.setCreateBy(20L);
        resource.setComAcctId(100L); resource.setResourceBizType("DIG_EMPLOYEE"); resource.setResourceStatus(2);
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(20L);
            user.when(CurrentUserHolder::getEnterpriseId).thenReturn(100L);
            assertTrue(access.canManage(resource));
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(30L);
            user.when(CurrentUserHolder::isPlatformManager).thenReturn(true);
            assertFalse(access.canManage(resource));
            when(auth.hasCurrentUserAllowManagePrivilege(resource)).thenReturn(true);
            assertTrue(access.canManage(resource));
            when(auth.hasCurrentUserAllowManagePrivilege(resource)).thenReturn(false);
            user.when(CurrentUserHolder::isAdminVip).thenReturn(true); assertTrue(access.canManage(resource));
            resource.setComAcctId(200L); assertFalse(access.canManage(resource));
        }
    }
    @Test void revokedGrantOrDeletedEmployeeImmediatelyPreventsVersionAccess() {
        var auth = mock(AuthApplicationService.class); var access = new EmployeeVersionAccess(auth);
        var resource = new SsResource(); resource.setCreateBy(20L); resource.setComAcctId(100L);
        resource.setResourceBizType("DIG_EMPLOYEE"); resource.setResourceStatus(2);
        try (var user = mockStatic(CurrentUserHolder.class)) {
            user.when(CurrentUserHolder::getCurrentUserId).thenReturn(30L);
            user.when(CurrentUserHolder::getEnterpriseId).thenReturn(100L);
            when(auth.hasCurrentUserAllowManagePrivilege(resource)).thenReturn(true); assertTrue(access.canManage(resource));
            when(auth.hasCurrentUserAllowManagePrivilege(resource)).thenReturn(false); assertFalse(access.canManage(resource));
            user.when(CurrentUserHolder::isAdminVip).thenReturn(true); resource.setResourceStatus(-1);
            assertFalse(access.canManage(resource));
        }
    }
}
