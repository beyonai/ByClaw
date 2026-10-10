package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.context.MessageSource;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class DigitalEmployeeGovernanceServiceTest {
    UserService users = mock(UserService.class);
    com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper publications = mock(com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper.class);
    SsResExtDigEmployeeService extensions = mock(SsResExtDigEmployeeService.class);
    DigitalEmployeeGovernanceService governance = new DigitalEmployeeGovernanceService(users, mock(ByaiSystemConfigService.class), publications, extensions);
    AuthApplicationService auth = spy(new AuthApplicationService());
    PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
    MessageSource originalMessageSource;
    @BeforeEach void setup() {
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        MessageSource messages = mock(MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(Locale.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        ReflectionTestUtils.setField(auth, "employeeGovernance", governance);
        ReflectionTestUtils.setField(auth, "privilegeGrantService", grants);
        doReturn(List.of()).when(auth).listAuthPrivilegeGrant(anyString(), any(), anyString(), anyLong(), isNull());
        Users creator = new Users(); creator.setUserCode("adminvip"); when(users.findById(1L)).thenReturn(creator);
        SsResExtDigEmployee employee = new SsResExtDigEmployee(); employee.setAgentType("001");
        when(extensions.findById(10L)).thenReturn(employee);
    }
    @AfterEach void cleanup() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
    }
    @ParameterizedTest @ValueSource(strings = {"COMMON", "PLAT_MAN", "BUSINESS_MAN", "ORG_MAN", "PLAT_DEVOPS"})
    void adminvipOwnershipUsesNormalExplicitManagementGrant(String role) {
        EmployeePublicationApplicationServiceTest.login("manager", 2L, List.of(role));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        resource.setOwnerType("enterprise");
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
        // 有效黑名单仍优先于白名单，不能因停用创建者保护而放宽授权冲突。
        var deny = new com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant();
        deny.setGrantObjId(10L);
        deny.setGrantToType("BLACK");
        deny.setStatusCd("A");
        doReturn(List.of(grant, deny)).when(auth).listAuthPrivilegeGrant(anyString(), any(), anyString(), anyLong(), isNull());
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isFalse();
        assertThat(auth.hasResourceInstallTargetManagePermission(resource)).isFalse();
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

    /** 发布资格在单条和批量接口中一致，批量查询不退化为逐员工查询。 */
    @Test void publicationPermissionsRejectGroupsThirdPartyAndMissingExtensionsInBothPaths() {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        for (String kind : List.of("ordinary", "group", "thirdParty", "externalDev", "invalid", "missing")) {
            SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
            SsResExtDigEmployee extension = new SsResExtDigEmployee();
            extension.setAgentType("group".equals(kind) ? "017" : "invalid".equals(kind) ? "unknown" : "001");
            if ("thirdParty".equals(kind)) extension.setCreateType("FROM_THIRD");
            if ("externalDev".equals(kind)) extension.setAgentDevType("other");
            if ("missing".equals(kind)) extension = null;
            ResourceExtDigEmployeeDto row = new ResourceExtDigEmployeeDto();
            row.setResourceId(10L); row.setSsResExtDigEmployee(extension);
            when(extensions.findById(10L)).thenReturn(extension);
            when(extensions.findExtDigEmployeeByIds(List.of(10L))).thenReturn(List.of(row));
            assertThat(governance.canPublish(resource)).isEqualTo("ordinary".equals(kind));
            assertThat(governance.canPublishBatch(List.of(resource)).get(10L)).isEqualTo("ordinary".equals(kind));
        }
        clearInvocations(extensions);
        governance.canPublishBatch(List.of(EmployeePublicationApplicationServiceTest.employee(10L, 7L),
            EmployeePublicationApplicationServiceTest.employee(11L, 7L)));
        verify(extensions).findExtDigEmployeeByIds(List.of(10L, 11L));
        verify(extensions, never()).findById(anyLong());
    }
    @Test void officialAuthorCanMaintainAuthorizationAndShelfWhileConfigurationStillRequiresReview() {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise"); resource.setPublicationSourceId(9L);
        assertThat(auth.hasResourceManagePermission(resource)).isTrue();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isTrue();
        assertThat(auth.hasResourceInstallTargetManagePermission(resource)).isFalse();
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource)).hasMessageContaining("更新审核");
        assertThatCode(() -> auth.validateEmployeeAuthorizationPermission(resource)).doesNotThrowAnyException();
        ResourceOperationPermissionsVo permissions = officialPermissions(resource, Set.of());
        assertThat(permissions.isHasManagePermission()).isTrue();
        assertThat(permissions.isCanEdit()).isTrue();
        assertThat(permissions.isCanManageAuth()).isTrue();
        assertThat(permissions.isCanUseAuth()).isTrue();
        assertThat(permissions.isCanOffShelf()).isTrue();
        assertThat(permissions.isCanOnShelf()).isFalse();
        assertThat(permissions.isCanDelete()).isFalse();
        assertThat(permissions.isOfficialUpdateRequiresReview()).isTrue();
        resource.setResourceStatus(3);
        permissions = officialPermissions(resource, Set.of());
        assertThat(permissions.isCanOnShelf()).isTrue();
        assertThat(permissions.isCanOffShelf()).isFalse();
        assertThat(permissions.isCanDelete()).isFalse();
    }

    /** 官方副本单条接口与列表批量计算均认可有效管理授权，并保留黑名单优先级。 */
    @Test void officialExplicitManagerCanMaintainAuthorizationAndShelfUnlessManagementIsDenied() {
        EmployeePublicationApplicationServiceTest.login("manager", 2L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise");
        resource.setPublicationSourceId(9L);
        var grant = new com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant();
        grant.setGrantObjId(10L);
        grant.setGrantToType("RED");
        grant.setStatusCd("A");
        doReturn(List.of(grant)).when(auth).listAuthPrivilegeGrant(anyString(), any(), anyString(), anyLong(), isNull());
        assertThat(auth.hasResourceManagePermission(resource)).isTrue();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isTrue();
        assertThatCode(() -> auth.validateEmployeeAuthorizationPermission(resource)).doesNotThrowAnyException();
        ResourceOperationPermissionsVo permissions = officialPermissions(resource, Set.of(10L));
        assertThat(permissions.isHasManagePermission()).isTrue();
        // 配置编辑仍仅对作者及官方管理员开放，授权管理不改变发布更新资格。
        assertThat(permissions.isCanEdit()).isFalse();
        assertThat(permissions.isCanManageAuth()).isTrue();
        assertThat(permissions.isCanUseAuth()).isTrue();
        assertThat(permissions.isCanOffShelf()).isTrue();
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource)).hasMessageContaining("更新审核");

        var deny = new com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant();
        deny.setGrantObjId(10L);
        deny.setGrantToType("BLACK");
        deny.setStatusCd("A");
        doReturn(List.of(grant, deny)).when(auth).listAuthPrivilegeGrant(anyString(), any(), anyString(), anyLong(), isNull());
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isFalse();
        assertThatThrownBy(() -> auth.validateEmployeeAuthorizationPermission(resource)).isInstanceOf(BaseException.class);
        permissions = officialPermissions(resource, Set.of());
        assertThat(permissions.isCanManageAuth()).isFalse();
        assertThat(permissions.isCanUseAuth()).isFalse();
        assertThat(permissions.isCanOffShelf()).isFalse();
    }

    @ParameterizedTest @ValueSource(strings = {"USER", "ORG_MAN", "BUSINESS_MAN", "PLAT_DEVOPS"})
    void ordinaryRolesWithoutGrantsCannotAdministerOfficialCopy(String role) {
        EmployeePublicationApplicationServiceTest.login("other", 2L, List.of(role));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise");
        resource.setPublicationSourceId(9L);
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isFalse();
        assertThatThrownBy(() -> auth.validateEmployeeAuthorizationPermission(resource)).isInstanceOf(BaseException.class);
        ResourceOperationPermissionsVo permissions = officialPermissions(resource, Set.of());
        assertThat(permissions.isCanManageAuth()).isFalse();
        assertThat(permissions.isCanUseAuth()).isFalse();
        assertThat(permissions.isCanOffShelf()).isFalse();
    }

    @ParameterizedTest @ValueSource(strings = {"author", "manager", "adminvip", "PLAT_MAN"})
    void officialManagementStillRequiresMatchingEnterprise(String identity) {
        EmployeePublicationApplicationServiceTest.login(identity, 2L, List.of(identity));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 2L);
        resource.setOwnerType("enterprise");
        resource.setPublicationSourceId(9L);
        resource.setComAcctId(99L);
        assertThat(auth.hasResourceManagePermission(resource)).isFalse();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isFalse();
        assertThatThrownBy(() -> auth.validateEmployeeAuthorizationPermission(resource)).isInstanceOf(BaseException.class);
        ResourceOperationPermissionsVo permissions = officialPermissions(resource, Set.of(10L));
        assertThat(permissions.isCanEdit()).isFalse();
        assertThat(permissions.isCanManageAuth()).isFalse();
        assertThat(permissions.isCanUseAuth()).isFalse();
        assertThat(permissions.isCanOffShelf()).isFalse();
    }

    private ResourceOperationPermissionsVo officialPermissions(SsResource resource, Set<Long> manageIds) {
        return ReflectionTestUtils.invokeMethod(auth, "buildResourceOperationPermissions", resource,
            CurrentUserHolder.getCurrentUserId(), manageIds, Set.of(), Set.of(), Set.of(), null, Set.of());
    }
    @ParameterizedTest @ValueSource(strings = {"adminvip", "PLAT_MAN"})
    void administratorsCanSaveOfficialCopyDirectly(String identity) {
        EmployeePublicationApplicationServiceTest.login(identity, 2L, List.of(identity));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise"); resource.setPublicationSourceId(9L);
        assertThatCode(() -> governance.requireDirectMutationAllowed(resource)).doesNotThrowAnyException();
        assertThat(auth.hasResourceManagePermission(resource)).isTrue();
        assertThat(auth.hasResourceUseSettingPermission(resource)).isTrue();
        assertThatCode(() -> auth.validateEmployeeAuthorizationPermission(resource)).doesNotThrowAnyException();
        ResourceOperationPermissionsVo effective = officialPermissions(resource, Set.of());
        assertThat(effective.isCanManageAuth()).isTrue();
        assertThat(effective.isCanUseAuth()).isTrue();
        assertThat(effective.isCanOffShelf()).isTrue();
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
        assertThat(permissions.isOfficialPublication()).isTrue();
        assertThat(permissions.isOfficialUpdateRequiresReview()).isFalse();
    }
    @ParameterizedTest @ValueSource(strings = {"DRAFT", "PENDING", "APPLYING", "FAILED"})
    void directSaveCannotRaceOutstandingOfficialUpdate(String state) {
        EmployeePublicationApplicationServiceTest.login("adminvip", 2L, List.of());
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        resource.setOwnerType("enterprise");
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
        resource.setOwnerType("enterprise");
        resource.setPublicationSourceId(9L);
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource)).hasMessageContaining("更新审核");
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", resource, permissions);
        assertThat(permissions.isOfficialUpdateRequiresReview()).isTrue();
    }
    @Test void directOfficialSaveIgnoresCreatorIdentityButStillEnforcesTenantBoundary() {
        EmployeePublicationApplicationServiceTest.login("platform", 2L, List.of("PLAT_MAN"));
        SsResource resource = EmployeePublicationApplicationServiceTest.employee(10L, 1L);
        resource.setOwnerType("enterprise");
        resource.setPublicationSourceId(9L);
        assertThatCode(() -> governance.requireDirectMutationAllowed(resource)).doesNotThrowAnyException();
        resource.setCreateBy(7L); resource.setComAcctId(99L);
        assertThatThrownBy(() -> governance.requireDirectMutationAllowed(resource));
    }
    @ParameterizedTest @ValueSource(strings = {"DRAFT", "PENDING", "REJECTED", "PUBLISHED"})
    void personalSavesNeverEnterOfficialReviewEvenWithLegacyPublicationMarkers(String state) {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        SsResource personal = EmployeePublicationApplicationServiceTest.employee(10L, 7L);
        personal.setPublicationSourceId(9L);
        personal.setPublicationRequestId(100L);
        var active = new com.iwhalecloud.byai.manager.entity.resource.DigitalEmployeePublication();
        active.setStatus(state);
        when(publications.active(10L, 1L)).thenReturn(active);
        assertThatCode(() -> governance.requireDirectMutationAllowed(personal)).doesNotThrowAnyException();
        var permissions = new com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo();
        ReflectionTestUtils.invokeMethod(auth, "applyEmployeeGovernancePermissions", personal, permissions);
        assertThat(permissions.isOfficialPublication()).isFalse();
        assertThat(permissions.isOfficialUpdateRequiresReview()).isFalse();
        assertThat(permissions.isCanPublishEmployee()).isTrue();
        verifyNoInteractions(publications);
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
