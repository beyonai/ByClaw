package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.constants.resource.ImplType;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.gateway.channels.service.robot.RobotChannelRegistryCoordinator;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.template.TemplateRuleInfoApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.resource.enums.OperationTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.model.SkillRelationSource;
import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupUninstallMode;
import com.iwhalecloud.byai.manager.domain.resource.service.OperationLogService;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceEventService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeInstallResourceDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeGroupMemberDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SetDefaultDigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.manager.vo.digitemploy.SetDefaultDigitalEmployeeResultVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeePageVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupInstallResultVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupUninstallPreviewVo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillDeleteApplicationService;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillPathResolver;
import org.mockito.ArgumentCaptor;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.spy;

import org.mockito.InOrder;

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
    private SystemConfigService systemConfigService;
    private TemplateRuleInfoApplicationService templateRuleInfoApplicationService;
    private ResourceAuthContextService resourceAuthContextService;
    private ResourceArtifactStorageService resourceArtifactStorageService;
    private RobotChannelRegistryCoordinator robotChannelRegistryCoordinator;
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;
    private DigitalEmployeeRuntimeRefreshService digitalEmployeeRuntimeRefreshService;
    private DigitalEmployeeGroupApplicationService digitalEmployeeGroupApplicationService;
    private UserService userService;
    private ByClawSkillDeleteApplicationService byClawSkillDeleteApplicationService;
    private ByClawSkillPathResolver byClawSkillPathResolver;
    private SkillGroupMapper skillGroupMapper;
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
        systemConfigService = mock(SystemConfigService.class);
        templateRuleInfoApplicationService = mock(TemplateRuleInfoApplicationService.class);
        resourceAuthContextService = mock(ResourceAuthContextService.class);
        resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        robotChannelRegistryCoordinator = mock(RobotChannelRegistryCoordinator.class);
        digEmployeeChangeEventPublisher = mock(DigEmployeeChangeEventPublisher.class);
        digitalEmployeeRuntimeRefreshService = mock(DigitalEmployeeRuntimeRefreshService.class);
        digitalEmployeeGroupApplicationService = mock(DigitalEmployeeGroupApplicationService.class);
        when(systemConfigService.getStringParamValueByCode(any())).thenReturn("");
        userService = mock(UserService.class);
        byClawSkillDeleteApplicationService = mock(ByClawSkillDeleteApplicationService.class);
        byClawSkillPathResolver = mock(ByClawSkillPathResolver.class);
        skillGroupMapper = mock(SkillGroupMapper.class);

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
        ReflectionTestUtils.setField(service, "systemConfigService", systemConfigService);
        ReflectionTestUtils.setField(service, "templateRuleInfoApplicationService", templateRuleInfoApplicationService);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", resourceAuthContextService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "robotChannelRegistryCoordinator", robotChannelRegistryCoordinator);
        ReflectionTestUtils.setField(service, "digEmployeeChangeEventPublisher", digEmployeeChangeEventPublisher);
        ReflectionTestUtils.setField(service, "digitalEmployeeRuntimeRefreshService",
            digitalEmployeeRuntimeRefreshService);
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService",
            digitalEmployeeGroupApplicationService);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "byClawSkillDeleteApplicationService", byClawSkillDeleteApplicationService);
        ReflectionTestUtils.setField(service, "byClawSkillPathResolver", byClawSkillPathResolver);
        ReflectionTestUtils.setField(service, "skillGroupMapper", skillGroupMapper);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("zhangsan");
        loginInfo.setAssistantId(7L);
        loginInfo.setDefaultDigEmployeeId(100L);
        loginInfo.setEnterpriseId(201L);
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
        when(authApplicationService.hasResourceUsePermission(newResource, 1L)).thenReturn(true);
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
        when(authApplicationService.hasResourceUsePermission(sharedResource, 1L)).thenReturn(true);
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
        when(authApplicationService.hasResourceManagePermission(managedResource)).thenReturn(true);
        when(suasSuperassistService.findById(7L)).thenReturn(superassist);

        SetDefaultDigitalEmployeeResultVo result = service.setDefaultDigitalEmployee(dto);

        assertThat(result.getNewResourceId()).isEqualTo(201L);
        assertThat(superassist.getDefaultDigEmployeeId()).isEqualTo(201L);
        verify(suasSuperassistService).updateById(superassist);
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
    }

    @Test
    void deleteDigitalEmployee_invalidatesEffectiveAuthorizationAfterRemovingResource() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(200L);
        SsResource resource = buildDigitalEmployee(200L, OwnerType.ENTERPRISE, 1L);
        when(ssResourceService.findById(200L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(digitalEmployeeGroupApplicationService.isGroup(200L)).thenReturn(false);

        service.deleteDigitalEmployee(dto);

        assertThat(resource.getResourceStatus()).isEqualTo(ResourceStatus.REMOVED.getNum());
        InOrder order = inOrder(ssResourceService, authApplicationService);
        order.verify(ssResourceService).updateResourceEntity(resource);
        order.verify(authApplicationService).invalidateResourceAuthorizationCachesAfterCommit(200L,
            ResourceBizTypeEnum.DIG_EMPLOYEE.name());
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
        when(ssResourceService.countResource("digemployee.default.super.assistant.resource.name", ResourceBizTypeEnum.DIG_EMPLOYEE.name(), OwnerType.PERSONAL, null))
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
        assertThat(result.getWorkerAgentType()).isEqualTo(WorkerAgentType.BY_SUPER.getCode());
        assertThat(resourceCaptor.getValue().getWorkerAgentType()).isEqualTo(WorkerAgentType.BY_SUPER.getCode());
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
            ResourceBizTypeEnum.DIG_EMPLOYEE.name(), OwnerType.PERSONAL, null)).thenReturn(0L);
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
        when(ssResourceService.countResource("我的个人助理", ResourceBizTypeEnum.DIG_EMPLOYEE.name(), OwnerType.PERSONAL, null)).thenReturn(0L);
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
            when(ssResourceService.countResource(resourceName, ResourceBizTypeEnum.DIG_EMPLOYEE.name(), OwnerType.PERSONAL, null))
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
    void saveDigitalEmployeeCanonicalizesCreatedSkillBeforeRebuildAndLeavesNonSkillUnchanged() {
        DigitalEmployeeApplicationService createService = updateServiceSpy();
        DigitalEmployeeDTO dto = createDto(300L, 400L);
        SsResource skill = buildSkillResource(300L, 2L);
        SsResource object = new SsResource();
        object.setResourceId(400L);
        object.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        List<SsResourceRelDetail> savedRelations = new ArrayList<>();
        when(sequenceService.nextVal()).thenReturn(100L, 901L, 902L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResourceRelDetailService.save(any(SsResourceRelDetail.class))).thenAnswer(invocation -> {
            savedRelations.add(invocation.getArgument(0));
            return true;
        });
        when(ssResourceService.findByIdList(List.of(300L, 400L))).thenReturn(List.of(skill, object));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(300L)))
            .thenAnswer(invocation -> List.of(savedRelations.stream()
                .filter(relation -> relation.getRelResourceId().equals(300L)).findFirst().orElseThrow()));
        when(ssResourceRelDetailService.updateById(any(SsResourceRelDetail.class))).thenReturn(true);

        createService.saveDigitalEmployee(dto);

        SsResourceRelDetail skillRelation = savedRelations.stream()
            .filter(relation -> relation.getRelResourceId().equals(300L)).findFirst().orElseThrow();
        SsResourceRelDetail objectRelation = savedRelations.stream()
            .filter(relation -> relation.getRelResourceId().equals(400L)).findFirst().orElseThrow();
        SkillRelationSource source = SkillRelationSource.parse(skillRelation.getRelResourceInfo());
        assertThat(source.isManual()).isTrue();
        assertThat(source.getSourceGroupIds()).isEmpty();
        assertThat(skillRelation.getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
        assertThat(skillRelation.getRelStatus()).isEqualTo(1);
        assertThat(objectRelation.getRelResourceInfo()).isNull();
        assertThat(objectRelation.getRelTypeName()).isNull();
        assertThat(objectRelation.getRelStatus()).isNull();
        verify(skillGroupMapper, never()).selectDigitalEmployeeForUpdate(any(), any());
        InOrder order = inOrder(skillGroupMapper, ssResourceRelDetailService, createService);
        order.verify(skillGroupMapper).selectDigitalEmployeeSkillRelations(100L, List.of(300L));
        order.verify(ssResourceRelDetailService).updateById(skillRelation);
        order.verify(createService).rebuildAndSaveDigitalEmployeeRelSkills(100L);
    }

    @Test
    void createdCanonicalSkillCanBeDeletedBySubsequentFullEditorOmission() {
        DigitalEmployeeApplicationService createAndUpdateService = updateServiceSpy();
        DigitalEmployeeDTO createDto = createDto(300L);
        SsResource skill = buildSkillResource(300L, 2L);
        List<SsResourceRelDetail> savedRelations = new ArrayList<>();
        when(sequenceService.nextVal()).thenReturn(100L, 901L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResourceRelDetailService.save(any(SsResourceRelDetail.class))).thenAnswer(invocation -> {
            savedRelations.add(invocation.getArgument(0));
            return true;
        });
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(300L)))
            .thenAnswer(invocation -> List.copyOf(savedRelations));
        when(ssResourceRelDetailService.updateById(any(SsResourceRelDetail.class))).thenReturn(true);

        SsResource employee = createAndUpdateService.saveDigitalEmployee(createDto);
        SsResourceRelDetail createdRelation = savedRelations.get(0);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(buildDigitalEmployeeExt(100L, "数字员工"));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(createdRelation));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null)).thenReturn(List.of(createdRelation));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);

        createAndUpdateService.updateDigitalEmployee(updateDto());

        verify(ssResourceRelDetailService).removeById(901L);
    }

    @Test
    void createdCanonicalSkillCanBeDeletedBySubsequentOrdinaryUninstall() {
        DigitalEmployeeApplicationService createAndUninstallService = snapshotServiceSpy();
        SsResource skill = buildSkillResource(300L, 2L);
        List<SsResourceRelDetail> savedRelations = new ArrayList<>();
        when(sequenceService.nextVal()).thenReturn(100L, 901L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResourceRelDetailService.save(any(SsResourceRelDetail.class))).thenAnswer(invocation -> {
            savedRelations.add(invocation.getArgument(0));
            return true;
        });
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(300L)))
            .thenAnswer(invocation -> List.copyOf(savedRelations));
        when(ssResourceRelDetailService.updateById(any(SsResourceRelDetail.class))).thenReturn(true);

        SsResource employee = createAndUninstallService.saveDigitalEmployee(createDto(300L));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(createAndUninstallService)
            .findDetailsById(any(EmployeeIdDTO.class));

        createAndUninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(300L));

        verify(ssResourceRelDetailService).removeById(901L);
    }

    @Test
    void saveDigitalEmployeeFailsWhenSkillCanonicalizationMutationCountIsZero() {
        DigitalEmployeeApplicationService createService = updateServiceSpy();
        SsResource skill = buildSkillResource(300L, 2L);
        List<SsResourceRelDetail> savedRelations = new ArrayList<>();
        when(sequenceService.nextVal()).thenReturn(100L, 901L);
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResourceRelDetailService.save(any(SsResourceRelDetail.class))).thenAnswer(invocation -> {
            savedRelations.add(invocation.getArgument(0));
            return true;
        });
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(300L)))
            .thenAnswer(invocation -> List.copyOf(savedRelations));
        when(ssResourceRelDetailService.updateById(any(SsResourceRelDetail.class))).thenReturn(false);

        assertThatThrownBy(() -> createService.saveDigitalEmployee(createDto(300L)))
            .isInstanceOf(RuntimeException.class);

        verify(createService, never()).rebuildAndSaveDigitalEmployeeRelSkills(100L);
        verify(skillGroupMapper, never()).selectDigitalEmployeeForUpdate(any(), any());
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
    void queryEmployeeGroupMemberCandidates_usesDedicatedPagedQuery() {
        DigitalEmployeeQo qo = new DigitalEmployeeQo();
        qo.setPageNum(2);
        qo.setPageSize(30);
        qo.setKeyword("市场");
        PageInfo<EmployeeGroupMemberDTO> expected = new PageInfo<>();
        when(authApplicationService.isCurrentUserGlobalResourceManager()).thenReturn(false);
        when(ssResExtDigEmployeeService.selectEmployeeGroupMemberCandidates(any(DigitalEmployeeQo.class)))
            .thenReturn(expected);

        PageInfo<EmployeeGroupMemberDTO> result = service.queryEmployeeGroupMemberCandidates(qo);

        ArgumentCaptor<DigitalEmployeeQo> qoCaptor = ArgumentCaptor.forClass(DigitalEmployeeQo.class);
        verify(resourceAuthContextService).setCurrentUserAuthQo(qoCaptor.capture());
        verify(ssResExtDigEmployeeService).selectEmployeeGroupMemberCandidates(qo);
        verifyNoInteractions(digitalEmployeeGroupApplicationService);
        assertThat(result).isSameAs(expected);
        assertThat(qoCaptor.getValue()).isSameAs(qo);
        assertThat(qo.getPageNum()).isEqualTo(2);
        assertThat(qo.getPageSize()).isEqualTo(30);
        assertThat(qo.getKeyword()).isEqualTo("市场");
        assertThat(qo.getMemberCandidateEnterpriseId()).isEqualTo(201L);
        assertThat(qo.getMemberCandidateGlobalManager()).isFalse();
        assertThat(qo.getMemberCandidateAgentTypes()).containsExactlyInAnyOrder("001", "005", "006", "011");
        assertThat(qo.getMemberCandidateIntegrationTypes()).containsExactlyInAnyOrder("INTERFACE", "A2A", "PAGE");
        assertThat(qo.getMemberCandidateStationIds()).isEmpty();
    }

    @Test
    void queryEmployeeGroupMemberCandidates_capsOversizedPage() {
        DigitalEmployeeQo qo = new DigitalEmployeeQo();
        qo.setPageNum(0);
        qo.setPageSize(500);
        when(ssResExtDigEmployeeService.selectEmployeeGroupMemberCandidates(any(DigitalEmployeeQo.class)))
            .thenReturn(new PageInfo<>());

        service.queryEmployeeGroupMemberCandidates(qo);

        assertThat(qo.getPageNum()).isEqualTo(1);
        assertThat(qo.getPageSize()).isEqualTo(100);
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
        when(authApplicationService.hasResourceUsePermission(currentDefaultResource, 1L)).thenReturn(true);
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
        when(authApplicationService.hasResourceUsePermission(newResource, 1L)).thenReturn(true);
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
        when(authApplicationService.hasResourceUsePermission(newResource, 1L)).thenReturn(true);
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
        when(authApplicationService.hasResourceManagePermission(otherPersonalResource)).thenReturn(false);
        when(authApplicationService.hasResourceUsePermission(otherPersonalResource, 1L)).thenReturn(false);

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
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(currentDefaultResource);
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
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(currentDefaultResource);
        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(authApplicationService.hasResourceManagePermission(currentDefaultResource)).thenReturn(false);

        assertThatThrownBy(() -> service.installDigitalEmployeeRelResources(dto)).isInstanceOf(RuntimeException.class);
        verify(authApplicationService, never()).hasResourceUsePermission(skillResource);
        verify(ssResourceRelDetailService, never()).findByResourceId(100L);
    }

    @Test
    void installSkillGroupSnapshotCreatesCanonicalGroupOnlyRelationsInInputOrderAndRefreshesOnce() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(302L, 301L)))
            .thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(901L, 902L);
        when(skillGroupMapper.insertDigitalEmployeeSkillIfAbsent(any())).thenReturn(1);

        SkillGroupInstallResultVo result = snapshotService.installSkillGroupSnapshot(
            employee, 700L, List.of(302L, 301L, 302L));

        assertThat(result.getTotalSkillIds()).containsExactly(302L, 301L);
        assertThat(result.getInstalledSkillIds()).containsExactly(302L, 301L);
        assertThat(result.getExistingSkillIds()).isEmpty();
        ArgumentCaptor<SsResourceRelDetail> inserted = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(skillGroupMapper, times(2)).insertDigitalEmployeeSkillIfAbsent(inserted.capture());
        assertThat(inserted.getAllValues()).extracting(SsResourceRelDetail::getRelResourceId)
            .containsExactly(302L, 301L);
        assertThat(inserted.getAllValues()).allSatisfy(relation -> {
            assertThat(relation.getResourceId()).isEqualTo(100L);
            assertThat(relation.getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
            assertThat(relation.getRelStatus()).isEqualTo(1);
            assertThat(relation.getComAcctId()).isEqualTo(201L);
            SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
            assertThat(source.isManual()).isFalse();
            assertThat(source.getSourceGroupIds()).containsExactly(700L);
            assertThat(source.getLegacySourceGroupIds()).isEmpty();
            assertThat(source.getGroupInstallers()).containsExactlyEntriesOf(Map.of(700L, Set.of(1L)));
        });
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(longs = {0L, -1L})
    void installSkillGroupSnapshotRejectsInvalidInstallerIdentityBeforeAnyMutation(Long currentUserId) {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        CurrentUserHolder.getLoginInfo().setUserId(currentUserId);

        assertThatThrownBy(() -> snapshotService.installSkillGroupSnapshot(employee, 700L, List.of(301L)))
            .isInstanceOf(BaseException.class)
            .hasMessage("digemployee.default.set.user.not.login");

        verifyNoInteractions(skillGroupMapper, sequenceService, ssResourceRelDetailService);
        verifySnapshotRefresh(snapshotService, employee, 0);
    }

    @Test
    void installSkillGroupSnapshotPreservesManualAndOtherGroupsAndMigratesMalformedLegacy() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        SsResourceRelDetail manual = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[]}");
        SsResourceRelDetail otherGroup = directSkillRelation(902L, 302L,
            "{\"manual\":false,\"sourceGroupIds\":[600]}");
        SsResourceRelDetail malformedLegacy = directSkillRelation(903L, 303L, "{not-json");
        malformedLegacy.setRelTypeName(null);
        malformedLegacy.setRelStatus(null);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L, 302L, 303L)))
            .thenReturn(List.of(manual, otherGroup, malformedLegacy));
        when(ssResourceRelDetailService.updateById(any())).thenReturn(true);

        SkillGroupInstallResultVo result = snapshotService.installSkillGroupSnapshot(
            employee, 700L, List.of(301L, 302L, 303L));

        assertThat(result.getInstalledSkillIds()).isEmpty();
        assertThat(result.getExistingSkillIds()).containsExactly(301L, 302L, 303L);
        assertThat(SkillRelationSource.parse(manual.getRelResourceInfo()).isManual()).isTrue();
        assertThat(SkillRelationSource.parse(manual.getRelResourceInfo()).getSourceGroupIds()).containsExactly(700L);
        SkillRelationSource otherGroupSource = SkillRelationSource.parse(otherGroup.getRelResourceInfo());
        assertThat(otherGroupSource.getLegacySourceGroupIds()).containsExactly(600L);
        assertThat(otherGroupSource.getGroupInstallers()).containsExactlyEntriesOf(Map.of(700L, Set.of(1L)));
        assertThat(otherGroupSource.getSourceGroupIds()).containsExactly(600L, 700L);
        assertThat(SkillRelationSource.parse(malformedLegacy.getRelResourceInfo()).isManual()).isTrue();
        assertThat(SkillRelationSource.parse(malformedLegacy.getRelResourceInfo()).isMalformed()).isFalse();
        assertThat(SkillRelationSource.parse(malformedLegacy.getRelResourceInfo()).getSourceGroupIds())
            .containsExactly(700L);
        assertThat(List.of(manual, otherGroup, malformedLegacy)).allSatisfy(relation -> {
            assertThat(relation.getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
            assertThat(relation.getRelStatus()).isEqualTo(1);
        });
        verify(ssResourceRelDetailService, times(3)).updateById(any());
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @Test
    void installSkillGroupSnapshotPreservesManualAndExistingV2Installers() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail manual = directSkillRelation(901L, 301L,
            "{\"version\":2,\"manual\":true,\"sourceGroupIds\":[700],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"700\":[1]}}");
        SsResourceRelDetail otherInstaller = directSkillRelation(902L, 302L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[600],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"600\":[2]}}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L, 302L)))
            .thenReturn(List.of(manual, otherInstaller));
        when(ssResourceRelDetailService.updateById(any())).thenReturn(true);

        snapshotService.installSkillGroupSnapshot(employee, 701L, List.of(301L, 302L));

        SkillRelationSource manualSource = SkillRelationSource.parse(manual.getRelResourceInfo());
        assertThat(manualSource.isManual()).isTrue();
        assertThat(manualSource.getLegacySourceGroupIds()).isEmpty();
        assertThat(manualSource.getGroupInstallers()).hasSize(2)
            .containsEntry(700L, Set.of(1L))
            .containsEntry(701L, Set.of(1L));
        SkillRelationSource otherInstallerSource = SkillRelationSource.parse(otherInstaller.getRelResourceInfo());
        assertThat(otherInstallerSource.getLegacySourceGroupIds()).isEmpty();
        assertThat(otherInstallerSource.getGroupInstallers()).hasSize(2)
            .containsEntry(600L, Set.of(2L))
            .containsEntry(701L, Set.of(1L));
        verify(ssResourceRelDetailService, times(2)).updateById(any());
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @Test
    void installSkillGroupSnapshotReturnsExactMixedNewAndExistingResultsWithOneRefresh() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        SsResourceRelDetail existing = directSkillRelation(901L, 301L,
            "{\"manual\":false,\"sourceGroupIds\":[600]}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(302L, 301L)))
            .thenReturn(List.of(existing));
        when(sequenceService.nextVal()).thenReturn(902L);
        when(skillGroupMapper.insertDigitalEmployeeSkillIfAbsent(any())).thenReturn(1);
        when(ssResourceRelDetailService.updateById(existing)).thenReturn(true);

        SkillGroupInstallResultVo result = snapshotService.installSkillGroupSnapshot(
            employee, 700L, List.of(302L, 301L, 302L));

        assertThat(result.getTotalSkillIds()).containsExactly(302L, 301L);
        assertThat(result.getInstalledSkillIds()).containsExactly(302L);
        assertThat(result.getExistingSkillIds()).containsExactly(301L);
        assertThat(SkillRelationSource.parse(existing.getRelResourceInfo()).getSourceGroupIds())
            .containsExactly(600L, 700L);
        ArgumentCaptor<SsResourceRelDetail> inserted = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(skillGroupMapper).insertDigitalEmployeeSkillIfAbsent(inserted.capture());
        assertThat(inserted.getValue().getRelResourceId()).isEqualTo(302L);
        assertThat(SkillRelationSource.parse(inserted.getValue().getRelResourceInfo()).getSourceGroupIds())
            .containsExactly(700L);
        assertThat(SkillRelationSource.parse(inserted.getValue().getRelResourceInfo()).getLegacySourceGroupIds())
            .isEmpty();
        assertThat(SkillRelationSource.parse(inserted.getValue().getRelResourceInfo()).getGroupInstallers())
            .containsExactlyEntriesOf(Map.of(700L, Set.of(1L)));
        verify(ssResourceRelDetailService).updateById(existing);
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @Test
    void repeatedSnapshotInstallIsIdempotentAndDoesNotRefreshRuntime() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[700],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"700\":[1]}}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(relation));

        SkillGroupInstallResultVo result = snapshotService.installSkillGroupSnapshot(employee, 700L, List.of(301L));

        assertThat(result.getExistingSkillIds()).containsExactly(301L);
        verify(ssResourceRelDetailService, never()).updateById(any());
        verify(skillGroupMapper, never()).insertDigitalEmployeeSkillIfAbsent(any());
        verifySnapshotRefresh(snapshotService, employee, 0);
    }

    @Test
    void installSkillGroupSnapshotMergesCurrentUserIntoExistingGroupInstallersThenBecomesIdempotent() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[700],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"700\":[2]}}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(relation));
        when(ssResourceRelDetailService.updateById(relation)).thenReturn(true);

        snapshotService.installSkillGroupSnapshot(employee, 700L, List.of(301L));
        snapshotService.installSkillGroupSnapshot(employee, 700L, List.of(301L));

        SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
        assertThat(source.getLegacySourceGroupIds()).isEmpty();
        assertThat(source.getGroupInstallers()).containsExactlyEntriesOf(Map.of(700L, Set.of(1L, 2L)));
        assertThat(relation.getRelResourceInfo()).isEqualTo(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[700],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"700\":[1,2]}}");
        verify(ssResourceRelDetailService).updateById(relation);
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @Test
    void uninstallSkillGroupSnapshotRemovesOnlyGroupSourceAndIgnoresMalformedMetadata() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail groupOnly = directSkillRelation(901L, 301L,
            "{\"manual\":false,\"sourceGroupIds\":[700]}");
        SsResourceRelDetail manual = directSkillRelation(902L, 302L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        SsResourceRelDetail other = directSkillRelation(903L, 303L,
            "{\"manual\":false,\"sourceGroupIds\":[600,700]}");
        SsResourceRelDetail manualOther = directSkillRelation(904L, 304L,
            "{\"version\":2,\"manual\":true,\"sourceGroupIds\":[600,700],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"600\":[2],\"700\":[1,2]}}");
        SsResourceRelDetail malformed = directSkillRelation(905L, 305L, "{not-json");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null))
            .thenReturn(List.of(groupOnly, manual, other, manualOther, malformed));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);
        when(ssResourceRelDetailService.updateById(any())).thenReturn(true);

        SkillGroupInstallResultVo result = snapshotService.uninstallSkillGroupSnapshot(employee, 700L);

        assertThat(result.getTotalSkillIds()).containsExactly(301L, 302L, 303L, 304L);
        assertThat(result.getRemovedSkillIds()).containsExactly(301L);
        assertThat(result.getRetainedSkillIds()).containsExactly(302L, 303L, 304L);
        verify(ssResourceRelDetailService).removeById(901L);
        verify(ssResourceRelDetailService, times(3)).updateById(any());
        assertThat(SkillRelationSource.parse(manual.getRelResourceInfo()).isManual()).isTrue();
        assertThat(SkillRelationSource.parse(other.getRelResourceInfo()).getSourceGroupIds()).containsExactly(600L);
        assertThat(SkillRelationSource.parse(manualOther.getRelResourceInfo()).getSourceGroupIds())
            .containsExactly(600L);
        assertThat(SkillRelationSource.parse(manualOther.getRelResourceInfo()).getLegacySourceGroupIds()).isEmpty();
        assertThat(SkillRelationSource.parse(manualOther.getRelResourceInfo()).getGroupInstallers())
            .containsExactlyEntriesOf(Map.of(600L, Set.of(2L)));
        assertThat(malformed.getRelResourceInfo()).isEqualTo("{not-json");
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @Test
    void repeatedSnapshotUninstallIsNoOpWithoutRuntimeRefresh() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null)).thenReturn(List.of(
            directSkillRelation(901L, 301L, "{\"manual\":true,\"sourceGroupIds\":[]}"),
            directSkillRelation(902L, 302L, "{not-json")));

        SkillGroupInstallResultVo result = snapshotService.uninstallSkillGroupSnapshot(employee, 700L);

        assertThat(result.getTotalSkillIds()).isEmpty();
        assertThat(result.getRemovedSkillIds()).isEmpty();
        assertThat(result.getRetainedSkillIds()).isEmpty();
        verify(ssResourceRelDetailService, never()).removeById(any());
        verify(ssResourceRelDetailService, never()).updateById(any());
        verifySnapshotRefresh(snapshotService, employee, 0);
    }

    @Test
    void snapshotUninstallLeavesMixedMalformedTargetGroupSourceUntouchedWithoutRefresh() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        String malformedSource = "{\"manual\":false,\"sourceGroupIds\":[700,\"bad\"]}";
        SsResourceRelDetail malformed = directSkillRelation(901L, 301L, malformedSource);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null)).thenReturn(List.of(malformed));

        SkillGroupInstallResultVo result = snapshotService.uninstallSkillGroupSnapshot(employee, 700L);

        assertThat(result.getTotalSkillIds()).isEmpty();
        assertThat(result.getRemovedSkillIds()).isEmpty();
        assertThat(result.getRetainedSkillIds()).isEmpty();
        assertThat(malformed.getRelResourceInfo()).isEqualTo(malformedSource);
        verify(ssResourceRelDetailService, never()).removeById(any());
        verify(ssResourceRelDetailService, never()).updateById(any());
        verifySnapshotRefresh(snapshotService, employee, 0);
    }

    @Test
    void uninstallPreviewClassifiesExclusiveAndSharedSnapshotSources() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail exclusive = directSkillRelation(901L, 301L,
            "{\"manual\":false,\"sourceGroupIds\":[700]}");
        SsResourceRelDetail manual = directSkillRelation(902L, 302L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        SsResourceRelDetail otherGroup = directSkillRelation(903L, 303L,
            "{\"manual\":false,\"sourceGroupIds\":[700,701]}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null))
            .thenReturn(List.of(exclusive, manual, otherGroup));

        SkillGroupUninstallPreviewVo preview = snapshotService.previewSkillGroupUninstallSnapshot(employee, 700L);

        assertThat(preview.getInstalledByGroup()).isTrue();
        assertThat(preview.getExclusiveSkills()).extracting("resourceId").containsExactly(301L);
        assertThat(preview.getSharedSkills()).extracting("resourceId").containsExactly(302L, 303L);
        assertThat(preview.getSharedSkills().get(0).getManualSource()).isTrue();
        assertThat(preview.getSharedSkills().get(1).getOtherGroupIds()).containsExactly(701L);
        assertThat(preview.getPreviewToken()).isNotBlank();
    }

    @Test
    void removeAllRequiresCurrentPreviewAndDeletesSharedRelations() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail shared = directSkillRelation(902L, 302L,
            "{\"manual\":true,\"sourceGroupIds\":[700,701]}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null)).thenReturn(List.of(shared));
        when(ssResourceRelDetailService.removeById(902L)).thenReturn(true);
        String token = snapshotService.previewSkillGroupUninstallSnapshot(employee, 700L).getPreviewToken();

        SkillGroupInstallResultVo result = snapshotService.uninstallSkillGroupSnapshot(
            employee, 700L, SkillGroupUninstallMode.REMOVE_ALL, token);

        assertThat(result.getConfirmationRequired()).isFalse();
        assertThat(result.getRemovedSkillIds()).containsExactly(302L);
        assertThat(result.getAffectedOtherGroupIds()).containsExactly(701L);
        verify(ssResourceRelDetailService).removeById(902L);
        verifySnapshotRefresh(snapshotService, employee, 1);
    }

    @Test
    void removeAllReturnsLatestPreviewForStaleTokenWithoutMutation() {
        DigitalEmployeeApplicationService snapshotService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail relation = directSkillRelation(902L, 302L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null)).thenReturn(List.of(relation));

        SkillGroupInstallResultVo result = snapshotService.uninstallSkillGroupSnapshot(
            employee, 700L, SkillGroupUninstallMode.REMOVE_ALL, "stale");

        assertThat(result.getConfirmationRequired()).isTrue();
        assertThat(result.getUninstallPreview().getSharedSkills()).hasSize(1);
        verify(ssResourceRelDetailService, never()).removeById(any());
        verifySnapshotRefresh(snapshotService, employee, 0);
    }

    @Test
    void ordinaryDirectSkillInstallMarksSkillManualCanonicalAndLeavesNonSkillMetadataUntouched() {
        DigitalEmployeeApplicationService installService = snapshotServiceSpy();
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(301L, 401L));
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResource object = new SsResource();
        object.setResourceId(401L);
        object.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        SsResourceRelDetail skillRelation = directSkillRelation(901L, 301L,
            "{\"manual\":false,\"sourceGroupIds\":[700,\"bad\"]}");
        skillRelation.setRelTypeName(null);
        skillRelation.setRelStatus(null);
        SsResourceRelDetail objectRelation = new SsResourceRelDetail();
        objectRelation.setResourceRelDetailId(902L);
        objectRelation.setResourceId(100L);
        objectRelation.setRelResourceId(401L);
        when(ssResourceService.findById(100L)).thenReturn(employee);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(ssResourceService.findByIdList(List.of(301L, 401L))).thenReturn(List.of(skill, object));
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(authApplicationService.hasResourceUsePermission(skill)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(skillRelation, objectRelation));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(skillRelation));
        when(ssResourceRelDetailService.updateById(any())).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(installService).findDetailsById(any(EmployeeIdDTO.class));

        installService.installDigitalEmployeeRelResources(dto);

        SkillRelationSource source = SkillRelationSource.parse(skillRelation.getRelResourceInfo());
        assertThat(source.isManual()).isTrue();
        assertThat(source.isMalformed()).isFalse();
        assertThat(source.getSourceGroupIds()).containsExactly(700L);
        assertThat(skillRelation.getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
        assertThat(skillRelation.getRelStatus()).isEqualTo(1);
        assertThat(objectRelation.getRelTypeName()).isNull();
        assertThat(objectRelation.getRelStatus()).isNull();
        assertThat(objectRelation.getRelResourceInfo()).isNull();
    }

    @Test
    void ordinaryDirectSkillInstallPreservesV2LegacyAndAttributedSourcesWhenMarkingManual() {
        DigitalEmployeeApplicationService installService = snapshotServiceSpy();
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(301L));
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[600,700],"
                + "\"legacySourceGroupIds\":[600],\"groupInstallers\":{\"700\":[2,3]}}");
        when(ssResourceService.findById(100L)).thenReturn(employee);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(ssResourceService.findByIdList(List.of(301L))).thenReturn(List.of(skill));
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(authApplicationService.hasResourceUsePermission(skill)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(relation));
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(relation));
        when(ssResourceRelDetailService.updateById(relation)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(installService).findDetailsById(any(EmployeeIdDTO.class));

        installService.installDigitalEmployeeRelResources(dto);

        SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
        assertThat(source.isManual()).isTrue();
        assertThat(source.getLegacySourceGroupIds()).containsExactly(600L);
        assertThat(source.getGroupInstallers()).containsExactlyEntriesOf(Map.of(700L, Set.of(2L, 3L)));
    }

    @Test
    void ordinaryInstallLocksEmployeeBeforeCreatingAndCanonicalizingNewSkillRelation() {
        DigitalEmployeeApplicationService installService = snapshotServiceSpy();
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(301L, 401L));
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResource object = new SsResource();
        object.setResourceId(401L);
        object.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        SsResourceRelDetail[] createdSkill = new SsResourceRelDetail[1];
        SsResourceRelDetail[] createdObject = new SsResourceRelDetail[1];
        when(ssResourceService.findById(100L)).thenReturn(employee);
        when(ssResourceService.findByIdList(List.of(301L, 401L))).thenReturn(List.of(skill, object));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(authApplicationService.hasResourceUsePermission(skill)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(901L, 902L);
        when(ssResourceRelDetailService.save(any())).thenAnswer(invocation -> {
            SsResourceRelDetail relation = invocation.getArgument(0);
            if (relation.getRelResourceId().equals(301L)) {
                createdSkill[0] = relation;
            } else if (relation.getRelResourceId().equals(401L)) {
                createdObject[0] = relation;
            }
            return true;
        });
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenAnswer(ignored -> createdSkill[0] == null ? List.of() : List.of(createdSkill[0]));
        when(ssResourceRelDetailService.updateById(any())).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(installService).findDetailsById(any(EmployeeIdDTO.class));

        installService.installDigitalEmployeeRelResources(dto);

        assertThat(createdSkill[0]).isNotNull();
        assertThat(createdSkill[0].getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
        assertThat(createdSkill[0].getRelStatus()).isEqualTo(1);
        assertThat(SkillRelationSource.parse(createdSkill[0].getRelResourceInfo()).isManual()).isTrue();
        assertThat(createdObject[0]).isNotNull();
        assertThat(createdObject[0].getRelTypeName()).isNull();
        assertThat(createdObject[0].getRelStatus()).isNull();
        assertThat(createdObject[0].getRelResourceInfo()).isNull();
        InOrder order = inOrder(skillGroupMapper, ssResourceRelDetailService);
        order.verify(skillGroupMapper).selectDigitalEmployeeForUpdate(100L, 201L);
        order.verify(ssResourceRelDetailService).findByResourceId(100L);
        order.verify(ssResourceRelDetailService, times(2)).save(any());
        order.verify(skillGroupMapper).selectDigitalEmployeeSkillRelations(100L, List.of(301L));
        order.verify(ssResourceRelDetailService).updateById(createdSkill[0]);
    }

    @Test
    void ordinarySkillInstallFailsClosedWithoutTenantOrLockedEmployeeBeforeRelationReads() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(301L));
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        when(ssResourceService.findById(100L)).thenReturn(employee);
        when(ssResourceService.findByIdList(List.of(301L))).thenReturn(List.of(skill));

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        loginInfo.setEnterpriseId(null);
        assertThatThrownBy(() -> service.installDigitalEmployeeRelResources(dto))
            .isInstanceOf(RuntimeException.class);
        verify(skillGroupMapper, never()).selectDigitalEmployeeForUpdate(any(), any());
        verify(ssResourceRelDetailService, never()).findByResourceId(any());

        loginInfo.setEnterpriseId(201L);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(null);
        assertThatThrownBy(() -> service.installDigitalEmployeeRelResources(dto))
            .isInstanceOf(RuntimeException.class);
        verify(ssResourceRelDetailService, never()).findByResourceId(any());
        verifyNoInteractions(authApplicationService);
    }

    @Test
    void ordinarySkillUninstallLocksThenDeletesManualOnlyRelationAndRefreshesOnce() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        DigitalEmployeeInstallResourceDTO dto = uninstallDto(301L);
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[]}");
        when(ssResourceService.findByIdList(List.of(301L))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(relation));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(uninstallService).findDetailsById(any(EmployeeIdDTO.class));

        uninstallService.uninstallDigitalEmployeeRelResources(dto);

        InOrder order = inOrder(skillGroupMapper, authApplicationService, ssResourceRelDetailService);
        order.verify(skillGroupMapper).selectDigitalEmployeeForUpdate(100L, 201L);
        order.verify(authApplicationService).hasResourceManagePermission(employee);
        order.verify(skillGroupMapper).selectDigitalEmployeeSkillRelations(100L, List.of(301L));
        order.verify(ssResourceRelDetailService).removeById(901L);
        verify(ssResourceRelDetailService, never()).updateById(relation);
        verifySnapshotRefresh(uninstallService, employee, 1);
    }

    @Test
    void ordinarySkillUninstallRemovesManualSourceAndRetainsGroupRelation() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        when(ssResourceService.findByIdList(List.of(301L))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(relation));
        when(ssResourceRelDetailService.updateById(relation)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(uninstallService).findDetailsById(any(EmployeeIdDTO.class));

        uninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(301L));

        SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
        assertThat(source.isManual()).isFalse();
        assertThat(source.getSourceGroupIds()).containsExactly(700L);
        assertThat(relation.getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
        assertThat(relation.getRelStatus()).isEqualTo(1);
        assertThat(relation.getComAcctId()).isEqualTo(201L);
        verify(ssResourceRelDetailService).updateById(relation);
        verify(ssResourceRelDetailService, never()).removeById(any());
        verifySnapshotRefresh(uninstallService, employee, 1);
    }

    @Test
    void ordinarySkillUninstallLeavesGroupOnlyRelationAndStillRefreshesResponseRuntime() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"manual\":false,\"sourceGroupIds\":[700]}");
        prepareOrdinarySkillUninstall(employee, skill, relation);
        doReturn(new DigitalEmployeeDetailsDTO()).when(uninstallService).findDetailsById(any(EmployeeIdDTO.class));

        uninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(301L));

        verify(ssResourceRelDetailService, never()).updateById(any());
        verify(ssResourceRelDetailService, never()).removeById(any());
        assertThat(relation.getRelResourceInfo())
            .isEqualTo("{\"manual\":false,\"sourceGroupIds\":[700]}");
        verifySnapshotRefresh(uninstallService, employee, 1);
    }

    @Test
    void ordinarySkillUninstallLeavesMalformedRelationUntouchedAndStillRefreshes() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        String malformedSource = "{not-json";
        SsResourceRelDetail relation = directSkillRelation(901L, 301L, malformedSource);
        prepareOrdinarySkillUninstall(employee, skill, relation);
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setResourceId(100L);
        details.setPrologue("{}");
        SsResourceDTO responseSkill = new SsResourceDTO();
        responseSkill.setResourceId(301L);
        responseSkill.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        responseSkill.setRelResourceInfo(malformedSource);
        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(details);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of(responseSkill));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L))
            .thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = uninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(301L));

        verify(ssResourceRelDetailService, never()).updateById(any());
        verify(ssResourceRelDetailService, never()).removeById(any());
        assertThat(relation.getRelResourceInfo()).isEqualTo(malformedSource);
        assertThat(result.getRelResourceList()).containsExactly(responseSkill);
        assertThat(responseSkill.getActiveResourceNum()).isZero();
        verifySnapshotRefresh(uninstallService, employee, 1);
    }

    @Test
    void ordinarySkillUninstallProcessesDuplicateRowsInMapperOrderAndPreservesRemainingSource() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        employee.setComAcctId(201L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResourceRelDetail manualOnly = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[]}");
        SsResourceRelDetail manualAndGroup = directSkillRelation(902L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        when(ssResourceService.findByIdList(List.of(301L))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(manualOnly, manualAndGroup));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);
        when(ssResourceRelDetailService.updateById(manualAndGroup)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(uninstallService).findDetailsById(any(EmployeeIdDTO.class));

        uninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(301L, 301L));

        InOrder order = inOrder(ssResourceRelDetailService);
        order.verify(ssResourceRelDetailService).removeById(901L);
        order.verify(ssResourceRelDetailService).updateById(manualAndGroup);
        assertThat(SkillRelationSource.parse(manualAndGroup.getRelResourceInfo()).isManual()).isFalse();
        assertThat(SkillRelationSource.parse(manualAndGroup.getRelResourceInfo()).getSourceGroupIds())
            .containsExactly(700L);
        verify(byClawSkillDeleteApplicationService, never()).deleteSkillIfExists(any(), any(), any());
        verifySnapshotRefresh(uninstallService, employee, 1);
    }

    @Test
    void ordinaryNonSkillUninstallKeepsLegacyFullDeleteFlowWithoutEmployeeRowLock() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource object = new SsResource();
        object.setResourceId(401L);
        object.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(901L);
        relation.setResourceId(100L);
        relation.setRelResourceId(401L);
        when(ssResourceService.findByIdList(List.of(401L))).thenReturn(List.of(object));
        when(ssResourceService.findById(100L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(relation));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(uninstallService).findDetailsById(any(EmployeeIdDTO.class));

        uninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(401L));

        verify(skillGroupMapper, never()).selectDigitalEmployeeForUpdate(any(), any());
        verify(skillGroupMapper, never()).selectDigitalEmployeeSkillRelations(any(), any());
        verify(ssResourceRelDetailService).removeById(901L);
        verify(uninstallService).rebuildAndSaveDigitalEmployeeRelSkills(100L);
        verify(uninstallService).synOpenClawWorkSpace(100L);
        verify(operationLogService).recordOperationLog(employee, OperationTypeEnum.UPDATE);
        verify(robotChannelRegistryCoordinator).refreshForResource(100L);
        verify(digEmployeeChangeEventPublisher).publishAfterCommitOrNow(any(), eq(100L));
        verifyNoInteractions(digitalEmployeeRuntimeRefreshService);
    }

    @Test
    void ordinaryMixedUninstallPreservesGroupSkillAndFullyDeletesRequestedNonSkill() {
        DigitalEmployeeApplicationService uninstallService = snapshotServiceSpy();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResource object = new SsResource();
        object.setResourceId(401L);
        object.setResourceBizType(ResourceBizTypeEnum.OBJECT.name());
        SsResourceRelDetail skillRelation = directSkillRelation(901L, 301L,
            "{\"manual\":false,\"sourceGroupIds\":[700]}");
        SsResourceRelDetail objectRelation = new SsResourceRelDetail();
        objectRelation.setResourceRelDetailId(902L);
        objectRelation.setResourceId(100L);
        objectRelation.setRelResourceId(401L);
        when(ssResourceService.findByIdList(List.of(301L, 401L))).thenReturn(List.of(skill, object));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(301L)))
            .thenReturn(List.of(skillRelation));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of(skillRelation, objectRelation));
        when(ssResourceRelDetailService.removeById(902L)).thenReturn(true);
        doReturn(new DigitalEmployeeDetailsDTO()).when(uninstallService).findDetailsById(any(EmployeeIdDTO.class));

        uninstallService.uninstallDigitalEmployeeRelResources(uninstallDto(301L, 401L));

        verify(ssResourceRelDetailService, never()).updateById(skillRelation);
        verify(ssResourceRelDetailService, never()).removeById(901L);
        verify(ssResourceRelDetailService).removeById(902L);
        verifySnapshotRefresh(uninstallService, employee, 1);
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
        skillRel.setRelResourceInfo("{\"manual\":true,\"sourceGroupIds\":[]}");
        SsResExtDigEmployee extDigEmployee = buildDigitalEmployeeExt(100L, "默认个人助理");
        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");

        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(currentDefaultResource);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(300L)))
            .thenReturn(List.of(skillRel));
        when(authApplicationService.hasResourceManagePermission(currentDefaultResource)).thenReturn(true);
        when(ssResourceRelDetailService.removeById(900L)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
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
    void uninstallDigitalEmployeeRelResources_deletesLegacyChatUploadWorkspaceCopy() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(300L));

        SsResource digitalEmployee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skillResource = buildSkillResource(300L, 1L);
        SsResourceRelDetail skillRel = new SsResourceRelDetail();
        skillRel.setResourceRelDetailId(900L);
        skillRel.setResourceId(100L);
        skillRel.setRelResourceId(300L);
        skillRel.setRelResourceInfo("{\"manual\":true,\"sourceGroupIds\":[]}");
        SsResExtSkill extSkill = new SsResExtSkill();
        extSkill.setResourceId(300L);
        extSkill.setSourceType("CHAT_UPLOAD");
        extSkill.setTargetContent("{\"skillPath\":\"/.openclaw/workspace-baiying-agent-100/skills/dws\"}");
        Users creator = new Users();
        creator.setUserCode("zhangsan");
        SsResExtDigEmployee extDigEmployee = buildDigitalEmployeeExt(100L, "默认个人助理");
        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");

        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(digitalEmployee);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(300L)))
            .thenReturn(List.of(skillRel));
        when(authApplicationService.hasResourceManagePermission(digitalEmployee)).thenReturn(true);
        when(ssResExtSkillService.findById(300L)).thenReturn(extSkill);
        when(userService.findById(1L)).thenReturn(creator);
        when(byClawSkillPathResolver.resolveSkillRootPrefix("zhangsan", 100L))
            .thenReturn("/.openclaw/workspace-baiying-agent-100/skills/");
        when(ssResourceRelDetailService.removeById(900L)).thenReturn(true);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(extDigEmployee);
        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        service.uninstallDigitalEmployeeRelResources(dto);

        verify(byClawSkillDeleteApplicationService).deleteSkillIfExists("zhangsan", 100L,
            "/.openclaw/workspace-baiying-agent-100/skills/dws");
        verify(ssResourceRelDetailService).removeById(900L);
    }

    @Test
    void uninstallDigitalEmployeeRelResources_rejectsSkillWhenDefaultDigitalEmployeeHasNoManagePermission() {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(300L));

        SsResource currentDefaultResource = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skillResource = buildSkillResource(300L, 2L);

        when(ssResourceService.findByIdList(List.of(300L))).thenReturn(List.of(skillResource));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(currentDefaultResource);
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
        currentDefaultResource.setComAcctId(201L);
        SsResExtDigEmployee currentDefaultExt = buildDigitalEmployeeExt(100L, "默认个人助理");
        currentDefaultExt.setAgentType(DigitalEmployType.AGENT_TYPE_CODE.getCode());

        when(ssResourceService.findById(100L)).thenReturn(currentDefaultResource);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(currentDefaultResource);
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
        verify(digitalEmployeeRuntimeRefreshService).scheduleDigitalEmployeeUpdateRefreshAfterCommit(100L, dto);
    }

    @Test
    void updateDigitalEmployee_preservesHarnessRuntimeWhenEditingProfile() {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceId(100L);
        dto.setResourceName("研发专家");
        dto.setOwnerType(OwnerType.ENTERPRISE);
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_QA.getCode());

        SsResource currentResource = buildDigitalEmployee(100L, OwnerType.ENTERPRISE, 1L);
        currentResource.setComAcctId(201L);
        currentResource.setWorkerAgentType("HARNESS");
        SsResExtDigEmployee currentExt = buildDigitalEmployeeExt(100L, "研发专家");
        currentExt.setAgentType(DigitalEmployType.AGENT_TYPE_QA.getCode());

        when(ssResourceService.findById(100L)).thenReturn(currentResource);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(currentResource);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(currentExt);
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        when(authApplicationService.hasResourceManagePermission(currentResource)).thenReturn(true);

        SsResource result = service.updateDigitalEmployee(dto);

        assertThat(result.getWorkerAgentType()).isEqualTo("HARNESS");
        assertThat(result.getImplType()).isEqualTo(ImplType.ASK_AGENT.getCode());
        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).updateResourceEntity(resourceCaptor.capture());
        assertThat(resourceCaptor.getValue().getWorkerAgentType()).isEqualTo("HARNESS");
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
        resource.setComAcctId(201L);
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
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(ssResExtDigEmployeeService.findById(100L)).thenReturn(ext);
        when(ssResourceService.getResourceListByCode(any())).thenReturn(List.of(dwsSkill, blucliSkill));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of()).thenReturn(List.of(dwsRel, blucliRel));
        when(ssResourceService.findByIdList(List.of(300L, 301L))).thenReturn(List.of(dwsSkill, blucliSkill));
        when(skillGroupMapper.insertDigitalEmployeeSkillIfAbsent(any(SsResourceRelDetail.class))).thenReturn(1);
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
    void updateDigitalEmployeeOmittingManualAndGroupSkillRetainsOnlyGroupSource() {
        DigitalEmployeeApplicationService updateService = updateServiceSpy();
        DigitalEmployeeDTO dto = updateDto();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        prepareFullUpdate(employee, List.of(relation), List.of(relation));
        when(ssResourceRelDetailService.updateById(relation)).thenReturn(true);

        updateService.updateDigitalEmployee(dto);

        SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
        assertThat(source.isManual()).isFalse();
        assertThat(source.getSourceGroupIds()).containsExactly(700L);
        verify(ssResourceRelDetailService).updateById(relation);
        verify(ssResourceRelDetailService, never()).removeById(901L);
    }

    @Test
    void updateDigitalEmployeeOmittingManualOnlySkillDeletesRelation() {
        DigitalEmployeeApplicationService updateService = updateServiceSpy();
        DigitalEmployeeDTO dto = updateDto();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[]}");
        prepareFullUpdate(employee, List.of(relation), List.of(relation));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);

        updateService.updateDigitalEmployee(dto);

        verify(ssResourceRelDetailService).removeById(901L);
        verify(ssResourceRelDetailService, never()).updateById(relation);
        verify(skillGroupMapper).selectDigitalEmployeeForUpdate(100L, 201L);
    }

    @Test
    void updateDigitalEmployeeIncludingGroupOnlySkillAddsManualSourceAndPreservesGroup() {
        DigitalEmployeeApplicationService updateService = updateServiceSpy();
        DigitalEmployeeDTO dto = updateDto(301L);
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResource skill = buildSkillResource(301L, 2L);
        SsResourceRelDetail relation = directSkillRelation(901L, 301L,
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[700],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"700\":[2]}}");
        prepareFullUpdate(employee, List.of(relation), List.of(relation));
        when(ssResourceService.findByIdList(List.of(301L))).thenReturn(List.of(skill));
        when(ssResourceRelDetailService.updateById(relation)).thenReturn(true);

        updateService.updateDigitalEmployee(dto);

        SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
        assertThat(source.isManual()).isTrue();
        assertThat(source.getSourceGroupIds()).containsExactly(700L);
        assertThat(source.getLegacySourceGroupIds()).isEmpty();
        assertThat(source.getGroupInstallers()).containsExactlyEntriesOf(Map.of(700L, Set.of(2L)));
        assertThat(relation.getRelTypeName()).isEqualTo("DIG_EMPLOYEE_SKILL");
        assertThat(relation.getRelStatus()).isEqualTo(1);
        verify(ssResourceRelDetailService).updateById(relation);
    }

    @Test
    void updateDigitalEmployeeOmittingMalformedSkillLeavesRelationUntouched() {
        DigitalEmployeeApplicationService updateService = updateServiceSpy();
        DigitalEmployeeDTO dto = updateDto();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        String malformedSource = "{not-json";
        SsResourceRelDetail relation = directSkillRelation(901L, 301L, malformedSource);
        prepareFullUpdate(employee, List.of(relation), List.of(relation));

        updateService.updateDigitalEmployee(dto);

        assertThat(relation.getRelResourceInfo()).isEqualTo(malformedSource);
        verify(ssResourceRelDetailService, never()).updateById(relation);
        verify(ssResourceRelDetailService, never()).removeById(901L);
    }

    @Test
    void updateDigitalEmployeeProcessesDuplicateSkillRowsInMapperOrder() {
        DigitalEmployeeApplicationService updateService = updateServiceSpy();
        DigitalEmployeeDTO dto = updateDto();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail manualOnly = directSkillRelation(901L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[]}");
        SsResourceRelDetail manualAndGroup = directSkillRelation(902L, 301L,
            "{\"manual\":true,\"sourceGroupIds\":[700]}");
        prepareFullUpdate(employee, List.of(manualOnly, manualAndGroup), List.of(manualOnly, manualAndGroup));
        when(ssResourceRelDetailService.removeById(901L)).thenReturn(true);
        when(ssResourceRelDetailService.updateById(manualAndGroup)).thenReturn(true);

        updateService.updateDigitalEmployee(dto);

        InOrder order = inOrder(ssResourceRelDetailService);
        order.verify(ssResourceRelDetailService).removeById(901L);
        order.verify(ssResourceRelDetailService).updateById(manualAndGroup);
        assertThat(SkillRelationSource.parse(manualAndGroup.getRelResourceInfo()).isManual()).isFalse();
        assertThat(SkillRelationSource.parse(manualAndGroup.getRelResourceInfo()).getSourceGroupIds())
            .containsExactly(700L);
    }

    @Test
    void updateDigitalEmployeeLocksBeforeRelationReadsAndKeepsNonSkillDeleteBehavior() {
        DigitalEmployeeApplicationService updateService = updateServiceSpy();
        DigitalEmployeeDTO dto = updateDto();
        SsResource employee = buildDigitalEmployee(100L, OwnerType.PERSONAL, 1L);
        SsResourceRelDetail objectRelation = new SsResourceRelDetail();
        objectRelation.setResourceRelDetailId(903L);
        objectRelation.setResourceId(100L);
        objectRelation.setRelResourceId(401L);
        prepareFullUpdate(employee, List.of(objectRelation), List.of());
        when(ssResourceRelDetailService.removeById(903L)).thenReturn(true);

        updateService.updateDigitalEmployee(dto);

        InOrder order = inOrder(skillGroupMapper, ssResourceRelDetailService);
        order.verify(skillGroupMapper).selectDigitalEmployeeForUpdate(100L, 201L);
        order.verify(ssResourceRelDetailService).findByResourceId(100L);
        order.verify(skillGroupMapper).selectDigitalEmployeeSkillRelations(100L, null);
        order.verify(ssResourceRelDetailService).removeById(903L);
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
    void findDetailsByIdAcceptsCanonicalSkillSourceMetadataWithoutLegacyActiveResourceIds() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);
        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        SsResourceDTO skillResource = new SsResourceDTO();
        skillResource.setResourceId(300L);
        skillResource.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        SkillRelationSource source = SkillRelationSource.manual();
        source.addGroup(700L);
        skillResource.setRelResourceInfo(source.toJson());
        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of(skillResource));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L))
            .thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        assertThat(result.getRelIds()).containsExactly(300L);
        assertThat(result.getRelResourceList()).containsExactly(skillResource);
        assertThat(skillResource.getActiveResourceNum()).isZero();
    }

    @Test
    void findDetailsByIdTreatsInvalidJsonAsZeroAndPreservesLegacyActiveResourceCount() {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);
        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        SsResourceDTO malformed = new SsResourceDTO();
        malformed.setResourceId(300L);
        malformed.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        malformed.setRelResourceInfo("{not-json");
        SsResourceDTO legacy = new SsResourceDTO();
        legacy.setResourceId(301L);
        legacy.setResourceBizType(ResourceBizTypeEnum.SKILL.name());
        legacy.setRelResourceInfo("{\"relId\":\"301\",\"activeResourceIds\":[\"1\",\"2\"]}");
        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of(malformed, legacy));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L))
            .thenReturn(List.of());

        DigitalEmployeeDetailsDTO result = service.findDetailsById(dto);

        assertThat(result.getRelResourceList()).containsExactly(malformed, legacy);
        assertThat(malformed.getActiveResourceNum()).isZero();
        assertThat(legacy.getActiveResourceNum()).isEqualTo(2);
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
    void findDetailsById_populatesImageModelIdFromTargetContent() {
        DigitalEmployeeDetailsDTO result = findDetailsWithTargetContent("{\"imageModelId\":\"42\"}");

        assertThat(result.getImageModelId()).isEqualTo("42");
    }

    @Test
    void findDetailsById_returnsNullImageModelIdForLegacyTargetContent() {
        DigitalEmployeeDetailsDTO result = findDetailsWithTargetContent("{\"relTools\":[\"tool-a\"]}");

        assertThat(result.getImageModelId()).isNull();
    }

    @Test
    void findDetailsById_returnsNullImageModelIdForJsonNull() {
        DigitalEmployeeDetailsDTO result = findDetailsWithTargetContent("{\"imageModelId\":null}");

        assertThat(result.getImageModelId()).isNull();
    }

    @Test
    void findDetailsById_normalizesBlankImageModelIdToNull() {
        DigitalEmployeeDetailsDTO result = findDetailsWithTargetContent("{\"imageModelId\":\"   \"}");

        assertThat(result.getImageModelId()).isNull();
    }

    @Test
    void findDetailsById_returnsNullImageModelIdForMalformedTargetContent() {
        DigitalEmployeeDetailsDTO result = findDetailsWithTargetContent("{not-json");

        assertThat(result.getImageModelId()).isNull();
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

    private DigitalEmployeeDetailsDTO findDetailsWithTargetContent(String targetContent) {
        EmployeeIdDTO dto = new EmployeeIdDTO();
        dto.setResourceId(100L);

        DigitalEmployeeDetailsDTO detailsDTO = new DigitalEmployeeDetailsDTO();
        detailsDTO.setResourceId(100L);
        detailsDTO.setPrologue("{}");
        detailsDTO.setTargetContent(targetContent);

        when(ssResExtDigEmployeeService.findDetailsById(100L)).thenReturn(detailsDTO);
        when(ssResourceService.findRelResource(100L)).thenReturn(List.of());
        when(templateRuleInfoApplicationService.findMemoryConfigsByResourceIdAndUserId(100L, 1L)).thenReturn(List.of());

        return service.findDetailsById(dto);
    }

    // generateV3 moved to MetaPromptService — see MetaPromptServiceTest

    private DigitalEmployeeApplicationService snapshotServiceSpy() {
        DigitalEmployeeApplicationService snapshotService = spy(service);
        doNothing().when(snapshotService).rebuildAndSaveDigitalEmployeeRelSkills(any());
        doReturn(true).when(snapshotService).synOpenClawWorkSpace(any());
        return snapshotService;
    }

    private DigitalEmployeeApplicationService updateServiceSpy() {
        DigitalEmployeeApplicationService updateService = spy(service);
        doNothing().when(updateService).rebuildAndSaveDigitalEmployeeRelSkills(any());
        return updateService;
    }

    private DigitalEmployeeDTO createDto(Long... relIds) {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceName("数字员工");
        dto.setOwnerType(OwnerType.PERSONAL);
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        dto.setRelIds(List.of(relIds));
        return dto;
    }

    private DigitalEmployeeDTO updateDto(Long... relIds) {
        DigitalEmployeeDTO dto = new DigitalEmployeeDTO();
        dto.setResourceId(100L);
        dto.setResourceName("数字员工");
        dto.setOwnerType(OwnerType.PERSONAL);
        dto.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        dto.setRelIds(List.of(relIds));
        return dto;
    }

    private void prepareFullUpdate(SsResource employee, List<SsResourceRelDetail> allRelations,
                                   List<SsResourceRelDetail> skillRelations) {
        employee.setComAcctId(201L);
        when(ssResourceService.findById(100L)).thenReturn(employee);
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(ssResExtDigEmployeeService.findById(100L))
            .thenReturn(buildDigitalEmployeeExt(100L, "数字员工"));
        when(ssResourceRelDetailService.findByResourceId(100L)).thenReturn(allRelations);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, null)).thenReturn(skillRelations);
    }

    private DigitalEmployeeInstallResourceDTO uninstallDto(Long... resourceIds) {
        DigitalEmployeeInstallResourceDTO dto = new DigitalEmployeeInstallResourceDTO();
        dto.setDigitalEmployeeId(100L);
        dto.setRelIds(List.of(resourceIds));
        return dto;
    }

    private void prepareOrdinarySkillUninstall(
        SsResource employee, SsResource skill, SsResourceRelDetail relation) {
        employee.setComAcctId(201L);
        when(ssResourceService.findByIdList(List.of(skill.getResourceId()))).thenReturn(List.of(skill));
        when(skillGroupMapper.selectDigitalEmployeeForUpdate(100L, 201L)).thenReturn(employee);
        when(authApplicationService.hasResourceManagePermission(employee)).thenReturn(true);
        when(skillGroupMapper.selectDigitalEmployeeSkillRelations(100L, List.of(skill.getResourceId())))
            .thenReturn(List.of(relation));
    }

    private void verifySnapshotRefresh(
        DigitalEmployeeApplicationService snapshotService, SsResource employee, int count) {
        verify(snapshotService, times(count)).rebuildAndSaveDigitalEmployeeRelSkills(employee.getResourceId());
        verify(operationLogService, times(count)).recordOperationLog(employee, OperationTypeEnum.UPDATE);
        verify(digitalEmployeeRuntimeRefreshService, times(count))
            .scheduleSkillRuntimeRefreshAfterCommit(List.of(employee.getResourceId()));
        verify(snapshotService, never()).synOpenClawWorkSpace(employee.getResourceId());
        verify(robotChannelRegistryCoordinator, never()).refreshForResource(employee.getResourceId());
        verify(digEmployeeChangeEventPublisher, never()).publishAfterCommitOrNow(any(), eq(employee.getResourceId()));
    }

    private SsResourceRelDetail directSkillRelation(Long relationId, Long skillId, String sourceInfo) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(relationId);
        relation.setResourceId(100L);
        relation.setRelResourceId(skillId);
        relation.setRelTypeName("DIG_EMPLOYEE_SKILL");
        relation.setRelStatus(1);
        relation.setRelResourceInfo(sourceInfo);
        return relation;
    }

    private SsResource buildDigitalEmployee(Long resourceId, String ownerType, Long createBy) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
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
