package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class DigitalEmployeeResourceAuthorizationServiceTest {
    private final AuthApplicationService auth = mock(AuthApplicationService.class);
    private final SsResourceMapper resources = mock(SsResourceMapper.class);
    private final SkillGroupMapper skillGroups = mock(SkillGroupMapper.class);
    private final SsResourceRelDetailService relations = mock(SsResourceRelDetailService.class);
    private final SsResExtDigEmployeeService employees = mock(SsResExtDigEmployeeService.class);
    private final PrivilegeGrantService grants = mock(PrivilegeGrantService.class);
    private final UsersMapper users = mock(UsersMapper.class);
    private final DigitalEmployeePublicationMapper publications = mock(DigitalEmployeePublicationMapper.class);
    private final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    private final DigitalEmployeeResourceAuthorizationService service = new DigitalEmployeeResourceAuthorizationService();
    private SsResource employee;

    @BeforeEach
    void setup() {
        ReflectionTestUtils.setField(service, "auth", auth);
        ReflectionTestUtils.setField(service, "resources", resources);
        ReflectionTestUtils.setField(service, "skillGroups", skillGroups);
        ReflectionTestUtils.setField(service, "relations", relations);
        ReflectionTestUtils.setField(service, "employees", employees);
        ReflectionTestUtils.setField(service, "grants", grants);
        ReflectionTestUtils.setField(service, "users", users);
        ReflectionTestUtils.setField(service, "publications", publications);
        ReflectionTestUtils.setField(service, "config", config);
        MessageSource messages = mock(MessageSource.class);
        when(messages.getMessage(anyString(), any(), any(Locale.class))).thenAnswer(call -> call.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messages);
        LoginInfo login = new LoginInfo();
        login.setUserId(1L); login.setEnterpriseId(10L);
        CurrentUserHolder.setLoginInfo(login);
        employee = resource(100L, "DIG_EMPLOYEE");
        employee.setCreateBy(1L);
        when(auth.hasResourceUsePermission(eq(employee), any(Long.class))).thenReturn(true);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.clearLoginInfo();
    }

    /** 各种资源按真实业务类型补使用授权，重复关联不导致重复授予。 */
    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM", "TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT", "OBJECT", "VIEW"})
    void synchronizesEverySupportedBoundResourceForCreatorAndExistingUsers(String type) {
        SsResource bound = bind(200L, type);
        when(relations.findByResourceId(100L)).thenReturn(List.of(relation(200L), relation(200L)));
        when(grants.listActiveRedGrantsForGrantObject(100L, "DIG_EMPLOYEE"))
            .thenReturn(List.of(grant("USER", 2L, GrantType.AVAILABLE_USE), grant("USER", 2L, GrantType.FORCE_USE)));

        service.synchronize(employee, List.of());

        verify(resources, times(1)).selectById(200L);
        verify(auth).appendDigitalEmployeeResourceUsePrivileges(bound, List.of(1L, 2L));
        verify(auth, never()).handleAuth(any());
    }

    @Test
    void synchronizedUseScopeIsNeverExpandedToOtherSharedEmployeeUsers() {
        SsResource bound = bind(200L, "SKILL"); bound.setUseAuthControlled(true);
        when(grants.listActiveRedGrantsForGrantObject(100L, "DIG_EMPLOYEE"))
            .thenReturn(List.of(grant("USER", 2L, GrantType.FORCE_USE)));
        service.synchronize(employee, List.of());
        verify(auth, never()).validateDigitalEmployeeResourceUseGrant(eq(bound), any());
        verify(auth, never()).appendDigitalEmployeeResourceUsePrivileges(eq(bound), any());
    }

    @Test
    void repeatedSaveDoesNotRegrantExistingResourcePermissions() {
        SsResource bound = bind(200L, "SKILL");
        when(grants.listActiveRedGrantsForGrantObject(100L, "DIG_EMPLOYEE"))
            .thenReturn(List.of(grant("USER", 2L, GrantType.FORCE_USE)));
        Set<Long> allowed = new HashSet<>(Set.of(1L));
        when(auth.hasResourceUsePermission(eq(bound), any(Long.class)))
            .thenAnswer(call -> allowed.contains(call.getArgument(1)));
        doAnswer(call -> {
            allowed.addAll(call.getArgument(1));
            return null;
        }).when(auth).appendDigitalEmployeeResourceUsePrivileges(eq(bound), anyCollection());

        service.synchronize(employee, List.of());
        service.synchronize(employee, List.of());

        verify(auth, times(1)).appendDigitalEmployeeResourceUsePrivileges(bound, List.of(2L));
        verify(auth, never()).validateDigitalEmployeeResourceUseGrant(bound, 1L);
    }

    @Test
    void expandsOrganizationPostAndStationThenExcludesEmployeeBlacklistedUsers() {
        SsResource bound = bind(200L, "KG_DOC");
        when(grants.listActiveRedGrantsForGrantObject(100L, "DIG_EMPLOYEE")).thenReturn(List.of(
            grant("ORG", 11L, GrantType.FORCE_USE), grant("POST", 12L, GrantType.ALLOW_MANAGE),
            grant("STATION", 13L, GrantType.AVAILABLE_USE)));
        when(users.findUserIdsByOrgIdListIncludingChildren(List.of(11L))).thenReturn(List.of(2L, 3L));
        when(users.findUserIdsByPostId(12L)).thenReturn(List.of(3L, 4L));
        when(users.findUserIdsByStationIdListIncludingChildren(List.of(13L))).thenReturn(List.of(4L, 5L));
        when(auth.hasResourceUsePermission(employee, 3L)).thenReturn(false);

        service.synchronize(employee, List.of());

        verify(auth).appendDigitalEmployeeResourceUsePrivileges(bound, List.of(1L, 2L, 4L, 5L));
        verify(auth, never()).validateDigitalEmployeeResourceUseGrant(bound, 3L);
    }

    @Test
    void ignoresPendingExpiredFutureAndUnrelatedGrants() {
        SsResource bound = bind(200L, "TOOLKIT");
        PrivilegeGrant pending = grant("USER", 2L, GrantType.AVAILABLE_USE); pending.setStatusCd("P");
        PrivilegeGrant expired = grant("USER", 3L, GrantType.FORCE_USE); expired.setExpDate(new Date(1));
        PrivilegeGrant future = grant("USER", 4L, GrantType.ALLOW_MANAGE); future.setEffDate(new Date(Long.MAX_VALUE));
        when(grants.listActiveRedGrantsForGrantObject(100L, "DIG_EMPLOYEE"))
            .thenReturn(List.of(pending, expired, future, grant("USER", 5L, GrantType.SHARE_USE)));

        service.synchronize(employee, List.of());

        verify(auth).appendDigitalEmployeeResourceUsePrivileges(bound, List.of(1L));
    }

    @ParameterizedTest
    @ValueSource(strings = {"personal", "personal_default"})
    void personalEmployeesKeepExistingBehavior(String ownerType) {
        employee.setOwnerType(ownerType);
        service.synchronize(employee, List.of("custom"));
        assertThat(service.lockForAuthorization(employee)).isSameAs(employee);
        verifyNoInteractions(resources, relations, employees, grants, users, publications, config, skillGroups);
    }

    @Test
    void groupAuthorizationKeepsExistingCascadeContract() {
        SsResExtDigEmployee group = new SsResExtDigEmployee(); group.setAgentType("017");
        when(employees.findById(100L)).thenReturn(group);
        service.synchronize(employee, List.of());
        verifyNoInteractions(resources, relations, grants, users, publications);
    }

    @Test
    void validatesAllMissingResourceGrantsBeforeAnyAppend() {
        SsResource skill = bind(200L, "SKILL");
        SsResource knowledge = resource(201L, "KG_DOC");
        when(resources.selectById(201L)).thenReturn(knowledge);
        when(relations.findByResourceId(100L)).thenReturn(List.of(relation(200L), relation(201L)));
        doThrow(new BaseException("denied")).when(auth).validateDigitalEmployeeResourceUseGrant(knowledge, 1L);

        assertThatThrownBy(() -> service.synchronize(employee, List.of())).hasMessage("denied");

        verify(auth).validateDigitalEmployeeResourceUseGrant(skill, 1L);
        verify(auth, never()).appendDigitalEmployeeResourceUsePrivileges(any(), anyCollection());
    }

    @ParameterizedTest
    @ValueSource(strings = {"missing", "otherEnterprise", "offShelf", "deleted", "unsupported"})
    void rejectsUnavailableOrCrossEnterpriseBoundResources(String reason) {
        SsResource bound = bind(200L, "SKILL");
        switch (reason) {
            case "missing" -> when(resources.selectById(200L)).thenReturn(null);
            case "otherEnterprise" -> bound.setComAcctId(20L);
            case "offShelf" -> bound.setResourceStatus(3);
            case "deleted" -> bound.setResourceStatus(-1);
            case "unsupported" -> bound.setResourceBizType("DIG_EMPLOYEE");
            default -> throw new IllegalArgumentException(reason);
        }
        assertThatThrownBy(() -> service.synchronize(employee, List.of()))
            .hasMessage("auth.employee.resources.invalid");
        verify(auth, never()).appendDigitalEmployeeResourceUsePrivileges(any(), anyCollection());
    }

    @Test
    void inactiveRelationsAreNotGranted() {
        SsResourceRelDetail inactive = relation(200L); inactive.setRelStatus(0);
        when(relations.findByResourceId(100L)).thenReturn(List.of(inactive));
        service.synchronize(employee, List.of());
        verifyNoInteractions(resources, grants);
    }

    @Test
    void resolvesStoredToolCodesAndSkipsPlatformBundledTools() {
        SsResource customTool = resource(201L, "MCP");
        SsResExtDigEmployee extension = new SsResExtDigEmployee();
        extension.setTargetContent("{\"relTools\":[\"Mail\",\"custom\",\"custom\",\"*\"]}");
        when(employees.findById(100L)).thenReturn(extension);
        when(config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS"))
            .thenReturn("[{\"toolCode\":\"Mail\",\"isWildcard\":false}]");
        when(publications.resourcesByCode("custom", 10L)).thenReturn(List.of(customTool));

        service.synchronize(employee, null);

        verify(publications, times(1)).resourcesByCode("custom", 10L);
        verify(publications, never()).resourcesByCode("Mail", 10L);
        verify(auth).appendDigitalEmployeeResourceUsePrivileges(customTool, List.of(1L));
    }

    @Test
    void submittedToolCodesOverrideStaleRuntimeMirror() {
        SsResExtDigEmployee extension = new SsResExtDigEmployee();
        extension.setTargetContent("{\"relTools\":[\"removed\"]}");
        when(employees.findById(100L)).thenReturn(extension);
        service.synchronize(employee, List.of());
        verifyNoInteractions(config, publications, grants);
    }

    @Test
    void invalidRuntimeMirrorFailsInsteadOfSilentlySkippingTools() {
        SsResExtDigEmployee extension = new SsResExtDigEmployee(); extension.setTargetContent("broken-json");
        when(employees.findById(100L)).thenReturn(extension);
        assertThatThrownBy(() -> service.synchronize(employee, null))
            .hasMessage("auth.employee.resources.configuration.invalid");
    }

    @Test
    void ambiguousCustomToolCodesCannotBypassAuthorization() {
        when(publications.resourcesByCode("custom", 10L))
            .thenReturn(List.of(resource(201L, "TOOLKIT"), resource(202L, "MCP")));
        assertThatThrownBy(() -> service.synchronize(employee, List.of("custom")))
            .hasMessage("auth.employee.resources.invalid");
    }

    @Test
    void invalidBundledToolConfigurationReturnsLocalizedFailure() {
        when(config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS")).thenReturn("broken-json");
        assertThatThrownBy(() -> service.synchronize(employee, List.of("Mail")))
            .hasMessage("auth.employee.resources.configuration.invalid");
        verify(auth, never()).appendDigitalEmployeeResourceUsePrivileges(any(), anyCollection());
    }

    @Test
    void authorizationLocksTheTenantScopedEmployee() {
        when(skillGroups.selectDigitalEmployeeForUpdate(100L, 10L)).thenReturn(employee);
        assertThat(service.lockForAuthorization(employee)).isSameAs(employee);
        employee.setComAcctId(20L);
        assertThatThrownBy(() -> service.lockForAuthorization(employee)).isInstanceOf(BaseException.class);
        verify(skillGroups, times(1)).selectDigitalEmployeeForUpdate(any(), any());
    }

    @Test
    void missingLockedEmployeeFailsAuthorization() {
        assertThatThrownBy(() -> service.lockForAuthorization(employee)).hasMessage("resource.not.found");
    }

    @Test
    void locksReturnedFromLegacyUnscopedMapperMustStillBelongToCurrentEnterprise() {
        SsResource otherTenant = resource(100L, "DIG_EMPLOYEE"); otherTenant.setComAcctId(20L);
        when(skillGroups.selectDigitalEmployeeForUpdate(100L, 10L)).thenReturn(otherTenant);
        assertThatThrownBy(() -> service.lockForAuthorization(employee)).hasMessage("auth.employee.resources.invalid");
    }

    @Test
    void permissionSynchronizationRequiresAnAuthenticatedEnterpriseContext() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.synchronize(employee, List.of())).hasMessage("auth.employee.resources.invalid");
        verifyNoInteractions(resources, relations, employees, grants);
    }

    private SsResource bind(Long id, String type) {
        SsResource resource = resource(id, type);
        when(relations.findByResourceId(100L)).thenReturn(List.of(relation(id)));
        when(resources.selectById(id)).thenReturn(resource);
        return resource;
    }

    private SsResource resource(Long id, String type) {
        SsResource resource = new SsResource();
        resource.setResourceId(id); resource.setResourceBizType(type); resource.setResourceName(type);
        resource.setOwnerType("enterprise"); resource.setComAcctId(10L); resource.setResourceStatus(2);
        return resource;
    }

    private SsResourceRelDetail relation(Long resourceId) {
        SsResourceRelDetail relation = new SsResourceRelDetail(); relation.setRelResourceId(resourceId);
        return relation;
    }

    private PrivilegeGrant grant(String type, Long id, String grantType) {
        PrivilegeGrant grant = new PrivilegeGrant();
        grant.setGrantToObjType(type); grant.setGrantToObjId(id); grant.setGrantType(grantType);
        grant.setGrantToType("RED"); grant.setOperType("READ"); grant.setStatusCd("A");
        return grant;
    }
}
