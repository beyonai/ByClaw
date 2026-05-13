package com.iwhalecloud.byai.manager.application.service.digitemploy;

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
import com.iwhalecloud.byai.manager.application.service.template.TemplateRuleInfoApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.OperationLogService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceEventService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SetDefaultDigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.manager.vo.digitemploy.SetDefaultDigitalEmployeeResultVo;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DigitalEmployeeApplicationServiceTest {

    private SsResourceService ssResourceService;
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;
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
    private DigitalEmployeeApplicationService service;

    @BeforeEach
    void setUp() {
        ssResourceService = mock(SsResourceService.class);
        ssResExtDigEmployeeService = mock(SsResExtDigEmployeeService.class);
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

        MessageSource mockMessageSource = mock(MessageSource.class);
        when(mockMessageSource.getMessage(org.mockito.ArgumentMatchers.anyString(), org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(java.util.Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", mockMessageSource);

        service = new DigitalEmployeeApplicationService();
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", ssResExtDigEmployeeService);
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
    void setDefaultDigitalEmployee_switchesOldAndNewDefaultAndRefreshesCurrentSession() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource newResource = buildDigitalEmployee(200L, OwnerType.PERSONAL, 1L);
        SsResource oldResource = buildDigitalEmployee(100L, OwnerType.PERSONAL_DEFAULT, 1L);
        SsResExtDigEmployee newExt = buildDigitalEmployeeExt(200L, "new-tag");
        SsResExtDigEmployee oldExt = buildDigitalEmployeeExt(100L, "old-tag");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(200L)).thenReturn(newResource);
        when(ssResourceService.findById(100L)).thenReturn(oldResource);
        when(ssResExtDigEmployeeService.findById(200L)).thenReturn(newExt);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(oldExt);
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(200L);
        assertThat(result.getNewPersonalDefaultTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(result.getOldResourceId()).isEqualTo(100L);
        assertThat(result.getOldPersonalDefaultTagName()).isEqualTo("digemployee.tag.personal.assistant");
        assertThat(result.getOldOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(newResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(oldResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(200L);
        assertThat(CurrentUserHolder.getDefaultDigEmployeeId()).isEqualTo(200L);
        verify(ssResourceService, times(2)).updateResourceEntity(any(SsResource.class));
        verify(suasSuperassistService).updateById(superassist);
        verify(operationLogService).recordOperationLog(eq(newResource), eq(OperationTypeEnum.UPDATE));
    }

    @Test
    void setDefaultDigitalEmployee_resetsOldSuperAssistantTagNameOnlyWhenPersonalAssistantBecomesDefault() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource newResource = buildDigitalEmployee(200L, OwnerType.PERSONAL, 1L);
        SsResource oldSuperAssistant = buildDigitalEmployee(100L, OwnerType.PERSONAL_DEFAULT, 1L);
        oldSuperAssistant.setResourceCode("zhangsan_main");
        SsResExtDigEmployee newExt = buildDigitalEmployeeExt(200L, "new-tag");
        SsResExtDigEmployee oldSuperAssistantExt = buildDigitalEmployeeExt(100L, "old-super-tag");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(200L)).thenReturn(newResource);
        when(ssResourceService.findById(100L)).thenReturn(oldSuperAssistant);
        when(ssResExtDigEmployeeService.findById(200L)).thenReturn(newExt);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(oldSuperAssistantExt);
        when(ssResourceService.findPersonalDefaultDigitalEmployeesByCreator(1L))
            .thenReturn(List.of(oldSuperAssistant, newResource));
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewPersonalDefaultTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(result.getOldPersonalDefaultTagName()).isEqualTo("digemployee.tag.super.assistant");
        assertThat(result.getOldOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(newExt.getTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(oldSuperAssistantExt.getTagName()).isEqualTo("digemployee.tag.super.assistant");
        assertThat(oldSuperAssistant.getOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        verify(ssResourceService, times(1)).updateResourceEntity(any(SsResource.class));
        verify(ssResExtDigEmployeeService, times(2)).update(any(SsResExtDigEmployee.class));
    }

    @Test
    void setDefaultDigitalEmployee_reconcilesStalePersonalDefaultAssistants() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource newResource = buildDigitalEmployee(200L, OwnerType.PERSONAL, 1L);
        SsResource oldDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL_DEFAULT, 1L);
        SsResource staleDefaultResource = buildDigitalEmployee(101L, OwnerType.PERSONAL_DEFAULT, 1L);
        staleDefaultResource.setResourceCode("zhangsan-helper-01");
        SsResExtDigEmployee newExt = buildDigitalEmployeeExt(200L, "new-tag");
        SsResExtDigEmployee oldExt = buildDigitalEmployeeExt(100L, "old-tag");
        SsResExtDigEmployee staleExt = buildDigitalEmployeeExt(101L, "stale-tag");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(200L)).thenReturn(newResource);
        when(ssResourceService.findById(100L)).thenReturn(oldDefaultResource);
        when(ssResourceService.findById(101L)).thenReturn(staleDefaultResource);
        when(ssResExtDigEmployeeService.findById(200L)).thenReturn(newExt);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(oldExt);
        when(ssResExtDigEmployeeService.findById(101L)).thenReturn(staleExt);
        when(ssResourceService.findPersonalDefaultDigitalEmployeesByCreator(1L))
            .thenReturn(List.of(oldDefaultResource, staleDefaultResource, newResource));
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(200L);
        assertThat(staleDefaultResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL);
        assertThat(staleExt.getTagName()).isEqualTo("digemployee.tag.personal.assistant");
        verify(ssResourceService, times(3)).updateResourceEntity(any(SsResource.class));
        verify(ssResExtDigEmployeeService, times(3)).update(any(SsResExtDigEmployee.class));
    }

    /**
     * 登录自动创建默认超级助手时，仍走 saveDigitalEmployee 主链路，但 tag_name 需要和手动默认个人助理区分。
     *
     * @author qin.guoquan
     * @date 2026-05-09 16:30:00
     */
    @Test
    void saveDefaultSuperAssistant_setsDefaultSuperAssistantTagName() {
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
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(extCaptor.getValue().getAbility()).isEqualTo("digemployee.default.super.assistant.ability");
        assertThat(extCaptor.getValue().getConstraints()).isEqualTo("digemployee.default.super.assistant.constraints");
        assertThat(extCaptor.getValue().getFaqs()).isEqualTo("digemployee.default.super.assistant.faqs");
        assertThat(extCaptor.getValue().getTagName()).isEqualTo("digemployee.tag.default.super.assistant");
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
        when(mockMessageSource.getMessage(eq("digemployee.tag.default.super.assistant"), any(), any(Locale.class)))
            .thenReturn("localized-tag");
        when(mockMessageSource.getMessage(org.mockito.ArgumentMatchers.argThat(key ->
            !"digemployee.default.super.assistant.resource.name".equals(key)
                && !"digemployee.default.super.assistant.ability".equals(key)
                && !"digemployee.default.super.assistant.constraints".equals(key)
                && !"digemployee.default.super.assistant.faqs".equals(key)
                && !"digemployee.default.super.assistant.opening.question.intro".equals(key)
                && !"digemployee.default.super.assistant.opening.question.summary".equals(key)
                && !"digemployee.tag.default.super.assistant".equals(key)),
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
        assertThat(extCaptor.getValue().getTagName()).isEqualTo("localized-tag");
        assertThat(extCaptor.getValue().getPrologue())
            .contains("localized-intro")
            .contains("localized-summary");
    }

    @Test
    void saveDigitalEmployee_setsPersonalAssistantTagNameByOwnerType() {
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
        assertThat(extCaptor.getValue().getTagName()).isEqualTo("digemployee.tag.personal.assistant");
        assertThat(extCaptor.getValue().getSkills()).isEqualTo("[\"1\",\"2\",\"3\"]");
    }

    @Test
    void saveDigitalEmployee_setsEnterpriseTagNameByAgentType() {
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
            .containsExactly("digemployee.tag.agent.assistant", "digemployee.tag.agent.data", "digemployee.tag.agent.qa",
                "digemployee.tag.agent.debug", "digemployee.tag.agent.code");
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
    void setDefaultDigitalEmployee_returnsImmediatelyWhenDefaultMappingIsAlreadyConsistent() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(100L);

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL_DEFAULT, 1L);
        SsResExtDigEmployee currentDefaultExt = buildDigitalEmployeeExt(100L, "current-tag");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);
        superassist.setDefaultDigEmployeeId(100L);

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(currentDefaultExt);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(100L);
        assertThat(result.getNewPersonalDefaultTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(result.getOldResourceId()).isEqualTo(100L);
        assertThat(result.getOldPersonalDefaultTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(result.getOldOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(currentDefaultExt.getTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(CurrentUserHolder.getDefaultDigEmployeeId()).isEqualTo(100L);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(suasSuperassistService, never()).updateById(any(SuasSuperassist.class));
        verify(ssResExtDigEmployeeService).update(currentDefaultExt);
        verify(operationLogService, never()).recordOperationLog(any(SsResource.class), any(OperationTypeEnum.class));
    }

    @Test
    void setDefaultDigitalEmployee_allowsCurrentUserCreatedPersonalAssistant() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(200L);

        SsResource newResource = buildDigitalEmployee(200L, OwnerType.PERSONAL, 1L);
        SsResExtDigEmployee newExt = buildDigitalEmployeeExt(200L, "new-tag");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);

        when(ssResourceService.findById(200L)).thenReturn(newResource);
        when(ssResExtDigEmployeeService.findById(200L)).thenReturn(newExt);
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(200L);
        assertThat(result.getNewPersonalDefaultTagName()).isEqualTo("digemployee.tag.personal.default.assistant");
        assertThat(result.getNewOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(result.getOldResourceId()).isNull();
        assertThat(result.getOldPersonalDefaultTagName()).isNull();
        assertThat(result.getOldOwnerType()).isNull();
        assertThat(newResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(200L);
        verify(ssResourceService).updateResourceEntity(newResource);
    }

    @Test
    void setDefaultDigitalEmployee_keepsDefaultSuperAssistantTagNameForMainResourceCode() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(202L);

        SsResource newResource = buildDigitalEmployee(202L, OwnerType.PERSONAL, 1L);
        newResource.setResourceCode("zhangsan_main");
        SsResExtDigEmployee newExt = buildDigitalEmployeeExt(202L, "old-tag");
        SuasSuperassist superassist = new SuasSuperassist();
        superassist.setSuperassistId(7L);

        when(ssResourceService.findById(202L)).thenReturn(newResource);
        when(ssResExtDigEmployeeService.findById(202L)).thenReturn(newExt);
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewPersonalDefaultTagName()).isEqualTo("digemployee.tag.default.super.assistant");
        assertThat(newExt.getTagName()).isEqualTo("digemployee.tag.default.super.assistant");
        assertThat(newResource.getOwnerType()).isEqualTo(OwnerType.PERSONAL_DEFAULT);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(202L);
        verify(ssResExtDigEmployeeService).update(newExt);
    }

    @Test
    void setDefaultDigitalEmployee_rejectsPersonalAssistantCreatedByAnotherUser() {
        SetDefaultDigitalEmployeeDTO dto = new SetDefaultDigitalEmployeeDTO();
        dto.setResourceId(201L);

        SsResource otherPersonalResource = buildDigitalEmployee(201L, OwnerType.PERSONAL, 2L);
        when(ssResourceService.findById(201L)).thenReturn(otherPersonalResource);

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
        when(ssResourceRelDetailService.querySkillsForOpenApi(100L)).thenReturn(List.of());

        SsResource result = service.updateDigitalEmployee(dto);

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        ArgumentCaptor<SsResExtDigEmployee> extCaptor = ArgumentCaptor.forClass(SsResExtDigEmployee.class);
        verify(ssResourceService).updateResourceEntity(resourceCaptor.capture());
        verify(ssResExtDigEmployeeService).update(extCaptor.capture());

        assertThat(dto.getAgentType()).isEqualTo(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        assertThat(result.getWorkerAgentType()).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
        assertThat(resourceCaptor.getValue().getWorkerAgentType()).isEqualTo(WorkerAgentType.BYCLAW_EXE.getCode());
        assertThat(extCaptor.getValue().getAgentType()).isEqualTo(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
    }

    @Test
    void findDetailsById_populatesRelSkillsFromStoredSkills() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);

        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        detailsDTO.setSkills("[\"1\",\"2\",\"3\"]");

        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        assertThat(result.getSkills()).isEqualTo("[\"1\",\"2\",\"3\"]");
        assertThat(result.getRelSkills()).containsExactly("1", "2", "3");
    }

    private SsResource buildDigitalEmployee(Long resourceId, String ownerType, Long createBy) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        resource.setOwnerType(ownerType);
        resource.setCreateBy(createBy);
        return resource;
    }

    private SsResExtDigEmployee buildDigitalEmployeeExt(Long resourceId, String tagName) {
        SsResExtDigEmployee resource = new SsResExtDigEmployee();
        resource.setResourceId(resourceId);
        resource.setTagName(tagName);
        return resource;
    }
}
