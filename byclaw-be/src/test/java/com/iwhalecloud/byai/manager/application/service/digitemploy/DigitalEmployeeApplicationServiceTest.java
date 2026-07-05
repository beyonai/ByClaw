package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.ontology.OntologyResourceValidityService;
import com.iwhalecloud.byai.manager.application.service.template.TemplateRuleInfoApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.OperationLogService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceEventService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeInstallResourceDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SetDefaultDigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.manager.vo.digitemploy.SetDefaultDigitalEmployeeResultVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Locale;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DigitalEmployeeApplicationServiceTest {

    private SsResourceService ssResourceService;
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;
    private SsResExtSkillService ssResExtSkillService;
    private SsResourceRelDetailService ssResourceRelDetailService;
    private SuasSuperassistService suasSuperassistService;
    private OperationLogService operationLogService;
    private AuthApplicationService authApplicationService;
    private SequenceService sequenceService;
    private ResourceEventService resourceEventService;
    private AiModelService aiModelService;
    private TemplateRuleInfoApplicationService templateRuleInfoApplicationService;
    private ResourceAuthContextService resourceAuthContextService;
    private DingtalkRobotRegistryService dingtalkRobotRegistryService;
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;
    private OntologyResourceValidityService ontologyResourceValidityService;
    private DigitalEmployeeApplicationService service;

    @BeforeEach
    void setUp() {
        ssResourceService = mock(SsResourceService.class);
        ssResExtDigEmployeeService = mock(SsResExtDigEmployeeService.class);
        ssResExtSkillService = mock(SsResExtSkillService.class);
        ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        suasSuperassistService = mock(SuasSuperassistService.class);
        operationLogService = mock(OperationLogService.class);
        authApplicationService = mock(AuthApplicationService.class);
        sequenceService = mock(SequenceService.class);
        resourceEventService = mock(ResourceEventService.class);
        aiModelService = mock(AiModelService.class);
        templateRuleInfoApplicationService = mock(TemplateRuleInfoApplicationService.class);
        resourceAuthContextService = mock(ResourceAuthContextService.class);
        dingtalkRobotRegistryService = mock(DingtalkRobotRegistryService.class);
        digEmployeeChangeEventPublisher = mock(DigEmployeeChangeEventPublisher.class);
        ontologyResourceValidityService = mock(OntologyResourceValidityService.class);
        when(ontologyResourceValidityService.filterValidOntologyResources(any()))
            .thenAnswer(invocation -> invocation.getArgument(0));

        MessageSource mockMessageSource = mock(MessageSource.class);
        when(mockMessageSource.getMessage(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(java.util.Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", mockMessageSource);

        service = new DigitalEmployeeApplicationService();
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", ssResExtDigEmployeeService);
        ReflectionTestUtils.setField(service, "ssResExtSkillService", ssResExtSkillService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "resourceRuntimeInfoResolver", new ResourceRuntimeInfoResolver());
        ReflectionTestUtils.setField(service, "suasSuperassistService", suasSuperassistService);
        ReflectionTestUtils.setField(service, "operationLogService", operationLogService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "resourceEventService", resourceEventService);
        ReflectionTestUtils.setField(service, "aiModelService", aiModelService);
        ReflectionTestUtils.setField(service, "templateRuleInfoApplicationService", templateRuleInfoApplicationService);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", resourceAuthContextService);
        ReflectionTestUtils.setField(service, "dingtalkRobotRegistryService", dingtalkRobotRegistryService);
        ReflectionTestUtils.setField(service, "digEmployeeChangeEventPublisher", digEmployeeChangeEventPublisher);
        ReflectionTestUtils.setField(service, "ontologyResourceValidityService", ontologyResourceValidityService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("zhangsan");
        loginInfo.setAssistantId(7L);
        loginInfo.setDefaultDigEmployeeId(100L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void setDefaultDigitalEmployee_onlyUpdatesSuperassistDefaultIdAndRefreshesCurrentSession() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource newResource = buildDigitalEmployee(200L, OwnerType.PERSONAL, 1L);
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(200L)).thenReturn(newResource);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(200L);
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(result.getOldResourceId()).isEqualTo(100L);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(200L);
        assertThat(CurrentUserHolder.getDefaultDigEmployeeId()).isEqualTo(200L);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtDigEmployeeService, never()).update(any(SsResExtDigEmployee.class));
        verify(suasSuperassistService).updateById(superassist);
        verify(operationLogService).recordOperationLog(eq(newResource), eq(OperationTypeEnum.UPDATE));
    }

    @Test
    void setDefaultDigitalEmployee_allowsUseAuthorizedDigitalEmployee() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource sharedResource = buildDigitalEmployee(200L, OwnerType.ENTERPRISE, 2L);
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(200L)).thenReturn(sharedResource);
        when(authApplicationService.queryCurrentUserUsePermittedResourceIds(any(), any())).thenReturn(Set.of(200L));
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(200L);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(200L);
        verify(suasSuperassistService).updateById(superassist);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
    }

    @Test
    void setDefaultDigitalEmployee_allowsManageAuthorizedDigitalEmployee() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(201L);

        SsResource managedResource = buildDigitalEmployee(201L, OwnerType.PERSONAL, 2L);
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(201L)).thenReturn(managedResource);
        when(authApplicationService.queryCurrentUserUsePermittedResourceIds(any(), any())).thenReturn(Set.of());
        when(authApplicationService.hasCurrentUserAllowManagePrivilege(managedResource)).thenReturn(true);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(201L);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(201L);
        verify(suasSuperassistService).updateById(superassist);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
    }

    /**
     * 登录自动创建超级助手时，仍走 saveDigitalEmployee 主链路，但不再写 owner_type=personal_default 或 tag_name。
     *
     * @author qin.guoquan
     * @date 2026-05-09 16:30:00
     */
    @Test
    void saveDefaultSuperAssistant_setsPersonalOwnerTypeAndDoesNotPersistTagName() {
        when(sequenceService.nextVal()).thenReturn(300L);
        when(ssResourceService.countResource("digemployee.default.super.assistant.resource.name", ResourceBizTypeEnum.DIG_EMPLOYEE.name(), null))
            .thenReturn(0L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SsResource result = service.saveDefaultSuperAssistant(1L, "zhangsan", "张三", null);

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        verify(ssResExtDigEmployeeService).save(extCaptor.capture());

        assertThat(result.getResourceCode()).isEqualTo("zhangsan_main");
        assertThat(resourceCaptor.getValue().getResourceName()).isEqualTo("digemployee.default.super.assistant.resource.name");
        assertThat(resourceCaptor.getValue().getResourceDesc()).isEqualTo("digemployee.default.super.assistant.resource.name");
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(extCaptor.getValue().getAbility()).isEqualTo("digemployee.default.super.assistant.ability");
        assertThat(extCaptor.getValue().getConstraints()).isEqualTo("digemployee.default.super.assistant.constraints");
        assertThat(extCaptor.getValue().getFaqs()).isEqualTo("digemployee.default.super.assistant.faqs");
        assertThat(extCaptor.getValue().getTagName()).isNull();
    }

    @Test
    void saveDefaultSuperAssistant_usesLocalizedMessageArguments() {
        MessageSource mockMessageSource = mock(MessageSource.class);
        when(mockMessageSource.getMessage(eq("digemployee.default.super.assistant.resource.name"), any(), any(Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0) + ":" + ((Object[]) invocation.getArgument(1))[0]);
        when(mockMessageSource.getMessage(eq("digemployee.default.super.assistant.ability"), any(), any(Locale.class)))
            .thenReturn("localized-ability");
        when(mockMessageSource.getMessage(eq("digemployee.default.super.assistant.constraints"), any(), any(Locale.class)))
            .thenReturn("localized-constraints");
        when(mockMessageSource.getMessage(eq("digemployee.default.super.assistant.faqs"), any(), any(Locale.class)))
            .thenReturn("localized-faqs");
        when(mockMessageSource.getMessage(eq("digemployee.default.super.assistant.opening.question.intro"), any(), any(Locale.class)))
            .thenReturn("localized-intro");
        when(mockMessageSource.getMessage(eq("digemployee.default.super.assistant.opening.question.summary"), any(), any(Locale.class)))
            .thenReturn("localized-summary");
        when(mockMessageSource.getMessage(org.mockito.ArgumentMatchers.argThat(key ->
            !"digemployee.default.super.assistant.resource.name".equals(key)
                && !"digemployee.default.super.assistant.ability".equals(key)
                && !"digemployee.default.super.assistant.constraints".equals(key)
                && !"digemployee.default.super.assistant.faqs".equals(key)
                && !"digemployee.default.super.assistant.opening.question.intro".equals(key)
                && !"digemployee.default.super.assistant.opening.question.summary".equals(key)),
            any(), any(Locale.class))).thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", mockMessageSource);

        when(sequenceService.nextVal()).thenReturn(302L);
        when(ssResourceService.countResource("digemployee.default.super.assistant.resource.name:张三",
            ResourceBizTypeEnum.DIG_EMPLOYEE.name(), null)).thenReturn(0L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.saveDefaultSuperAssistant(1L, "zhangsan", "张三", null);

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        verify(ssResExtDigEmployeeService).save(extCaptor.capture());

        assertThat(resourceCaptor.getValue().getResourceName()).isEqualTo("digemployee.default.super.assistant.resource.name:张三");
        assertThat(resourceCaptor.getValue().getResourceDesc()).isEqualTo("digemployee.default.super.assistant.resource.name:张三");
        assertThat(extCaptor.getValue().getAbility()).isEqualTo("localized-ability");
        assertThat(extCaptor.getValue().getConstraints()).isEqualTo("localized-constraints");
        assertThat(extCaptor.getValue().getFaqs()).isEqualTo("localized-faqs");
        assertThat(extCaptor.getValue().getTagName()).isNull();
        assertThat(extCaptor.getValue().getPrologue())
            .contains("localized-intro")
            .contains("localized-summary");
    }

    @Test
    void saveDigitalEmployee_doesNotPersistPersonalAssistantTagName() {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceName("我的个人助理");
        dto.setOwnerType(OwnerType.PERSONAL);
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        dto.setSkills("[\"1\",\"2\",\"3\"]");

        when(sequenceService.nextVal()).thenReturn(301L);
        when(ssResourceService.countResource("我的个人助理", ResourceBizTypeEnum.DIG_EMPLOYEE.name(), null)).thenReturn(0L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));

        service.saveDigitalEmployee(dto);

        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResExtDigEmployeeService).save(extCaptor.capture());

        assertThat(extCaptor.getValue().getResourceId()).isEqualTo(301L);
        assertThat(extCaptor.getValue().getTagName()).isNull();
        assertThat(extCaptor.getValue().getSkills()).isEqualTo(
            "[{\"skillCode\":\"1\",\"skillType\":\"hub\",\"skillUrl\":\"\",\"versionUrl\":\"\"},{\"skillCode\":\"2\",\"skillType\":\"hub\",\"skillUrl\":\"\",\"versionUrl\":\"\"},{\"skillCode\":\"3\",\"skillType\":\"hub\",\"skillUrl\":\"\",\"versionUrl\":\"\"}]");
    }

    @Test
    void saveDigitalEmployee_doesNotPersistEnterpriseTagNameByAgentType() {
        List<DigitalEmployType> types = List.of(DigitalEmployType.AGENT_TYPE_ASSISTANT, DigitalEmployType.AGENT_TYPE_DATA,
            DigitalEmployType.AGENT_TYPE_QA, DigitalEmployType.AGENT_TYPE_DEBUG, DigitalEmployType.AGENT_TYPE_CODE);
        when(sequenceService.nextVal()).thenReturn(401L, 402L, 403L, 404L, 405L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        for (DigitalEmployType type : types) {
            String resourceName = "企业数字员工-" + type.getCode();
            when(ssResourceService.countResource(resourceName, ResourceBizTypeEnum.DIG_EMPLOYEE.name(), null))
                .thenReturn(0L);

            DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
            dto.setResourceName(resourceName);
            dto.setOwnerType(OwnerType.ENTERPRISE);
            dto.setAgentType(type.getCode());

            service.saveDigitalEmployee(dto);
        }

        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResExtDigEmployeeService, times(types.size())).save(extCaptor.capture());

        List<SsResExtDigEmployee> savedExtList = extCaptor.getAllValues();
        assertThat(savedExtList).extracting(SsResExtDigEmployee::getTagName)
            .containsExactly(null, null, null, null, null);
    }

    @Test
    void queryPersonalDigitalEmployeeList_setsDefaultSuperAssistantResourceCode() {
        DigitalEmployeeQo qo = new DigitalEmployeeQo();
        PageInfo<DigitalEmployeeVo> pageInfo = new PageInfo<>();
        when(ssResExtDigEmployeeService.selectPersonalDigitalEmployeeByQo(any(DigitalEmployeeQo.class)))
            .thenReturn(pageInfo);

        PageInfo<DigitalEmployeeVo> result = service.queryPersonalDigitalEmployeeList(qo);

        ArgumentCaptor<DigitalEmployeeQo> qoCaptor = ArgumentCaptor.forClass(DigitalEmployeeQo.class);
        verify(ssResExtDigEmployeeService).selectPersonalDigitalEmployeeByQo(qoCaptor.capture());
        assertThat(result).isSameAs(pageInfo);
        assertThat(qoCaptor.getValue().getDefaultDigEmployeeId()).isEqualTo(100L);
        assertThat(qoCaptor.getValue().getDefaultSuperAssistantResourceCode()).isEqualTo("zhangsan_main");
    }

    @Test
    void selectDigitalEmployeeByQo_returnsOwnerTypeInPageVo() {
        DigitalEmployeeQo qo = new DigitalEmployeeQo();
        PageInfo<DigitalEmployeePageVo> pageInfo = new PageInfo<>();
        DigitalEmployeePageVo pageVo = new DigitalEmployeePageVo();
        pageVo.setOwnerType(OwnerType.ENTERPRISE);
        pageInfo.setList(List.of(pageVo));
        when(ssResExtDigEmployeeService.selectDigitalEmployeeByQo(any(DigitalEmployeeQo.class)))
            .thenReturn(pageInfo);

        PageInfo<DigitalEmployeePageVo> result = service.selectDigitalEmployeeByQo(qo);

        assertThat(result.getList()).hasSize(1);
        assertThat(result.getList().get(0).getOwnerType()).isEqualTo(OwnerType.ENTERPRISE);
    }

    @Test
    void setDefaultDigitalEmployee_returnsImmediatelyWhenDefaultIdIsAlreadyConsistent() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(100L);

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(100L);
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(result.getOldResourceId()).isEqualTo(100L);
        assertThat(result.getOldOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(CurrentUserHolder.getDefaultDigEmployeeId()).isEqualTo(100L);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(suasSuperassistService, never()).updateById(any(SuasSuperassist.class));
        verify(ssResExtDigEmployeeService, never()).update(any(SsResExtDigEmployee.class));
        verify(operationLogService, never()).recordOperationLog(any(SsResource.class), any(OperationTypeEnum.class));
    }

    @Test
    void setDefaultDigitalEmployee_allowsCurrentUserCreatedPersonalAssistant() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource newResource = buildDigitalEmployee(200L, OwnerType.PERSONAL, 1L);
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);

        when(ssResourceService.findById(200L)).thenReturn(newResource);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(200L);
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(result.getOldResourceId()).isNull();
        assertThat(result.getOldOwnerType()).isNull();
        assertThat(newResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(200L);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
    }

    @Test
    void setDefaultDigitalEmployee_setsSuperAssistantResourceAsDefaultByMainResourceCodeWithoutMutatingResource() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(202L);

        SsResource newResource = buildDigitalEmployee(202L, OwnerType.PERSONAL, 1L);
        newResource.setResourceCode("zhangsan_main");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);

        when(ssResourceService.findById(202L)).thenReturn(newResource);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(202L);
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(newResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(202L);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtDigEmployeeService, never()).update(any(SsResExtDigEmployee.class));
    }

    @Test
    void setDefaultDigitalEmployee_rejectsPersonalAssistantCreatedByAnotherUser() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(201L);

        SsResource otherPersonalResource = buildDigitalEmployee(201L, OwnerType.PERSONAL, 2L);
        when(ssResourceService.findById(201L)).thenReturn(otherPersonalResource);
        when(authApplicationService.queryCurrentUserUsePermittedResourceIds(any(), any())).thenReturn(Set.of());
        when(authApplicationService.hasCurrentUserAllowManagePrivilege(otherPersonalResource)).thenReturn(false);

        assertThatThrownBy(() -> service.setDefaultDigitalEmployee(dto)).isInstanceOf(RuntimeException.class);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(suasSuperassistService, never()).updateById(any(SuasSuperassist.class));
    }

    @Test
    void validateDigitalEmployeeUpdatePermission_allowsBoundDefaultAssistantCreatedByAnotherUser() {
        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL_DEFAULT, 99L);

        assertThatCode(() -> ReflectionTestUtils.invokeMethod(service, "validateDigitalEmployeeUpdatePermission",
            currentDefaultResource)).doesNotThrowAnyException();
    }

    @Test
    void installDigitalEmployeeRelResources_rejectsSkillWithoutUsePermission() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(300L));

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skillResource = buildSkillResource(300L, 2L);

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(authApplicationService.hasResourceManagePermission(currentDefaultResource)).thenReturn(true);
        when(authApplicationService.hasResourceUsePermission(skillResource)).thenReturn(false);

        assertThatThrownBy(() -> service.installDigitalEmployeeRelResources(dto)).isInstanceOf(RuntimeException.class);
        verify(ssResourceRelDetailService, never()).findByResourceId(100L);
    }

    @Test
    void installDigitalEmployeeRelResources_rejectsSkillWhenDefaultDigitalEmployeeHasNoManagePermission() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(300L));

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skillResource = buildSkillResource(300L, 2L);

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(authApplicationService.hasResourceManagePermission(currentDefaultResource)).thenReturn(false);

        assertThatThrownBy(() -> service.installDigitalEmployeeRelResources(dto)).isInstanceOf(RuntimeException.class);
        verify(authApplicationService, never()).hasResourceUsePermission(skillResource);
        verify(ssResourceRelDetailService, never()).findByResourceId(100L);
    }

    @Test
    void uninstallDigitalEmployeeRelResources_removesSkillRelationAndRebuildsRelSkills() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(300L));

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skillResource = buildSkillResource(300L, 2L);
        skillResource.setResourceCode("dws");
        SsResourceRelDetail skillRel = new SsResourceRelDetail();
        skillRel.setResourceRelDetailId(900L);
        skillRel.setResourceId(100L);
        skillRel.setRelResourceId(300L);
        SsResExtDigEmployee extDigEmployee = buildDigitalEmployeeExt(100L, "默认个人助理");
        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(authApplicationService.hasResourceManagePermission(currentDefaultResource)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(skillRel)).thenReturn(List.of())
            .thenReturn(List.of()).thenReturn(List.of());
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(extDigEmployee);
        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.uninstallDigitalEmployeeRelResources(dto);

        verify(ssResourceRelDetailService).removeById(900L);
        verify(authApplicationService, never()).hasResourceUsePermission(skillResource);
        verify(operationLogService).recordOperationLog(eq(currentDefaultResource), eq(OperationTypeEnum.UPDATE));
        List<Map> relSkills = JSON.parseArray(result.getSkills(), Map.class);
        assertThat(relSkills).isEmpty();
    }

    @Test
    void uninstallDigitalEmployeeRelResources_rejectsSkillWhenDefaultDigitalEmployeeHasNoManagePermission() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(300L));

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skillResource = buildSkillResource(300L, 2L);

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(authApplicationService.hasResourceManagePermission(currentDefaultResource)).thenReturn(false);

        assertThatThrownBy(() -> service.uninstallDigitalEmployeeRelResources(dto)).isInstanceOf(RuntimeException.class);
        verify(authApplicationService, never()).hasResourceUsePermission(skillResource);
        verify(ssResourceRelDetailService, never()).findByResourceId(100L);
    }

    @Test
    void rebuildAndSaveDigitalEmployeeRelSkills_writesStandardSkillJsonFromRelations() {
        SsResExtDigEmployee extDigEmployee = new SsResExtDigEmployee();
        extDigEmployee.setResourceId(100L);

        SsResourceRelDetail skillRel = new SsResourceRelDetail();
        skillRel.setResourceId(100L);
        skillRel.setRelResourceId(300L);
        SsResourceRelDetail objectRel = new SsResourceRelDetail();
        objectRel.setResourceId(100L);
        objectRel.setRelResourceId(400L);

        SsResource skillResource = buildSkillResource(300L, 2L);
        skillResource.setResourceCode("dws");
        SsResource objectResource = new SsResource();
        objectResource.setResourceId(400L);
        objectResource.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());

        SsResExtSkill extSkill = new SsResExtSkill();
        extSkill.setResourceId(300L);
        extSkill.setSkillType("hub");
        extSkill.setSkillUrl("resource/skill/zhangsan-hub/dws.zip");

        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(extDigEmployee);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(skillRel, objectRel));
        when(ssResourceService.findByIdList(List.of(300L, 400L))).thenReturn(List.of(skillResource, objectResource));
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(ssResExtSkillService.findById(300L)).thenReturn(extSkill);

        service.rebuildAndSaveDigitalEmployeeRelSkills(100L);

        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResExtDigEmployeeService, atLeastOnce()).update(extCaptor.capture());
        List<Map> relSkills = JSON.parseArray(extCaptor.getValue().getSkills(), Map.class);
        assertThat(relSkills).hasSize(1);
        assertThat(relSkills.get(0))
            .containsEntry("resourceId", 300)
            .containsEntry("skillCode", "dws")
            .containsEntry("skillType", "hub")
            .containsEntry("skillUrl", "/byaiService/tool/downloadSkillZip?skillId=300")
            .containsEntry("versionUrl", "/byaiService/tool/getSkillVersion?skillId=300");
    }

    @Test
    void updateDigitalEmployee_forcesDefaultPersonalAssistantToAssistantRuntime() {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceId(100L);
        dto.setResourceName("默认个人助理");
        dto.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_CODE.getCode());

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL_DEFAULT, 99L);
        SsResExtDigEmployee currentDefaultExt = buildDigitalEmployeeExt(100L, "默认个人助理");
        currentDefaultExt.setAgentType(DigitalEmployType.AGENT_TYPE_CODE.getCode());

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(currentDefaultExt);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        SsResource result = service.updateDigitalEmployee(dto);

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResourceService).updateResourceEntity(resourceCaptor.capture());
        verify(ssResExtDigEmployeeService, atLeastOnce()).update(extCaptor.capture());

        assertThat(dto.getAgentType()).isEqualTo(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        assertThat(result.getWorkerAgentType()).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
        assertThat(resourceCaptor.getValue().getWorkerAgentType()).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
        assertThat(extCaptor.getValue().getAgentType()).isEqualTo(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
    }

    @Test
    void updateDigitalEmployee_persistsSkillsAndIgnoresStaleRelSkills() {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceId(100L);
        dto.setResourceName("数字员工");
        dto.setOwnerType(OwnerType.PERSONAL);
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        dto.setSkills("[\"dws\",\"blucli\"]");
        dto.setRelSkills(List.of(skillRel("old")));

        SsResource resource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResExtDigEmployee ext = buildDigitalEmployeeExt(100L, "数字员工");
        ext.setSkills("[\"old\"]");
        SsResource dwsSkill = buildSkillResource(300L, 2L);
        dwsSkill.setResourceCode("dws");
        SsResource blucliSkill = buildSkillResource(301L, 2L);
        blucliSkill.setResourceCode("blucli");
        SsResourceRelDetail dwsRel = new SsResourceRelDetail();
        dwsRel.setResourceId(100L);
        dwsRel.setRelResourceId(300L);
        SsResourceRelDetail blucliRel = new SsResourceRelDetail();
        blucliRel.setResourceId(100L);
        blucliRel.setRelResourceId(301L);

        when(ssResourceService.findById(100L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(ext);
        when(ssResourceService.getResourceListByCode(any())).thenReturn(List.of(dwsSkill, blucliSkill));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of()).thenReturn(List.of(dwsRel, blucliRel));
        when(ssResourceService.findByIdList(List.of(300L, 301L))).thenReturn(List.of(dwsSkill, blucliSkill));
        service.updateDigitalEmployee(dto);

        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResExtDigEmployeeService, atLeastOnce()).update(extCaptor.capture());

        List<Map> relSkills = JSON.parseArray(extCaptor.getValue().getSkills(), Map.class);
        assertThat(relSkills).hasSize(2);
        assertThat(relSkills.get(0))
            .containsEntry("resourceId", 300)
            .containsEntry("skillCode", "dws")
            .containsEntry("skillUrl", "/byaiService/tool/downloadSkillZip?skillId=300")
            .containsEntry("versionUrl", "/byaiService/tool/getSkillVersion?skillId=300");
        assertThat(relSkills.get(1))
            .containsEntry("resourceId", 301)
            .containsEntry("skillCode", "blucli")
            .containsEntry("skillUrl", "/byaiService/tool/downloadSkillZip?skillId=301")
            .containsEntry("versionUrl", "/byaiService/tool/getSkillVersion?skillId=301");
    }

    @Test
    void findDetailsById_populatesRelSkillsFromRelations() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);

        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        detailsDTO.setSkills("[\"stale\"]");
        SsResource skillResource = buildSkillResource(300L, 2L);
        skillResource.setResourceCode("dws");
        SsResourceRelDetail skillRel = new SsResourceRelDetail();
        skillRel.setResourceId(100L);
        skillRel.setRelResourceId(300L);

        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(skillRel));
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        List<Map> relSkills = JSON.parseArray(result.getSkills(), Map.class);
        assertThat(relSkills).hasSize(1);
        assertThat(relSkills.get(0))
            .containsEntry("resourceId", 300)
            .containsEntry("skillCode", "dws");
        assertSkillCodes(result.getRelSkills(), "dws");
    }

    @Test
    void applyInputRuntimeFieldsForResponse_keepsRelationBasedSkills() {
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setSkills("[{\"skillCode\":\"relation-skill\"}]");
        details.setRelSkills(List.of(skillRel("relation-skill")));

        DigitalEmployeeDTO input = new DigitalEmployeeDTO();
        input.setSkills("[\"dws\",\"blucli\"]");
        input.setRelSkills(List.of(skillRel("old")));

        service.applyInputRuntimeFieldsForResponse(details, input);

        assertThat(details.getSkills()).isEqualTo("[{\"skillCode\":\"relation-skill\"}]");
        assertSkillCodes(details.getRelSkills(), "relation-skill");
    }

    @Test
    void applyInputRuntimeFieldsForResponse_ignoresSubmittedRelSkillsWhenSkillsAbsent() {
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setSkills("[\"old\"]");
        details.setRelSkills(List.of(skillRel("old")));

        DigitalEmployeeDTO input = new DigitalEmployeeDTO();
        input.setRelSkills(List.of(skillRel("dws"), skillRel("blucli")));

        service.applyInputRuntimeFieldsForResponse(details, input);

        assertThat(details.getSkills()).isEqualTo("[\"old\"]");
        assertSkillCodes(details.getRelSkills(), "old");
    }

    @Test
    void findDetailsById_populatesRelToolsFromTargetContent() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);

        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        detailsDTO.setTargetContent("{\"relTools\":[\"tool-a\",\"tool-b\"]}");

        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        assertThat(result.getRelTools()).containsExactly("tool-a", "tool-b");
    }

    @Test
    void findDetailsById_prefersStoredRelPromptFromTargetContent() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);

        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        detailsDTO.setCorePersonaDefinition("db-core-prompt");
        detailsDTO.setTargetContent("{\"relPrompt\":\"stored-rel-prompt\"}");

        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        assertThat(result.getRelPrompt()).isEqualTo("stored-rel-prompt");
    }

    @Test
    void findDetailsById_fallsBackToCorePersonaDefinitionWhenStoredRelPromptMissing() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);

        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        detailsDTO.setCorePersonaDefinition("db-core-prompt");
        detailsDTO.setTargetContent("{\"relTools\":[\"tool-a\"]}");

        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        assertThat(result.getRelPrompt()).isEqualTo("db-core-prompt");
    }

    @Test
    void applyInputRuntimeFieldsForResponse_allowsClearingRelPromptAndOverridingRelTools() {
        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setRelPrompt("old-prompt");
        detailsDTO.setRelTools(List.of("old-tool"));

        DigitalEmployeeDTO inputDto = new DigitalEmployeeDTO();
        inputDto.setCorePersonaDefinition("");
        inputDto.setRelTools(List.of());

        service.applyInputRuntimeFieldsForResponse(detailsDTO, inputDto);

        assertThat(detailsDTO.getRelPrompt()).isEmpty();
        assertThat(detailsDTO.getRelTools()).isEmpty();
    }

    // generateV3 moved to MetaPromptService — see MetaPromptServiceTest

    private SsResource buildDigitalEmployee(Long resourceId, String ownerType, Long createBy) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        resource.setOwnerType(ownerType);
        resource.setCreateBy(createBy);
        return resource;
    }

    private SsResource buildSkillResource(Long resourceId, Long createBy) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType("SKILL");
        resource.setOwnerType(OwnerType.ENTERPRISE);
        resource.setCreateBy(createBy);
        return resource;
    }

    private SsResExtDigEmployee buildDigitalEmployeeExt(Long resourceId, String tagName) {
        SsResExtDigEmployee resource = new SsResExtDigEmployee();
        resource.setResourceId(resourceId);
        resource.setTagName(tagName);
        return resource;
    }

    private Map<String, Object> skillRel(String skillCode) {
        return Map.of("skillCode", skillCode, "skillType", "hub", "skillUrl", "", "versionUrl", "");
    }

    private void assertSkillCodes(List<Object> relSkills, String... skillCodes) {
        assertThat(relSkills).extracting(item -> ((Map<String, Object>) item).get("skillCode"))
            .containsExactly((Object[]) skillCodes);
        assertThat(relSkills).allSatisfy(item -> {
            Map<String, Object> relSkill = (Map<String, Object>) item;
            assertThat(relSkill.get("skillType")).isEqualTo("hub");
        });
    }
}
