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
    EmployeePublicationResources service;
    DigitalEmployeeDTO dto;
    SsResource resource;
    @BeforeEach void setup() {
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        when(enterprise.getEnterpriseId()).thenReturn(1L);
        when(organizations.getTopOrgList()).thenReturn(List.of(1L));
        when(sequence.nextVal()).thenReturn(99L);
        service = new EmployeePublicationResources(resources, mock(SsResourceMapper.class), skills, storage,
            mock(SsResourceArtifactService.class), mock(ByClawSkillResourceApplicationService.class), auth, grants,
            organizations, enterprise, mock(DigitalEmployeePublicationMapper.class), sequence, mock(ByaiSystemConfigService.class));
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
    @ParameterizedTest @ValueSource(strings = {"TOOL", "MCP", "KG_DOC", "KG_DB"})
    void privateToolsAndKnowledgeBlockPublication(String type) {
        resource.setResourceBizType(type);
        var result = service.capture(dto, 7L, 1L, 100L);
        assertThat(result.getFirst().getAction()).isEqualTo("BLOCKED");
        assertThatThrownBy(() -> service.validate(result, 7L, 1L)).hasMessageContaining("先完成官方化");
    }
    @Test void enterpriseResourceRequiresFullAudienceAndNoBlacklist() {
        resource.setOwnerType("enterprise"); resource.setResourceBizType("KG_DOC");
        PrivilegeGrant red = new PrivilegeGrant(); red.setGrantToType("RED"); red.setGrantToObjType("ORG"); red.setGrantToObjId(1L);
        when(grants.selectList(any())).thenReturn(List.of(red));
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getAction()).isEqualTo("REUSE");
        PrivilegeGrant black = new PrivilegeGrant(); black.setGrantToType("BLACK");
        when(grants.selectList(any())).thenReturn(List.of(red, black));
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getError()).contains("黑名单");
        red.setExpDate(new Date(0)); when(grants.selectList(any())).thenReturn(List.of(red));
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getError()).contains("全员开放");
    }
    @Test void crossTenantDependencyBlocked() {
        resource.setComAcctId(2L);
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getAction()).isEqualTo("BLOCKED");
    }
    @Test void permissionRevocationAfterCaptureBlocksApproval() {
        resource.setOwnerType("enterprise");
        var dependency = new EmployeePublicationResources.Dependency(); dependency.setResource(resource); dependency.setAction("REUSE");
        when(auth.hasResourceUsePermission(resource, 7L)).thenReturn(false);
        assertThatThrownBy(() -> service.validate(List.of(dependency), 7L, 1L)).hasMessageContaining("已无关联资源使用权限");
    }
    @Test void snapshotsRejectPathsOutsideManagedStorage() {
        SsResExtSkill skill = new SsResExtSkill(); skill.setSkillType("hub"); skill.setSkillUrl("../../secrets.zip");
        when(skills.findById(20L)).thenReturn(skill);
        assertThat(service.capture(dto, 7L, 1L, 100L).getFirst().getAction()).isEqualTo("BLOCKED");
        verifyNoInteractions(storage);
    }
}
