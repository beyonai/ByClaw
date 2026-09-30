package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.List;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DigitalEmployeeGovernanceServiceTest {
    UserService users = mock(UserService.class);
    com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper publications = mock(com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper.class);
    DigitalEmployeeGovernanceService governance = new DigitalEmployeeGovernanceService(users, mock(ByaiSystemConfigService.class), publications);
    AuthApplicationService auth = spy(new AuthApplicationService());
    PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
    @BeforeEach void setup() {
        ReflectionTestUtils.setField(auth, "employeeGovernance", governance);
        ReflectionTestUtils.setField(auth, "privilegeGrantService", grants);
        doReturn(List.of()).when(auth).listAuthPrivilegeGrant(anyString(), any(), anyString(), anyLong(), isNull());
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(1L)).thenReturn(creator);
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }
    @ParameterizedTest @ValueSource(strings = {"COMMON", "PLAT_MAN", "BUSINESS_MAN", "ORG_MAN", "PLAT_DEVOPS"})
    void adminvipOwnershipUsesNormalExplicitManagementGrant(String role) {
        EmployeePublicationApplicationServiceTest.login("manager", 2L, List.of(role));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isFalse();
        assertThat(auth.hasResourceInstallTargetManagePermission(resource)).isFalse();
        assertThat(governance.isProtected(resource)).isFalse();
        var grant = new com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant();
        grant.setGrantObjId(10L);
        grant.setGrantToType("RED");
        grant.setStatusCd("A");
        doReturn(List.of(grant)).when(auth).listAuthPrivilegeGrant(anyString(), any(), anyString(), anyLong(), isNull());
        assertThat(auth.hasResourceManagePermission(resource)).isTrue();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isTrue();
        assertThat(auth.hasResourceInstallTargetManagePermission(resource)).isTrue();
        assertThatCode(() -> auth.validateEmployeeAuthorizationPermission(resource)).doesNotThrowAnyException();
        assertThatCode(() -> governance.requireDirectMutationAllowed(resource)).doesNotThrowAnyException();
        // 相同入口的批量权限也不因创建者为 adminvip 而覆盖管理授权。
        Boolean batchManage = ReflectionTestUtils.invokeMethod(auth, "hasResourceMemberSettingPermission",
            resource, 2L, java.util.Set.of(10L));
        assertThat(batchManage).isTrue();
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        permissions.setCanEdit(true);
        permissions.setCanManageAuth(true);
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
        assertThat(permissions.isCanEdit()).isTrue();
        assertThat(permissions.isCanManageAuth()).isTrue();
    }
    @Test void adminvipRetainsMaintenanceRights() {
        EmployeePublicationApplicationServiceTest.login("adminvip", 1L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        assertThat(auth.hasResourceManagePermission(resource)).isTrue();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isTrue();
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void adminvipCreatedEmployeeKeepsNormalAuthorizationForAdminvip(boolean official) {
        EmployeePublicationApplicationServiceTest.login("adminvip", 1L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        resource.setOwnerType("enterprise");
        if (official) resource.setPublicationSourceId(9L);
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        permissions.setCanManageAuth(true);
        permissions.setCanUseAuth(true);
        permissions.setCanEdit(true);
        permissions.setHasManagePermission(true);
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
        assertThat(permissions.isCanManageAuth()).isTrue();
        assertThat(permissions.isCanUseAuth()).isTrue();
        assertThat(permissions.isCanEdit()).isTrue();
        assertThat(permissions.isHasManagePermission()).isTrue();
    }

    @Test void manageAuthorizationVisibilityDoesNotChangeForOtherCreatorsOrNonEmployees() {
        EmployeePublicationApplicationServiceTest.login("adminvip", 1L, List.of());
        SsResource ordinaryEmployee = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        SsResource skill = EmployeePublicationApplicationServiceTest.employee(11L, 1L);
        skill.setResourceBizType("SKILL");
        for (SsResource resource : List.of(ordinaryEmployee, skill)) {
            var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
            permissions.setCanManageAuth(true);
            ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
            assertThat(permissions.isCanManageAuth()).isTrue();
        }
    }
    @Test void platformCanProposePublicationOfAdminvipEmployeeWithoutGettingMaintenancePermissions() {
        EmployeePublicationApplicationServiceTest.login("platform", 2L, List.of("PLAT_MAN"));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        assertThat(governance.canPublish(resource)).isTrue();
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
        assertThatCode(() -> governance.requireDirectMutationAllowed(resource)).doesNotThrowAnyException();
        resource.setComAcctId(2L);
        assertThat(governance.canPublish(resource)).isFalse();
    }
    @Test void officialAuthorCanProposeChangesButCannotModifyGrantsOrInstallLiveSkills() {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise"); resource.setPublicationSourceId(9L);
        assertThat(auth.hasResourceManagePermission(resource)).isTrue();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isFalse();
        assertThat(auth.hasResourceInstallTargetManagePermission(resource)).isFalse();
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource)).hasMessageContaining("更新审核");
        assertThatThrownBy(() -> auth.validateEmployeeAuthorizationPermission(resource)).hasMessageContaining("仅官方管理员");
    }
    @ParameterizedTest @ValueSource(strings = {"adminvip", "PLAT_MAN"})
    void administratorsCanSaveOfficialCopyDirectly(String identity) {
        EmployeePublicationApplicationServiceTest.login(identity, 2L, List.of(identity));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise"); resource.setPublicationSourceId(9L);
        assertThatCode(() -> governance.requireDirectMutationAllowed(resource)).doesNotThrowAnyException();
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
        assertThat(permissions.isOfficialPublication()).isTrue();
        assertThat(permissions.isOfficialUpdateRequiresReview()).isFalse();
    }
    @ParameterizedTest @ValueSource(strings = {"DRAFT", "PENDING", "APPLYING", "FAILED"})
    void directSaveCannotRaceOutstandingOfficialUpdate(String state) {
        EmployeePublicationApplicationServiceTest.login("adminvip", 2L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setPublicationSourceId(9L);
        var active = new com.iwhalecloud.byai.manager.entity.resource.DigitalEmployeePublication();
        active.setStatus(state);
        when(publications.active(9L, 1L)).thenReturn(active);
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource)).hasMessageContaining("未完成的更新申请");
    }
    @ParameterizedTest @ValueSource(strings = {"USER", "ORG_MAN", "BUSINESS_MAN"})
    void officialAuthorSavesRequireReviewRegardlessOfNonPlatformRole(String role) {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of(role));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setPublicationSourceId(9L);
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource)).hasMessageContaining("更新审核");
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
        assertThat(permissions.isOfficialUpdateRequiresReview()).isTrue();
    }
    @Test void directOfficialSaveIgnoresCreatorIdentityButStillEnforcesTenantBoundary() {
        EmployeePublicationApplicationServiceTest.login("platform", 2L, List.of("PLAT_MAN"));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        resource.setPublicationSourceId(9L);
        assertThatCode(() -> governance.requireDirectMutationAllowed(resource)).doesNotThrowAnyException();
        resource.setCreateBy(7L); resource.setComAcctId(99L);
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource));
    }
    @Test void ordinaryAndBusinessAdministratorsCannotCreateEnterpriseEmployees() {
        for (String role : List.of("COMMON", "BUSINESS_MAN", "ORG_MAN", "PLAT_DEVOPS")) {
            EmployeePublicationApplicationServiceTest.login("user", 7L, List.of(role));
            assertThatThrownBy(() -> DigitalEmployeeGovernanceService.requireEnterpriseCreationAllowed("enterprise"));
            assertThatCode(() -> DigitalEmployeeGovernanceService.requireEnterpriseCreationAllowed("personal")).doesNotThrowAnyException();
        }
        EmployeePublicationApplicationServiceTest.login("platform", 7L, List.of("PLAT_MAN"));
        assertThatCode(() -> DigitalEmployeeGovernanceService.requireEnterpriseCreationAllowed("enterprise")).doesNotThrowAnyException();
    }
    @Test void publishedSkillSnapshotsAreImmutableEvenForCreatorAndAdminvip() {
        SsResource skill = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        skill.setResourceBizType("SKILL"); skill.setPublicationRequestId(20L);
        for (String code : List.of("author", "adminvip")) {
            EmployeePublicationApplicationServiceTest.login(code, 7L, List.of());
            assertThat(auth.hasResourceManagePermission(skill)).isFalse();
            assertThat(auth.hasResourceUseSettingPermission(skill)).isFalse();
        }
    }
}
