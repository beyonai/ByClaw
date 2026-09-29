package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.commons.codec.digest.DigestUtils;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EmployeePublicationSkillServiceTest {
    SsResourceService resources = mock(SsResourceService.class);
    SsResourceMapper mapper = mock(SsResourceMapper.class);
    SsResExtSkillService skills = mock(SsResExtSkillService.class);
    SsResourceRelDetailService relations = mock(SsResourceRelDetailService.class);
    ResourceArtifactStorageService storage = mock(ResourceArtifactStorageService.class);
    SsResourceArtifactService artifacts = mock(SsResourceArtifactService.class);
    ByClawSkillResourceApplicationService runtime = mock(ByClawSkillResourceApplicationService.class);
    SequenceService sequence = mock(SequenceService.class);
    EmployeePublicationSkillService service = new EmployeePublicationSkillService(resources, mapper, skills, relations, storage, artifacts, runtime, sequence);
    EmployeePublicationSkillBridge.Context context = new EmployeePublicationSkillBridge.Context(1L, 7L, 100L);
    SsResource source, employee;
    SsResExtSkill snapshot;

    @BeforeEach void setup() {
        EmployeePublicationApplicationServiceTest.login("adminvip", 8L, List.of());
        source = EmployeePublicationApplicationServiceTest.employee(20L, 7L);
        source.setResourceBizType("SKILL"); source.setResourceName("客户分析");
        employee = EmployeePublicationApplicationServiceTest.employee(90L, 7L);
        employee.setPublicationSourceId(10L); employee.setOwnerType("enterprise");
        when(resources.findById(90L)).thenReturn(employee);
        when(sequence.nextVal()).thenReturn(99L, 101L, 102L, 103L);
        when(runtime.refreshSkillBasicInfo(any())).thenReturn("{}");
        snapshot = new SsResExtSkill(); snapshot.setSkillUrl("skill/official-publications/100/20/frozen.zip");
        snapshot.setVersion("v0.1"); snapshot.setSkillType("hub");
    }
    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }
    static byte[] zip(Map<String,String> files) throws Exception {
        var bytes = new ByteArrayOutputStream();
        try (var output = new ZipOutputStream(bytes)) {
            for (var file : files.entrySet()) {
                output.putNextEntry(new ZipEntry(file.getKey()));
                output.write(file.getValue().getBytes(StandardCharsets.UTF_8)); output.closeEntry();
            }
        }
        return bytes.toByteArray();
    }
    byte[] skill(String manifest) throws Exception {
        return zip(Map.of("analysis/SKILL.md", "# analysis", "analysis/references/resourceMate.json", manifest));
    }
    @Test void emptyExplicitManifestPassesAndDoesNotWriteAnything() throws Exception {
        assertThat(service.check(source, snapshot, skill("{\"resources\":[]}"), context).copyAllowed()).isTrue();
        verifyNoInteractions(mapper, relations, storage, artifacts, runtime);
        assertThat(service.check(source, snapshot, zip(Map.of("SKILL.md","# root", "references/resourceMate.json","{\"resources\":[]}")), context).copyAllowed()).isTrue();
    }
    @ParameterizedTest @ValueSource(strings = {"", "analysis/"})
    void missingManifestIsTreatedAsNoDependencies(String root) throws Exception {
        var checked = service.check(source, snapshot, zip(Map.of(root + "SKILL.md", "# skill")), context);
        assertThat(checked.copyAllowed()).isTrue();
        assertThat(checked.issues()).isEmpty();
        verifyNoInteractions(resources, mapper, relations, storage, artifacts, runtime);
    }
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void approvedSkillWithMissingOrEmptyManifestIsPublished(boolean manifestPresent) throws Exception {
        byte[] bytes = manifestPresent ? skill("{\"resources\":[]}") : zip(Map.of("analysis/SKILL.md", "# skill"));
        snapshot.setSkillPackageHash(DigestUtils.sha256Hex(bytes));
        assertThat(service.publish(source, snapshot, bytes, 90L, context)).isEqualTo(99L);
        verify(storage).uploadToSubdirectory(eq(bytes), eq("skill/org-hub/1/100/20"),
            eq(snapshot.getSkillPackageHash() + ".zip"), eq("application/zip"));
        verify(mapper).insert(argThat((SsResource target) -> "enterprise".equals(target.getOwnerType())));
        verify(relations).save(argThat(relation -> relation.getResourceId().equals(90L)
            && relation.getRelResourceId().equals(99L)));
        verify(relations, never()).save(argThat(relation -> relation.getResourceId().equals(99L)));
        verify(runtime, never()).publishSkillToEnterprise(anyLong());
    }
    @ParameterizedTest @ValueSource(strings = {"personal", "personal_default"})
    void personalKnowledgeAndToolsReturnNamesAndReasons(String owner) throws Exception {
        SsResource tool = EmployeePublicationApplicationServiceTest.employee(2001L, 7L);
        tool.setResourceName("个人查询工具"); tool.setResourceBizType("MCP"); tool.setOwnerType(owner);
        SsResource knowledge = EmployeePublicationApplicationServiceTest.employee(3001L, 7L);
        knowledge.setResourceName("个人客户库"); knowledge.setResourceBizType("KG_DOC"); knowledge.setOwnerType(owner);
        when(resources.findById(2001L)).thenReturn(tool); when(resources.findById(3001L)).thenReturn(knowledge);
        var checked = service.check(source, snapshot, skill("{\"resources\":[{\"resourceId\":\"2001\",\"resourceType\":\"TOOL\"},{\"resourceId\":\"3001\",\"resourceType\":\"KNOWLEDGE_BASE\"}]}"), context);
        assertThat(checked.copyAllowed()).isFalse();
        assertThat(checked.issues()).extracting(EmployeePublicationSkillBridge.Issue::name).containsExactly("个人查询工具","个人客户库");
        assertThat(checked.issues()).allSatisfy(i -> assertThat(i.reason()).contains("个人资源"));
        verifyNoInteractions(storage, mapper);
    }
    @Test void enterpriseDependenciesPassButMissingCrossTenantMismatchAndDeletedDoNot() throws Exception {
        var dependency = EmployeePublicationApplicationServiceTest.employee(2001L, 7L);
        dependency.setOwnerType("enterprise"); dependency.setResourceBizType("TOOLKIT"); dependency.setResourceName("企业工具");
        when(resources.findById(2001L)).thenReturn(dependency);
        byte[] bytes = skill("{\"resources\":[{\"resourceId\":\"2001\",\"resourceType\":\"TOOL\"}]}");
        assertThat(service.check(source, snapshot, bytes, context).copyAllowed()).isTrue();
        dependency.setComAcctId(2L);
        var cross = service.check(source, snapshot, bytes, context);
        assertThat(cross.copyAllowed()).isFalse(); assertThat(cross.issues().getFirst().name()).isEqualTo("2001");
        dependency.setComAcctId(1L); dependency.setResourceBizType("KG_DOC");
        assertThat(service.check(source, snapshot, bytes, context).issues().getFirst().reason()).contains("类型");
        dependency.setResourceBizType("TOOLKIT"); dependency.setResourceStatus(-1);
        assertThat(service.check(source, snapshot, bytes, context).copyAllowed()).isFalse();
        when(resources.findById(2001L)).thenReturn(null);
        assertThat(service.check(source, snapshot, bytes, context).issues().getFirst().reason()).contains("不存在");
    }
    @ParameterizedTest @ValueSource(strings = {"", " ", "{}", "broken", "{\"resources\":null}", "{\"resources\":[{}]}", "{\"resources\":[{\"resourceId\":\"x\",\"resourceType\":\"TOOL\"}]}", "{\"resources\":[{\"resourceId\":\"1\",\"resourceType\":\"SKILL\"}]}"})
    void malformedManifestExcludesSkillInsteadOfAssumingNoDependencies(String json) throws Exception {
        var checked = service.check(source, snapshot, skill(json), context);
        assertThat(checked.copyAllowed()).isFalse();
        assertThat(checked.issues()).allSatisfy(issue -> assertThat(issue.reason()).isNotBlank());
        verifyNoInteractions(mapper, relations, storage, artifacts, runtime);
    }
    @Test void onlyManifestInsideTheSkillRootIsRead() throws Exception {
        var checked = service.check(source, snapshot, zip(Map.of("analysis/SKILL.md", "# skill",
            "other/references/resourceMate.json", "broken")), context);
        assertThat(checked.copyAllowed()).isTrue();
        assertThat(checked.issues()).isEmpty();
    }
    @Test void ambiguousRootAndTraversalAreStillRejected() throws Exception {
        assertThat(service.check(source, snapshot, zip(Map.of("a/SKILL.md","a","b/SKILL.md","b")), context).copyAllowed()).isFalse();
        assertThat(service.check(source, snapshot, zip(Map.of("../SKILL.md","a")), context).copyAllowed()).isFalse();
    }
    @Test void approvedSkillUploadsAnIndependentEnterprisePackageAndLinksBothDirectionsOfUse() throws Exception {
        var tool = EmployeePublicationApplicationServiceTest.employee(2001L, 7L); tool.setOwnerType("enterprise"); tool.setResourceBizType("TOOL");
        when(resources.findById(2001L)).thenReturn(tool);
        byte[] bytes = skill("{\"resources\":[{\"resourceId\":\"2001\",\"resourceType\":\"TOOL\"}]}");
        snapshot.setSkillPackageHash(DigestUtils.sha256Hex(bytes));
        assertThat(service.publish(source, snapshot, bytes, 90L, context)).isEqualTo(99L);
        verify(storage).uploadToSubdirectory(eq(bytes), eq("skill/org-hub/1/100/20"), eq(snapshot.getSkillPackageHash()+".zip"), eq("application/zip"));
        var target = ArgumentCaptor.forClass(SsResource.class); verify(mapper).insert(target.capture());
        assertThat(target.getValue().getOwnerType()).isEqualTo("enterprise");
        assertThat(target.getValue().getCreateBy()).isEqualTo(7L); // 署名保留作者，不变成审核管理员。
        assertThat(target.getValue().getResourceStatus()).isEqualTo(2);
        assertThat(target.getValue().getPublicationRequestId()).isEqualTo(100L);
        verify(relations).save(argThat(r -> r.getResourceId().equals(99L) && r.getRelResourceId().equals(2001L)));
        verify(relations).save(argThat(r -> r.getResourceId().equals(90L) && r.getRelResourceId().equals(99L)));
        verify(runtime, never()).publishSkillToEnterprise(anyLong());
        assertThat(snapshot.getSkillUrl()).contains("official-publications"); assertThat(source.getOwnerType()).isEqualTo("personal");
        var ext = ArgumentCaptor.forClass(SsResExtSkill.class); verify(skills).save(ext.capture());
        assertThat(ext.getValue().getSkillUrl()).startsWith("skill/org-hub/");
        when(mapper.selectOne(any())).thenReturn(target.getValue()); when(skills.findById(99L)).thenReturn(ext.getValue());
        when(relations.count(any())).thenReturn(1L);
        assertThat(service.publish(source, snapshot, bytes, 90L, context)).isEqualTo(99L);
        verify(storage, times(1)).uploadToSubdirectory(any(), anyString(), anyString(), anyString());
    }
    @Test void unauthorizedOperatorAndChangedSnapshotCannotWriteEnterpriseResources() throws Exception {
        byte[] bytes = skill("{\"resources\":[]}"); snapshot.setSkillPackageHash("changed");
        assertThatThrownBy(() -> service.publish(source, snapshot, bytes, 90L, context)).hasMessageContaining("文件已变化");
        EmployeePublicationApplicationServiceTest.login("author", 7L, List.of());
        assertThatThrownBy(() -> service.publish(source, snapshot, bytes, 90L, context)).hasMessageContaining("无权");
        verifyNoInteractions(storage, mapper);
    }
}
