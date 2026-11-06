package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
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

    @ParameterizedTest
    @ValueSource(strings = {"SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM", "TOOL", "TOOLKIT", "MCP", "MCP_TOOL", "AGENT", "OBJECT", "VIEW"})
    void validatesSupportedBindingsWithoutReadingOrWritingUserPermissions(String type) {
        bind(200L, type);
        when(relations.findByResourceId(100L)).thenReturn(List.of(relation(200L), relation(200L)));

        service.validateBindings(employee, List.of());

        verify(resources).selectById(200L);
        verifyNoInteractions(auth, config);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"0", "1", " 1 ", "true"})
    void personalKnowledgeNeverBlocksEmployeeAuthorizationOrGainsGrantsRegardlessOfLegacySwitch(String oldValue) {
        SsResource knowledge = bind(200L, "KG_DOC");
        knowledge.setOwnerType("personal");
        knowledge.setCreateBy(1L);
        when(config.getDcSystemConfigValueByCode("SKIP_EMPLOYEE_RESOURCE_AUTH_SYNC")).thenReturn(oldValue);

        service.validateBindings(employee, List.of());
        service.validateApprovedApplicantBindings(employee, 2L);

        verify(auth).requireApplicantAuditPermission(employee, 2L);
        verify(auth).hasResourceUsePermission(employee, 2L);
        org.mockito.Mockito.verifyNoMoreInteractions(auth);
        verifyNoInteractions(config);
    }

    @Test
    void approvalStillRejectsUnauthorizedReviewersAndApplicantsWithoutEmployeeUse() {
        org.mockito.Mockito.doThrow(new BaseException("denied")).when(auth).requireApplicantAuditPermission(employee, 2L);
        assertThatThrownBy(() -> service.validateApprovedApplicantBindings(employee, 2L)).hasMessage("denied");
        verifyNoInteractions(relations, resources);
        org.mockito.Mockito.doNothing().when(auth).requireApplicantAuditPermission(employee, 2L);
        when(auth.hasResourceUsePermission(employee, 2L)).thenReturn(false);
        assertThatThrownBy(() -> service.validateApprovedApplicantBindings(employee, 2L))
            .hasMessage("auth.employee.resources.employee.use.required");
        verifyNoInteractions(relations, resources);
    }

    @ParameterizedTest
    @ValueSource(strings = {"personal", "personal_default"})
    void personalEmployeesKeepExistingBehavior(String ownerType) {
        employee.setOwnerType(ownerType);
        service.validateBindings(employee, List.of("custom"));
        assertThat(service.lockForAuthorization(employee)).isSameAs(employee);
        verifyNoInteractions(resources, relations, employees, publications, config, skillGroups);
    }

    @Test
    void groupAuthorizationKeepsExistingCascadeContract() {
        SsResExtDigEmployee group = new SsResExtDigEmployee(); group.setAgentType("017");
        when(employees.findById(100L)).thenReturn(group);
        service.validateBindings(employee, List.of());
        verifyNoInteractions(resources, relations, publications);
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
        assertThatThrownBy(() -> service.validateBindings(employee, List.of()))
            .hasMessage("auth.employee.resources.invalid");
        verifyNoInteractions(auth);
    }

    @Test
    void inactiveRelationsAreNotValidated() {
        SsResourceRelDetail inactive = relation(200L); inactive.setRelStatus(0);
        when(relations.findByResourceId(100L)).thenReturn(List.of(inactive));
        service.validateBindings(employee, List.of());
        verifyNoInteractions(resources);
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

        service.validateBindings(employee, null);

        verify(publications, times(1)).resourcesByCode("custom", 10L);
        verify(publications, never()).resourcesByCode("Mail", 10L);
        verifyNoInteractions(auth);
    }

    @Test
    void submittedToolCodesOverrideStaleRuntimeMirror() {
        SsResExtDigEmployee extension = new SsResExtDigEmployee();
        extension.setTargetContent("{\"relTools\":[\"removed\"]}");
        when(employees.findById(100L)).thenReturn(extension);
        service.validateBindings(employee, List.of());
        verifyNoInteractions(config, publications);
    }

    @Test
    void invalidRuntimeMirrorFailsInsteadOfSilentlySkippingTools() {
        SsResExtDigEmployee extension = new SsResExtDigEmployee(); extension.setTargetContent("broken-json");
        when(employees.findById(100L)).thenReturn(extension);
        assertThatThrownBy(() -> service.validateBindings(employee, null))
            .hasMessage("auth.employee.resources.configuration.invalid");
    }

    @Test
    void ambiguousCustomToolCodesCannotBypassAuthorization() {
        when(publications.resourcesByCode("custom", 10L))
            .thenReturn(List.of(resource(201L, "TOOLKIT"), resource(202L, "MCP")));
        assertThatThrownBy(() -> service.validateBindings(employee, List.of("custom")))
            .hasMessage("auth.employee.resources.invalid");
    }

    @Test
    void invalidBundledToolConfigurationReturnsLocalizedFailure() {
        when(config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS")).thenReturn("broken-json");
        assertThatThrownBy(() -> service.validateBindings(employee, List.of("Mail")))
            .hasMessage("auth.employee.resources.configuration.invalid");
        verifyNoInteractions(auth);
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
    void bindingValidationRequiresAnAuthenticatedEnterpriseContext() {
        CurrentUserHolder.clearLoginInfo();
        assertThatThrownBy(() -> service.validateBindings(employee, List.of())).hasMessage("auth.employee.resources.invalid");
        verifyNoInteractions(resources, relations, employees);
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

}
