package com.iwhalecloud.byai.state.domain.resource.service;

import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceArtifactTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolKitService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.MessageSource;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ToolManServiceTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", null);
    }

    @Test
    void resolveAddToolFromThirdCatalogId_usesJsonCatalogId() {
        ToolManService service = new ToolManService();
        com.alibaba.fastjson.JSONObject root = new com.alibaba.fastjson.JSONObject();
        root.put("catalogId", 123L);

        Long catalogId = ReflectionTestUtils.invokeMethod(service, "resolveAddToolFromThirdCatalogId", root);

        assertThat(catalogId).isEqualTo(123L);
    }

    @Test
    void resolveAddToolFromThirdCatalogId_defaultsToZeroWhenJsonCatalogIdMissing() {
        ToolManService service = new ToolManService();
        com.alibaba.fastjson.JSONObject root = new com.alibaba.fastjson.JSONObject();

        Long catalogId = ReflectionTestUtils.invokeMethod(service, "resolveAddToolFromThirdCatalogId", root);

        assertThat(catalogId).isZero();
    }

    @Test
    void deleteResourceAndAllRel_removesArtifactsPrivilegesRelationsAndMainResource() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        SsResourceRelDetailService ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        SsResourceArtifactService ssResourceArtifactService = mock(SsResourceArtifactService.class);
        ResourceArtifactStorageService resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher = mock(DigEmployeeChangeEventPublisher.class);
        SsResExtDigEmployeeService ssResExtDigEmployeeService = mock(SsResExtDigEmployeeService.class);
        ResourceDiscoveryRegistrationService resourceDiscoveryRegistrationService = mock(ResourceDiscoveryRegistrationService.class);
        DigitalEmployeeApplicationService digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", ssResourceArtifactService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "digEmployeeChangeEventPublisher", digEmployeeChangeEventPublisher);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", ssResExtDigEmployeeService);
        ReflectionTestUtils.setField(service, "resourceDiscoveryRegistrationService", resourceDiscoveryRegistrationService);
        ReflectionTestUtils.setField(service, "digitalEmployeeApplicationService", digitalEmployeeApplicationService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
        prepareRedisUtil();

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(100L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource resource = new SsResource();
        resource.setResourceId(200L);
        resource.setResourceBizType(ResourceBizType.DIG_EMPLOYEE.getCode());
        resource.setOwnerType("personal");
        resource.setResourceCode("DIG_EMPLOYEE_200");
        when(ssResourceService.findById(200L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);

        SsResourceArtifact jsonArtifact = new SsResourceArtifact();
        jsonArtifact.setArtifactType(ResourceArtifactTypeEnum.STANDARD_JSON.name());
        jsonArtifact.setArtifactPath("dig_employee/DIG_EMPLOYEE_200.json");
        when(ssResourceArtifactService.listActiveArtifactsByResourceId(200L)).thenReturn(List.of(jsonArtifact));

        service.deleteResourceAndAllRel(200L);

        verify(resourceArtifactStorageService).deleteWithinResourceRoot("dig_employee/DIG_EMPLOYEE_200.json");
        verify(privilegeGrantService).removeAllByGrantObj(ResourceBizType.DIG_EMPLOYEE.getCode(), 200L);
        verify(ssResourceRelDetailService).removeAllByResourceIdOrRelResourceId(200L);
        verify(ssResExtDigEmployeeService).removeById(200L);
        verify(ssResourceService).removeById(200L);
        verify(digEmployeeChangeEventPublisher).publishNowQuietly(DigEmployeeChangeEventType.DIG_EMPLOYEE_DELETED,
            200L, "tool-man-service-hard-delete");
        verify(ssResourceArtifactService).removeArtifactsByResourceId(200L);
    }

    @Test
    void deleteResourceAndAllRel_fallsBackToStandardJsonDeletionWhenNoArtifactRecordExists() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        SsResourceRelDetailService ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        SsResourceArtifactService ssResourceArtifactService = mock(SsResourceArtifactService.class);
        ResourceArtifactStorageService resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        SsResExtToolKitService ssResExtToolKitService = mock(SsResExtToolKitService.class);
        ResourceDiscoveryRegistrationService resourceDiscoveryRegistrationService = mock(ResourceDiscoveryRegistrationService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", ssResourceArtifactService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "ssResExtToolKitService", ssResExtToolKitService);
        ReflectionTestUtils.setField(service, "resourceDiscoveryRegistrationService", resourceDiscoveryRegistrationService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");

        SsResource resource = new SsResource();
        resource.setResourceId(300L);
        resource.setResourceBizType(ResourceBizType.TOOLKIT.getCode());
        resource.setOwnerType("enterprise");
        resource.setResourceCode("toolkit_300");
        when(ssResourceService.findById(300L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(ssResourceArtifactService.listActiveArtifactsByResourceId(300L)).thenReturn(List.of());

        service.deleteResourceAndAllRel(300L);

        verify(resourceArtifactStorageService).deleteResourceJsonByBizType(ResourceBizType.TOOLKIT.getCode(), 300L);
        verify(resourceArtifactStorageService, never()).deleteWithinResourceRoot(any());
        verify(privilegeGrantService).removeAllByGrantObj(ResourceBizType.TOOLKIT.getCode(), 300L);
        verify(ssResExtToolKitService).removeById(300L);
    }

    @Test
    void deleteResourceAndAllRel_byResourceCode_resolvesResourceThenDeletes() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        PrivilegeGrantService privilegeGrantService = mock(PrivilegeGrantService.class);
        SsResourceRelDetailService ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        SsResourceArtifactService ssResourceArtifactService = mock(SsResourceArtifactService.class);
        ResourceArtifactStorageService resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        SsResExtToolKitService ssResExtToolKitService = mock(SsResExtToolKitService.class);
        ResourceDiscoveryRegistrationService resourceDiscoveryRegistrationService = mock(ResourceDiscoveryRegistrationService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "privilegeGrantService", privilegeGrantService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", ssResourceArtifactService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "ssResExtToolKitService", ssResExtToolKitService);
        ReflectionTestUtils.setField(service, "resourceDiscoveryRegistrationService", resourceDiscoveryRegistrationService);
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");
        prepareI18nUtil();

        SsResource resource = new SsResource();
        resource.setResourceId(700L);
        resource.setResourceBizType(ResourceBizType.TOOLKIT.getCode());
        resource.setOwnerType("enterprise");
        resource.setResourceCode("toolkit_by_code");
        when(ssResourceService.getResourceListByCode(List.of("toolkit_by_code"))).thenReturn(List.of(resource));
        when(ssResourceService.findById(700L)).thenReturn(resource);
        when(authApplicationService.hasResourceManagePermission(resource)).thenReturn(true);
        when(ssResourceArtifactService.listActiveArtifactsByResourceId(700L)).thenReturn(List.of());

        service.deleteResourceAndAllRel("toolkit_by_code");

        verify(ssResourceService).removeById(700L);
        verify(privilegeGrantService).removeAllByGrantObj(ResourceBizType.TOOLKIT.getCode(), 700L);
    }

    @Test
    void replaceImportedBundleArtifacts_registersStandardJsonZipAndDirectory() {
        ToolManService service = new ToolManService();
        SsResourceArtifactService ssResourceArtifactService = mock(SsResourceArtifactService.class);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", ssResourceArtifactService);

        when(ssResourceArtifactService.buildArtifact(any(), any(), any())).thenAnswer(invocation -> {
            SsResourceArtifact artifact = new SsResourceArtifact();
            artifact.setArtifactType(invocation.getArgument(0));
            artifact.setArtifactPath(invocation.getArgument(1));
            artifact.setRemark(invocation.getArgument(2));
            return artifact;
        });

        ReflectionTestUtils.invokeMethod(service, "replaceImportedBundleArtifacts", List.of(101L),
            ResourceBizType.OBJECT.getCode(), "object/OBJECT_101", "demo.zip");

        @SuppressWarnings("unchecked")
        var captor = org.mockito.ArgumentCaptor.forClass(List.class);
        verify(ssResourceArtifactService).replaceArtifacts(eq(101L), eq(ResourceBizType.OBJECT.getCode()), eq("minio"),
            captor.capture());
        List<SsResourceArtifact> artifacts = captor.getValue();
        assertThat(artifacts).extracting(SsResourceArtifact::getArtifactType)
            .containsExactly(ResourceArtifactTypeEnum.STANDARD_JSON.name(),
                ResourceArtifactTypeEnum.IMPORT_BUNDLE_DIR.name(),
                ResourceArtifactTypeEnum.IMPORT_ZIP.name());
        assertThat(artifacts).extracting(SsResourceArtifact::getArtifactPath)
            .containsExactly("object/OBJECT_101.json", "object/OBJECT_101", "object/OBJECT_101/demo.zip");
    }

    @Test
    void deleteManagedResource_byCodeAndOwnerType_deletesMatchedOwnerResourceOnly() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        ResourceArtifactStorageService resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        SsResExtToolKitService ssResExtToolKitService = mock(SsResExtToolKitService.class);
        SsResourceRelDetailService ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        ResourceDiscoveryRegistrationService resourceDiscoveryRegistrationService = mock(ResourceDiscoveryRegistrationService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "ssResExtToolKitService", ssResExtToolKitService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "resourceDiscoveryRegistrationService", resourceDiscoveryRegistrationService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
        prepareI18nUtil();

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(100L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        SsResource personalResource = new SsResource();
        personalResource.setResourceId(501L);
        personalResource.setResourceCode("demo_tool");
        personalResource.setOwnerType("personal");

        SsResource enterpriseResource = new SsResource();
        enterpriseResource.setResourceId(502L);
        enterpriseResource.setResourceCode("demo_tool");
        enterpriseResource.setOwnerType("enterprise");
        enterpriseResource.setResourceBizType(ResourceBizType.TOOLKIT.getCode());

        when(ssResourceService.getResourceListByCode(List.of("demo_tool"))).thenReturn(List.of(personalResource,
            enterpriseResource));
        when(ssResourceService.findById(502L)).thenReturn(enterpriseResource);
        when(authApplicationService.hasResourceManagePermission(enterpriseResource)).thenReturn(true);
        when(ssResourceRelDetailService.list(org.mockito.ArgumentMatchers.any(
            com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of());
        when(ssResExtToolKitService.findById(502L)).thenReturn(null);

        service.deleteManagedResource("demo_tool", "enterprise");

        verify(ssResourceService).findById(502L);
        verify(ssResourceService).updateResourceEntity(enterpriseResource);
        assertThat(enterpriseResource.getResourceStatus()).isNotNull();
    }

    @Test
    void deleteManagedResource_skillRejectsWhenReferencedByDigitalEmployee() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        SsResExtSkillService ssResExtSkillService = mock(SsResExtSkillService.class);
        SsResourceRelDetailService ssResourceRelDetailService = mock(SsResourceRelDetailService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "ssResExtSkillService", ssResExtSkillService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
        prepareI18nUtil();

        SsResource skillResource = new SsResource();
        skillResource.setResourceId(801L);
        skillResource.setResourceName("demo-skill");
        skillResource.setResourceCode("demo-skill");
        skillResource.setResourceBizType(ResourceBizType.SKILL.getCode());
        skillResource.setOwnerType("enterprise");

        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(901L);
        digitalEmployee.setResourceName("默认数字员工");
        digitalEmployee.setResourceBizType(ResourceBizType.DIG_EMPLOYEE.getCode());
        digitalEmployee.setResourceStatus(2);

        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceId(901L);
        relation.setRelResourceId(801L);

        when(ssResourceService.findById(801L)).thenReturn(skillResource);
        when(authApplicationService.hasResourceManagePermission(skillResource)).thenReturn(true);
        when(ssResExtSkillService.findById(801L)).thenReturn(null);
        when(ssResourceRelDetailService.list(org.mockito.ArgumentMatchers.any(
            com.baomidou.mybatisplus.core.conditions.Wrapper.class))).thenReturn(List.of(relation));
        when(ssResourceService.findByIdList(List.of(901L))).thenReturn(List.of(digitalEmployee));

        assertThatThrownBy(() -> service.deleteManagedResource(801L))
            .isInstanceOf(RuntimeException.class)
            .hasMessageContaining("tool.resource.delete.digemployee.relation.exists");

        verify(ssResourceService, never()).removeById(anyLong());
        verify(ssResourceRelDetailService, never()).removeAllByResourceIdOrRelResourceId(anyLong());
    }

    @Test
    void deleteManagedResource_rejectsInnerSkillEvenWithManagePermission() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        SsResExtSkillService ssResExtSkillService = mock(SsResExtSkillService.class);

        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "ssResExtSkillService", ssResExtSkillService);
        ReflectionTestUtils.setField(service, "datasetSystem", "");
        prepareI18nUtil();

        SsResource skillResource = new SsResource();
        skillResource.setResourceId(802L);
        skillResource.setResourceName("inner-skill");
        skillResource.setResourceCode("inner-skill");
        skillResource.setResourceBizType(ResourceBizType.SKILL.getCode());
        skillResource.setOwnerType("enterprise");

        SsResExtSkill extSkill = new SsResExtSkill();
        extSkill.setResourceId(802L);
        extSkill.setSkillType(SsResExtSkillService.INNER_SKILL_TYPE);

        when(ssResourceService.findById(802L)).thenReturn(skillResource);
        when(authApplicationService.hasResourceManagePermission(skillResource)).thenReturn(true);
        when(ssResExtSkillService.findById(802L)).thenReturn(extSkill);

        assertThatThrownBy(() -> service.deleteManagedResource(802L))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("byclaw.skill.inner.readonly");

        verify(ssResourceService, never()).removeById(anyLong());
    }

    @Test
    void deleteManagedResource_byCodeAndOwnerType_rejectsDuplicateMatchesUnderSameOwner() {
        ToolManService service = new ToolManService();
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        prepareI18nUtil();

        SsResource first = new SsResource();
        first.setResourceId(601L);
        first.setResourceCode("dup_tool");
        first.setOwnerType("enterprise");

        SsResource second = new SsResource();
        second.setResourceId(602L);
        second.setResourceCode("dup_tool");
        second.setOwnerType("enterprise");

        when(ssResourceService.getResourceListByCode(List.of("dup_tool"))).thenReturn(List.of(first, second));

        assertThatThrownBy(() -> service.deleteManagedResource("dup_tool", "enterprise"))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("tool.resource.code.duplicate.too.many");
    }

    private void prepareRedisUtil() {
        RedisUtil redisUtil = new RedisUtil();
        ReflectionTestUtils.setField(redisUtil, "stringRedisTemplate", mock(StringRedisTemplate.class));
        ReflectionTestUtils.setField(RedisUtil.class, "instance", redisUtil);
    }

    private void prepareI18nUtil() {
        MessageSource messageSource = mock(MessageSource.class);
        when(messageSource.getMessage(any(), any(), any(Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class, "messageSource", messageSource);
    }
}
