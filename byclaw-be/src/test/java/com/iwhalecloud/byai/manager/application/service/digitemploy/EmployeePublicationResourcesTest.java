package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.sys.service.*;
import java.io.ByteArrayInputStream;
import java.util.Date;
import java.util.List;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
    SequenceService sequence = mock(SequenceService.class);
    DigitalEmployeePublicationMapper publications = mock(DigitalEmployeePublicationMapper.class);
    ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    SsResourceMapper resourceMapper = mock(SsResourceMapper.class);
    EmployeePublicationResources service;
    DigitalEmployeeDTO dto;
    SsResource resource;
    @BeforeEach void setup() {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        when(enterprise.getEnterpriseId()).thenReturn(1L);
        when(organizations.getTopOrgList()).thenReturn(List.of(1L));
        when(sequence.nextVal()).thenReturn(99L);
        service = new EmployeePublicationResources(resources, resourceMapper, skills, storage,
            mock(SsResourceArtifactService.class), mock(ByClawSkillResourceApplicationService.class), auth, grants,
            organizations, enterprise, publications, sequence, config);
        dto = new DigitalEmployeeDTO(); dto.setRelIds(List.of(20L));
        resource = EmployeePublicationApplicationServiceTest.employee(20L, 7L);
        resource.setResourceBizType("SKILL"); resource.setResourceName("技能");
        when(resources.findById(20L)).thenReturn(resource);
        when(auth.hasResourceUsePermission(resource, 7L)).thenReturn(true);
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }
    @Test void personalSkillGetsIndependentSnapshotFileAndId() throws Exception {
        SsResExtSkill skill = new SsResExtSkill(); skill.setResourceId(20L); skill.setSkillType("hub"); skill.setSkillUrl("skill/original.zip");
        when(skills.findById(20L)).thenReturn(skill);
        when(storage.readWithinResourceRoot("skill/original.zip")).thenReturn(new ByteArrayInputStream(new byte[]{1,2,3}));
        var result = service.capture(dto, 7L, 1L, 100L).getFirst();
        assertThat(result.getAction()).isEqualTo("COPY_SKILL"); assertThat(result.getTargetId()).isEqualTo(99L);
        assertThat(result.getSkill().getSkillUrl()).startsWith("skill/official-publications/100/20/");
        assertThat(skill.getSkillUrl()).isEqualTo("skill/original.zip");
        verify(storage).uploadToSubdirectory(any(byte[].class), eq("skill/official-publications/100/20"), anyString(), eq("application/zip"));
    }
    @ParameterizedTest @ValueSource(strings = {"KG_DOC", "KG_DB"})
    void privateKnowledgeOnlyWarnsAndPreservesReferences(String type) {
        resource.setResourceBizType(type);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getAction()).isEqualTo("REFERENCE_RESOURCE");
        assertThat(result.getFirst().getWarning()).contains("私有资源");
        assertThatCode(() -> service.validate(result, 7L, 1L)).doesNotThrowAnyException();
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
        var availability = EmployeePublicationResources.describe(result.getFirst());
        assertThat(availability.resourceType()).isEqualTo(type);
        assertThat(availability.scope()).isEqualTo("原有授权用户（私有资源）");
        assertThat(availability.impact()).contains("未获授权的其他用户无法使用");
    }
    @Test void enterpriseResourceRequiresFullAudienceAndNoBlacklist() {
        resource.setOwnerType("enterprise"); resource.setResourceBizType("KG_DOC");
        PrivilegeGrant red = new PrivilegeGrant(); red.setGrantToType("RED"); red.setGrantToObjType("ORG"); red.setGrantToObjId(1L);
        when(grants.selectList(any())).thenReturn(List.of(red));
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getAction()).isEqualTo("REFERENCE_RESOURCE");
        PrivilegeGrant black = new PrivilegeGrant(); black.setGrantToType("BLACK");
        when(grants.selectList(any())).thenReturn(List.of(red, black));
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getWarning()).contains("黑名单");
        red.setExpDate(new Date(0)); when(grants.selectList(any())).thenReturn(List.of(red));
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getWarning()).contains("全员开放");
    }
    @Test void crossTenantDependencyOnlyWarnsAndIsNeverCopied() {
        resource.setComAcctId(2L);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getAction()).isEqualTo("UNAVAILABLE_RESOURCE");
        assertThat(result.getFirst().getResource()).isNull();
        assertThat(result.getFirst().getWarning()).contains("不影响员工发布");
        service.validate(result, 7L, 1L);
        assertThat(service.materialize(result, 1L)).containsEntry(20L, null);
        verifyNoInteractions(resourceMapper, storage);
    }
    @Test void permissionRevocationAfterCaptureOnlyWarns() {
        resource.setOwnerType("enterprise");
        var dependency = new EmployeePublicationResources.Dependency(); dependency.setResource(resource); dependency.setAction("REUSE");
        when(auth.hasResourceUsePermission(resource, 7L)).thenReturn(false);
        assertThatCode(() -> service.validate(List.of(dependency), 7L, 1L)).doesNotThrowAnyException();
        assertThat(dependency.getWarning()).contains("无此资源的使用权限");
    }
    @Test void snapshotsRejectPathsOutsideManagedStorage() {
        SsResExtSkill skill = new SsResExtSkill(); skill.setSkillType("hub"); skill.setSkillUrl("../../secrets.zip");
        when(skills.findById(20L)).thenReturn(skill);
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getAction()).isEqualTo("REFERENCE_RESOURCE");
        verifyNoInteractions(storage);
    }

    @ParameterizedTest @ValueSource(strings = {"TOOL", "TOOLKIT", "MCP", "AGENT"})
    void privateToolsAreReferencedWithWarningsWithoutCopyingOrGranting(String type) {
        resource.setResourceBizType(type);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getAction()).isEqualTo("REFERENCE_TOOL");
        assertThat(result.getFirst().getError()).isNull();
        assertThat(result.getFirst().getWarning()).contains("私有资源");
        assertThatCode(() -> service.validate(result, 7L, 1L)).doesNotThrowAnyException();
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
        verifyNoInteractions(resourceMapper, skills, storage, grants);
        verify(auth, never()).handleAuth(any());
    }

    @Test void wildcardAndUnknownCodesRemainInSnapshotAndDoNotRequireResourceRows() {
        dto.setRelIds(List.of()); dto.setRelTools(List.of("*", "unknown", "browser"));
        when(config.getDcSystemConfigValueByCode("OPENCLAW_BUNDLED_TOOLS"))
            .thenReturn("[{\"toolCode\":\"browser\"}]");
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result).hasSize(3).allSatisfy(d -> assertThat(d.getError()).isNull());
        assertThat(result.get(0).getWarning()).isNull();
        assertThat(result.get(0).getAction()).isEqualTo("BUILTIN_TOOL");
        assertThat(EmployeePublicationResources.describe(result.get(0)).scope()).isEqualTo("当前企业全员");
        assertThat(result.get(1).getWarning()).contains("无法唯一识别");
        assertThat(result.get(2).getWarning()).isNull();
        assertThat(dto.getRelTools()).containsExactly("*", "unknown", "browser");
        assertThatCode(() -> service.validate(result, 7L, 1L)).doesNotThrowAnyException();
        assertThat(service.materialize(result, 1L)).isEmpty();
        verifyNoInteractions(resourceMapper, storage, grants);
    }

    @Test void customToolCodesResolveToOriginalResourceWithoutDuplicatingReferences() {
        resource.setResourceBizType("MCP"); dto.setRelTools(List.of("custom"));
        when(publications.resourcesByCode("custom", 1L)).thenReturn(List.of(resource));
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result).hasSize(1);
        assertThat(dto.getRelIds()).containsExactly(20L);
        assertThat(dto.getRelTools()).containsExactly("custom");
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
    }

    @Test void toolUnavailableAfterCaptureOnlyUpdatesWarning() {
        resource.setResourceBizType("TOOL"); resource.setOwnerType("enterprise");
        PrivilegeGrant red = new PrivilegeGrant(); red.setGrantToType("RED"); red.setGrantToObjType("ORG"); red.setGrantToObjId(1L);
        when(grants.selectList(any())).thenReturn(List.of(red));
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getWarning()).isNull();
        resource.setResourceStatus(3);
        service.validate(result, 7L, 1L);
        assertThat(result.getFirst().getWarning()).contains("下架");
        when(resources.findById(20L)).thenReturn(null);
        service.validate(result, 7L, 1L);
        assertThat(result.getFirst().getWarning()).contains("不存在");
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
    }

    @Test void toolPermissionAndAvailabilityCheckFailuresAreWarnings() {
        resource.setResourceBizType("TOOL");
        when(auth.hasResourceUsePermission(resource, 7L)).thenReturn(false);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getWarning()).contains("无此资源的使用权限");
        when(auth.hasResourceUsePermission(resource, 7L)).thenThrow(new IllegalStateException("permission service offline"));
        assertThatCode(() -> service.validate(result, 7L, 1L)).doesNotThrowAnyException();
        assertThat(result.getFirst().getWarning()).contains("暂时无法检查");
    }

    @Test void missingAudienceIsDraftBlockerButMalformedSkillOnlyWarns() {
        when(organizations.getTopOrgList()).thenReturn(List.of());
        dto.setRelIds(List.of()); dto.setRelTools(List.of("*"));
        dto.setRelSkills(List.of(java.util.Map.of("resourceId", "invalid")));
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result).anySatisfy(d -> assertThat(d.getError()).contains("根组织"));
        assertThat(result).anySatisfy(d -> assertThat(d.getWarning()).contains("标识无效"));
        assertThatThrownBy(() -> service.validate(result, 7L, 1L)).hasMessageContaining("根组织");
    }

    @Test void missingResourceIsPublishedWithOriginalIdAndWarning() {
        when(resources.findById(20L)).thenReturn(null);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getError()).isNull();
        assertThat(result.getFirst().getWarning()).contains("资源不存在");
        service.validate(result, 7L, 1L);
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
        verifyNoInteractions(resourceMapper, storage);
    }

    @Test void unreadablePersonalSkillFallsBackToReferenceWithoutBlockingPublication() {
        SsResExtSkill skill = new SsResExtSkill(); skill.setSkillType("hub"); skill.setSkillUrl("skill/missing.zip");
        when(skills.findById(20L)).thenReturn(skill);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getWarning()).contains("未生成独立技能副本", "技能文件不存在");
        service.validate(result, 7L, 1L);
        assertThat(result.getFirst().getWarning()).contains("技能文件不存在");
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
        verifyNoInteractions(resourceMapper);
    }

    @Test void snapshotDisappearingBeforeApprovalFallsBackToOriginalSkill() {
        SsResExtSkill skill = new SsResExtSkill(); skill.setSkillType("hub"); skill.setSkillUrl("skill/original.zip");
        when(skills.findById(20L)).thenReturn(skill);
        when(storage.readWithinResourceRoot("skill/original.zip"))
            .thenReturn(new ByteArrayInputStream(new byte[]{1, 2, 3}));
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getAction()).isEqualTo("COPY_SKILL");
        service.validate(result, 7L, 1L);
        assertThat(result.getFirst().getAction()).isEqualTo("REFERENCE_RESOURCE");
        assertThat(result.getFirst().getSkill()).isNull();
        assertThat(result.getFirst().getWarning()).contains("技能快照文件不存在");
        assertThat(EmployeePublicationResources.describe(result.getFirst()).impact()).contains("未生成独立技能副本", "保留原技能关联");
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
    }

    @Test void someoneElsesPrivateSkillCanBeReferencedButNeverCopiedOrGranted() {
        resource.setCreateBy(8L);
        var result = service.capture(dto, 7L, 1L, 100L);
        service.validate(result, 7L, 1L);
        assertThat(result.getFirst().getError()).isNull();
        assertThat(result.getFirst().getWarning()).contains("私有资源");
        assertThat(service.materialize(result, 1L)).containsEntry(20L, 20L);
        verifyNoInteractions(resourceMapper, skills, storage);
        verify(auth, never()).handleAuth(any());
    }
}
