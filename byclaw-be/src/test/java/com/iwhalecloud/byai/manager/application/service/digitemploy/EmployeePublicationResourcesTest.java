package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.sys.service.*;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.ObjectProvider;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EmployeePublicationResourcesTest {
    SsResourceService resources = mock(SsResourceService.class);
    SsResExtSkillService skills = mock(SsResExtSkillService.class);
    ResourceArtifactStorageService storage = mock(ResourceArtifactStorageService.class);
    AuthApplicationService auth = mock(AuthApplicationService.class);
    PrivilegeGrantMapper grants = mock(PrivilegeGrantMapper.class);
    EnterpriseInfoService enterprise = mock(EnterpriseInfoService.class);
    OrganizationService organizations = mock(OrganizationService.class);
    DigitalEmployeePublicationMapper publications = mock(DigitalEmployeePublicationMapper.class);
    ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    EmployeePublicationSkillBridge bridge = mock(EmployeePublicationSkillBridge.class);
    ObjectProvider<EmployeePublicationSkillBridge> provider = mock(ObjectProvider.class);
    EmployeePublicationResources service;
    DigitalEmployeeDTO dto;
    SsResource resource;

    @BeforeEach void setup() {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        when(enterprise.getEnterpriseId()).thenReturn(1L);
        when(organizations.getTopOrgList()).thenReturn(List.of(1L));
        when(provider.getIfAvailable()).thenReturn(bridge);
        when(bridge.check(any(), any(), any(), any())).thenReturn(new EmployeePublicationSkillBridge.CheckResult(true, List.of()));
        service = new EmployeePublicationResources(resources, skills, storage, auth, grants,
            organizations, enterprise, publications, config, provider);
        dto = new DigitalEmployeeDTO(); dto.setRelIds(List.of(20L)); dto.setRelTools(List.of()); dto.setRelResourceInfoList(List.of());
        resource = EmployeePublicationApplicationServiceTest.employee(20L, 7L);
        resource.setResourceBizType("SKILL"); resource.setResourceName("技能");
        when(resources.findById(20L)).thenReturn(resource);
        when(auth.hasResourceUsePermission(any(), eq(7L))).thenReturn(true);
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }
    void readableSkill() {
        SsResExtSkill skill = new SsResExtSkill(); skill.setResourceId(20L); skill.setSkillType("hub"); skill.setSkillUrl("skill/original.zip");
        when(skills.findById(20L)).thenReturn(skill);
        when(storage.readWithinResourceRoot(anyString())).thenAnswer(i -> new ByteArrayInputStream(new byte[]{1,2,3}));
    }
    @Test void personalSkillFreezesFileChecksAAndOnlyCallsBAfterApproval() {
        readableSkill();
        var captured = service.capture(dto, 7L, 1L, 100L);
        assertThat(captured.getFirst().getAction()).isEqualTo("COPY_SKILL");
        assertThat(captured.getFirst().getSkill().getSkillUrl()).startsWith("skill/official-publications/100/20/");
        verify(bridge, never()).publish(any(), any(), any(), any(), any());
        service.validate(captured, 7L, 1L);
        SsResource target = EmployeePublicationApplicationServiceTest.employee(99L, 7L);
        target.setOwnerType("enterprise"); target.setResourceBizType("SKILL");
        when(resources.findById(99L)).thenReturn(target);
        when(bridge.publish(any(), any(), any(), eq(90L), any())).thenReturn(99L);
        Map<Long,Long> mapping = service.materialize(captured, 1L, 90L);
        assertThat(mapping).containsEntry(20L, 99L);
        verify(bridge).publish(eq(resource), any(), eq(new byte[]{1,2,3}), eq(90L),
            eq(new EmployeePublicationSkillBridge.Context(1L, 7L, 100L)));
        service.applyPublishedResources(dto, captured, mapping);
        assertThat(dto.getRelIds()).containsExactly(99L);
        assertThat(resource.getOwnerType()).isEqualTo("personal");
    }
    @ParameterizedTest @ValueSource(strings = {"KG_DOC", "KG_DB", "KG_QA", "KG_CLOUD", "TOOL", "TOOLKIT", "MCP", "AGENT"})
    void privateResourceIsOmittedWithoutBlockingOrChangingSource(String type) {
        resource.setResourceBizType(type);
        for (String owner : List.of("personal", "personal_default")) {
            resource.setOwnerType(owner);
            var captured = service.capture(dto, 7L, 1L, 100L);
            service.validate(captured, 7L, 1L);
            assertThat(captured.getFirst().getAction()).isEqualTo("OMIT_RESOURCE");
            assertThat(captured.getFirst().getError()).isNull();
            assertThat(dto.getRelIds()).containsExactly(20L); // 草稿保留，执行副本才过滤。
            assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, null);
            assertThat(resource.getOwnerType()).isEqualTo(owner);
        }
        verifyNoInteractions(storage, bridge);
        verify(auth, never()).handleAuth(any());
    }
    @Test void failedADropsEntireSkillAndExplainsDependency() {
        readableSkill();
        when(bridge.check(any(), any(), any(), any())).thenReturn(new EmployeePublicationSkillBridge.CheckResult(false,
            List.of(new EmployeePublicationSkillBridge.Issue("30", "TOOL", "客户查询", "个人工具"))));
        var captured = service.capture(dto, 7L, 1L, 100L);
        service.validate(captured, 7L, 1L);
        assertThat(captured.getFirst().getWarning()).contains("客户查询", "个人工具");
        assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, null);
        verify(bridge, never()).publish(any(), any(), any(), any(), any());
    }
    @Test void enterprisePermissionRestrictionIsWarningAndExistingGrantIsNotExpanded() {
        resource.setOwnerType("enterprise"); resource.setResourceBizType("KG_DOC");
        var captured = service.capture(dto, 7L, 1L, 100L);
        assertThat(captured.getFirst().getAction()).isEqualTo("REFERENCE_RESOURCE");
        assertThat(captured.getFirst().getWarning()).contains("全员开放");
        assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, 20L);
        verify(auth, never()).handleAuth(any());
    }
    @Test void publicEnterpriseResourceRetainsFullAudienceDescription() {
        resource.setOwnerType("enterprise"); resource.setResourceBizType("KG_DOC");
        PrivilegeGrant grant = new PrivilegeGrant(); grant.setGrantToType("RED"); grant.setGrantToObjType("ORG"); grant.setGrantToObjId(1L);
        when(grants.selectList(any())).thenReturn(List.of(grant));
        var dependency = service.capture(dto, 7L, 1L, 100L).getFirst();
        assertThat(dependency.getWarning()).isNull();
        assertThat(EmployeePublicationResources.describe(dependency).scope()).isEqualTo("当前企业全员");
    }
    @Test void wildcardAndBuiltinRemainButUnknownAndPrivateToolCodesCannotLeakIntoRuntime() {
        resource.setResourceBizType("TOOL"); resource.setResourceCode("private-tool");
        dto.setRelTools(List.of("*", "browser", "unknown", "private-tool"));
        when(config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS")).thenReturn("[{\"toolCode\":\"browser\"}]");
        when(publications.resourcesByCode("private-tool", 1L)).thenReturn(List.of(resource));
        var info = new RelResourceInfo(); info.setRelId("20"); dto.setRelResourceInfoList(List.of(info));
        dto.setRelSkills(List.of());
        var captured = service.capture(dto, 7L, 1L, 100L);
        service.validate(captured, 7L, 1L);
        var mapping = service.materialize(captured, 1L, 90L);
        assertThat(dto.getRelTools()).contains("private-tool");
        service.applyPublishedResources(dto, captured, mapping);
        assertThat(dto.getRelTools()).containsExactly("*", "browser");
        assertThat(dto.getRelIds()).isEmpty(); assertThat(dto.getRelSkills()).isEmpty();
        assertThat(dto.getRelResourceInfoList()).isEmpty(); assertThat(dto.getSkills()).isEqualTo("[]");
    }
    @Test void enterpriseToolCodesBecomeOneResourceRelation() {
        resource.setResourceBizType("MCP"); resource.setOwnerType("enterprise"); resource.setResourceCode("custom");
        dto.setRelTools(List.of("custom"));
        when(publications.resourcesByCode("custom", 1L)).thenReturn(List.of(resource));
        var captured = service.capture(dto, 7L, 1L, 100L);
        assertThat(captured).hasSize(1);
        service.applyPublishedResources(dto, captured, service.materialize(captured, 1L, 90L));
        assertThat(dto.getRelIds()).containsExactly(20L); assertThat(dto.getRelTools()).containsExactly("custom");
    }
    @Test void missingCrossTenantAndOffShelfResourcesAreOmitted() {
        resource.setComAcctId(2L);
        var captured = service.capture(dto, 7L, 1L, 100L);
        assertThat(captured.getFirst().getResource()).isNull();
        assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, null);
        when(resources.findById(20L)).thenReturn(null);
        service.validate(captured, 7L, 1L);
        assertThat(captured.getFirst().getWarning()).contains("不存在");
        resource.setComAcctId(1L); resource.setResourceStatus(3); when(resources.findById(20L)).thenReturn(resource);
        service.validate(captured, 7L, 1L);
        assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, null);
    }
    @Test void lostSnapshotNeverFallsBackToPrivateSkill() {
        readableSkill(); var captured = service.capture(dto, 7L, 1L, 100L);
        when(storage.readWithinResourceRoot(anyString())).thenReturn(null);
        service.validate(captured, 7L, 1L);
        assertThat(captured.getFirst().getWarning()).contains("快照文件不存在");
        assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, null);
    }
    @Test void missingBridgeAndUnreadableSkillOnlyOmitTheSkill() {
        when(provider.getIfAvailable()).thenReturn(null);
        var captured = service.capture(dto, 7L, 1L, 100L);
        assertThat(captured.getFirst().getWarning()).contains("尚未接入");
        assertThat(service.materialize(captured, 1L, 90L)).containsEntry(20L, null);
    }
    @Test void invalidStoragePathDoesNotReadOutsideResourceRoot() {
        readableSkill(); skills.findById(20L).setSkillUrl("../../secrets.zip");
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getAction()).isEqualTo("OMIT_RESOURCE");
        verifyNoInteractions(storage);
    }
    @Test void failedBIsNotReportedAsSuccessfulPublication() {
        readableSkill(); var captured = service.capture(dto, 7L, 1L, 100L);
        when(bridge.publish(any(), any(), any(), any(), any())).thenThrow(new IllegalStateException("storage offline"));
        assertThatThrownBy(() -> service.materialize(captured, 1L, 90L)).hasMessageContaining("企业技能生成失败");
    }
    @Test void missingAudienceStillBlocksInfrastructureMisconfiguration() {
        when(organizations.getTopOrgList()).thenReturn(List.of());
        var captured = service.capture(dto, 7L, 1L, 100L);
        assertThat(captured).anySatisfy(d -> assertThat(d.getError()).contains("根组织"));
        assertThatThrownBy(() -> service.validate(captured, 7L, 1L)).hasMessageContaining("根组织");
    }
    @Test void legacyOmittedResourceDescriptionNeverClaimsTheReferenceIsRetained() {
        var dependency = new EmployeePublicationResources.Dependency();
        dependency.setAction("UNAVAILABLE_RESOURCE");
        dependency.setResourceType("SKILL");
        var description = EmployeePublicationResources.describe(dependency);
        assertThat(description.scope()).isEqualTo("不带入企业员工");
        assertThat(description.reason()).contains("无法随员工发布");
        assertThat(description.impact()).contains("不会出现", "原个人员工保持不变");
    }
}
