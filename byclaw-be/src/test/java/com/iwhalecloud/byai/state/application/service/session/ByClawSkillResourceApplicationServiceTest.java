package com.iwhalecloud.byai.state.application.service.session;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceArtifactTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.io.ByteArrayOutputStream;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.MessageSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Locale;

class ByClawSkillResourceApplicationServiceTest {

    private SsResourceService ssResourceService;
    private SsResExtSkillService ssResExtSkillService;
    private SsResourceRelDetailService ssResourceRelDetailService;
    private SsResourceArtifactService ssResourceArtifactService;
    private ResourceArtifactStorageService resourceArtifactStorageService;
    private SequenceService sequenceService;
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;
    private AuthApplicationService authApplicationService;
    private ByClawSkillResourceApplicationService service;

    @BeforeEach
    void setUp() {
        ssResourceService = mock(SsResourceService.class);
        ssResExtSkillService = mock(SsResExtSkillService.class);
        ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        ssResourceArtifactService = mock(SsResourceArtifactService.class);
        resourceArtifactStorageService = mock(ResourceArtifactStorageService.class);
        sequenceService = mock(SequenceService.class);
        digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);
        authApplicationService = mock(AuthApplicationService.class);

        service = new ByClawSkillResourceApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResExtSkillService", ssResExtSkillService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", ssResourceArtifactService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", resourceArtifactStorageService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "digitalEmployeeApplicationService", digitalEmployeeApplicationService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        prepareI18nUtil();

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10001L);
        loginInfo.setUserCode("user001");
        loginInfo.setEnterpriseId(1L);
        loginInfo.setDefaultDigEmployeeId(9001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void registerChatUploadedSkills_createsResourceExtAndRelation() {
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");

        when(ssResourceService.getResourceListByCode(List.of("demo-skill"))).thenReturn(List.of());
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7001L);
            return resource;
        });
        when(ssResExtSkillService.findById(7001L)).thenReturn(null);
        when(ssResourceRelDetailService.find(9001L, 7001L)).thenReturn(List.of());
        when(sequenceService.nextVal()).thenReturn(8001L);
        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceManagePermission(digitalEmployee)).thenReturn(true);

        service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile), List.of(uploadedSkill));

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        SsResource resource = resourceCaptor.getValue();
        assertThat(resource.getResourceBizType()).isEqualTo("SKILL");
        assertThat(resource.getResourceCode()).isEqualTo("demo-skill");
        assertThat(resource.getOwnerType()).isEqualTo("personal");
        assertThat(resource.getImplType()).isEqualTo("SKILL");
        assertThat(resource.getWorkerAgentType()).isEqualTo("NONE");

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        SsResExtSkill ext = extCaptor.getValue();
        assertThat(ext.getResourceId()).isEqualTo(7001L);
        assertThat(ext.getSourceType()).isEqualTo("CHAT_UPLOAD");
        assertThat(ext.getSkillType()).isEqualTo("hub");
        assertThat(ext.getSkillUrl()).isEqualTo("/byclaw/resource/skill/user001-hub/demo-skill.zip");
        assertThat(ext.getTargetContent()).contains("\"resourceId\":7001", "\"sourceType\":\"CHAT_UPLOAD\"",
            "\"skillUrl\":\"/byaiService/tool/downloadSkillZip?skillId=7001\"");

        ArgumentCaptor<SsResourceRelDetail> relCaptor = ArgumentCaptor.forClass(SsResourceRelDetail.class);
        verify(ssResourceRelDetailService).save(relCaptor.capture());
        assertThat(relCaptor.getValue().getResourceId()).isEqualTo(9001L);
        assertThat(relCaptor.getValue().getRelResourceId()).isEqualTo(7001L);

        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill/user001-hub"),
            eq("demo-skill.zip"), eq("application/zip"));
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
            eq("SKILL_7001.json"), eq("application/json"));
        verify(ssResourceArtifactService).upsertArtifact(eq(7001L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.STANDARD_JSON.name()), eq("minio"), eq("skill/SKILL_7001.json"),
            eq("chat-upload-skill-json"));
        verify(digitalEmployeeApplicationService).synOpenClawWorkSpace(9001L);
    }

    @Test
    void registerChatUploadedSkills_rejectsWhenNoManagePermission() {
        // 仅有使用权限（别人授权的个人助理）安装技能时，应直接拒绝，而不是“提示成功但不生效”。
        MockMultipartFile uploadFile = new MockMultipartFile("files", "demo-skill.zip", "application/zip",
            skillZipBytes("demo-skill"));
        ByClawSkillDto uploadedSkill = new ByClawSkillDto("demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill",
            "/.openclaw/workspace-baiying-agent-9001/skills/demo-skill/SKILL.md");

        SsResource digitalEmployee = new SsResource();
        digitalEmployee.setResourceId(9001L);
        when(ssResourceService.findById(9001L)).thenReturn(digitalEmployee);
        when(authApplicationService.hasResourceManagePermission(digitalEmployee)).thenReturn(false);

        assertThatThrownBy(() -> service.registerChatUploadedSkills("user001", 9001L, List.of(uploadFile),
            List.of(uploadedSkill))).isInstanceOf(IllegalArgumentException.class);

        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(digitalEmployeeApplicationService, never()).synOpenClawWorkSpace(anyLong());
    }

    @Test
    void importSkillZips_enterpriseSkill_syncsPackageToOrgHubAndJsonToSkillRoot() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of());
        when(ssResourceService.saveResource(any(SsResource.class))).thenAnswer(invocation -> {
            SsResource resource = invocation.getArgument(0);
            resource.setResourceId(7101L);
            return resource;
        });
        when(ssResExtSkillService.findById(7101L)).thenReturn(null);

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {uploadFile}, 10L,
            "enterprise");

        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getCreatedCount()).isEqualTo(1);

        ArgumentCaptor<SsResource> resourceCaptor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceService).saveResource(resourceCaptor.capture());
        assertThat(resourceCaptor.getValue().getOwnerType()).isEqualTo("enterprise");

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getValue().getSourceType()).isEqualTo("SKILL_MANAGE_IMPORT");
        assertThat(extCaptor.getValue().getSkillUrl()).isEqualTo("/byclaw/resource/skill/org-hub/enterprise-skill.zip");

        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill/org-hub"),
            eq("enterprise-skill.zip"), eq("application/zip"));
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
            eq("SKILL_7101.json"), eq("application/json"));
        verify(ssResourceArtifactService).upsertArtifact(eq(7101L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.STANDARD_JSON.name()), eq("minio"), eq("skill/SKILL_7101.json"),
            eq("chat-upload-skill-json"));
    }

    @Test
    void importSkillZips_duplicateSkillCodeOverwritesExistingSkill() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));

        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7102L);
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("Old Skill");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");

        SsResExtSkill existingExt = new SsResExtSkill();
        existingExt.setResourceId(7102L);
        existingExt.setVersion("v0.1");

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of(existingResource));
        when(ssResourceService.updateResourceEntity(any(SsResource.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(ssResExtSkillService.findById(7102L)).thenReturn(existingExt);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");

        var result = service.importSkillZips(new org.springframework.web.multipart.MultipartFile[] {uploadFile}, 10L,
            "enterprise");

        assertThat(result.getSuccess()).isEqualTo(1);
        assertThat(result.getCreatedCount()).isZero();
        assertThat(result.getUpdatedCount()).isEqualTo(1);
        assertThat(result.getUpdatedItems()).hasSize(1);
        assertThat(result.getUpdatedItems().get(0).getMessage()).contains("覆盖更新成功");
        verify(ssResourceService).updateResourceEntity(existingResource);
        verify(ssResourceService, never()).saveResource(any(SsResource.class));

        ArgumentCaptor<SsResExtSkill> extCaptor = ArgumentCaptor.forClass(SsResExtSkill.class);
        verify(ssResExtSkillService).saveOrUpdate(extCaptor.capture());
        assertThat(extCaptor.getValue().getVersion()).isEqualTo("v0.2");
        assertThat(extCaptor.getValue().getSkillUrl()).isEqualTo("/byclaw/resource/skill/org-hub/enterprise-skill.zip");
    }

    @Test
    void previewSkillZipImportConflicts_returnsExistingSkillWithoutPersisting() {
        MockMultipartFile uploadFile = new MockMultipartFile("file", "enterprise-skill.zip", "application/zip",
            skillZipBytes("enterprise-skill"));

        SsResource existingResource = new SsResource();
        existingResource.setResourceId(7103L);
        existingResource.setResourceCode("enterprise-skill");
        existingResource.setResourceName("Existing Skill");
        existingResource.setResourceDesc("old desc");
        existingResource.setResourceBizType("SKILL");
        existingResource.setOwnerType("enterprise");

        when(ssResourceService.getResourceListByCode(List.of("enterprise-skill"))).thenReturn(List.of(existingResource));

        var result = service.previewSkillZipImportConflicts(
            new org.springframework.web.multipart.MultipartFile[] {uploadFile}, "enterprise");

        assertThat(result.getUpdatedCount()).isEqualTo(1);
        assertThat(result.getUpdatedItems()).hasSize(1);
        assertThat(result.getUpdatedItems().get(0).getResourceId()).isEqualTo("7103");
        assertThat(result.getUpdatedItems().get(0).getMessage()).isEqualTo("确认覆盖");
        verify(ssResourceService, never()).saveResource(any(SsResource.class));
        verify(ssResourceService, never()).updateResourceEntity(any(SsResource.class));
        verify(ssResExtSkillService, never()).saveOrUpdate(any(SsResExtSkill.class));
    }

    @Test
    void inspectSkillPackage_acceptsKaoqingStyleZipWithMultipleSubdirectorySkillDocs() {
        // Issue #155 续修核心场景：kaoqing 类复合包（根级 SKILL.md + 3 个顶级子目录各自带 SKILL.md +
        // 子目录里的 flow.yaml / fingers.json / page.yaml）。旧 findSkillDoc 会因
        // "全包 SKILL.md 数量 == 4 != 1" 抛 byclaw.skill.zip.missing.doc；v2 应被接受，
        // 且 metadata.skillCode 由 zip 文件名兜底为 "kaoqing"。
        MockMultipartFile uploadFile = new MockMultipartFile("files", "kaoqing.zip", "application/zip",
            kaoqingStyleSkillZipBytes());

        ByClawSkillResourceApplicationService.SkillPackageMetadata metadata = service.inspectSkillPackage(uploadFile);

        assertThat(metadata).isNotNull();
        assertThat(metadata.skillCode()).isEqualTo("kaoqing");
        assertThat(metadata.skillName()).isEqualTo("kaoqing");
        assertThat(metadata.originalFilename()).isEqualTo("kaoqing.zip");
        assertThat(metadata.size()).isPositive();
        assertThat(metadata.skillDesc()).isNotBlank();
    }

    @Test
    void inspectSkillPackage_rejectsZipWithoutRootLevelSkillDoc() {
        // v2 收紧点：根级无 SKILL.md、仅子目录有 → 必须抛 IllegalArgumentException(byclaw.skill.zip.missing.doc)，
        // 严禁"找一个子目录 SKILL.md 凑数"回退到旧规则。本测试套件的 I18n mock 把 i18n key 原样作为 message 返回，
        // 所以此处仅断言异常类型，与同文件其它"拒绝路径"测试风格一致。
        MockMultipartFile uploadFile = new MockMultipartFile("files", "skill.zip", "application/zip",
            subdirOnlySkillZipBytes());

        assertThatThrownBy(() -> service.inspectSkillPackage(uploadFile)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refreshSkillBasicInfo_incrementsVersionAndRefreshesTargetContent() {
        SsResource resource = new SsResource();
        resource.setResourceId(7201L);
        resource.setResourceCode("demo-skill");
        resource.setResourceName("Demo Skill New");
        resource.setResourceDesc("new desc");
        resource.setResourceBizType("SKILL");
        resource.setResourceType("ATOM");
        resource.setOwnerType("personal");
        resource.setResourceVersionId("1.0");
        resource.setHostType("hosted");

        SsResExtSkill ext = new SsResExtSkill();
        ext.setResourceId(7201L);
        ext.setSkillType("hub");
        ext.setSourceType("SKILL_MANAGE_IMPORT");
        ext.setVersion("v0.1");
        ext.setSkillUrl("resource/skill/user001-hub/demo-skill.zip");
        ext.setSkillPackageFormat("zip");
        ext.setSkillOriginalFilename("demo-skill.zip");
        ext.setTargetContent("{\"skillPath\":\"/skills/demo-skill\"}");

        when(ssResExtSkillService.findById(7201L)).thenReturn(ext);
        when(ssResExtSkillService.nextVersion("v0.1")).thenReturn("v0.2");

        String targetContent = service.refreshSkillBasicInfo(resource);

        assertThat(targetContent).contains("\"resourceName\":\"Demo Skill New\"", "\"version\":\"v0.2\"",
            "\"skillUrl\":\"/byaiService/tool/downloadSkillZip?skillId=7201\"");
        verify(ssResExtSkillService).saveOrUpdate(ext);
        verify(resourceArtifactStorageService).uploadToSubdirectory(any(byte[].class), eq("skill"),
            eq("SKILL_7201.json"), eq("application/json"));
        verify(ssResourceArtifactService).upsertArtifact(eq(7201L), eq("SKILL"),
            eq(ResourceArtifactTypeEnum.STANDARD_JSON.name()), eq("minio"), eq("skill/SKILL_7201.json"),
            eq("chat-upload-skill-json"));
    }

    private byte[] skillZipBytes(String skillName) {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                // v2 契约（与 ByClawSkillUploadApplicationService.findUniqueSkillDoc / commit 5d456956 一致）：
                // 唯一合法的 SKILL.md 必须位于 ZIP 根级；子目录里的 SKILL.md 一律忽略、不参与校验。
                // 这里只写根级 SKILL.md；skillName 由 inspectSkillPackage 通过 stripZipExtension(filename) 兜底。
                zip.putNextEntry(new ZipEntry("SKILL.md"));
                zip.write(("## " + skillName + "\n用于测试的技能描述").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            return out.toByteArray();
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * 构造一个 kaoqing 风格的复合包：根级 SKILL.md + 多个顶级子目录各自带 SKILL.md + 各子目录下的
     * flow.yaml / fingers.json / page.yaml。Issue #155 续修的关键场景：旧 findSkillDoc 会因为
     * "全包 SKILL.md 数量 == 4 != 1" 抛 byclaw.skill.zip.missing.doc；v2 应被接受。
     */
    private byte[] kaoqingStyleSkillZipBytes() {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                zip.putNextEntry(new ZipEntry("SKILL.md"));
                zip.write(("## kaoqing\n考勤场景根技能").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
                String[] subs = {"add-class", "class-manage", "edit-kaoqin-group"};
                for (String sub : subs) {
                    zip.putNextEntry(new ZipEntry(sub + "/SKILL.md"));
                    zip.write(("## " + sub + "\n纳米子技能").getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    zip.closeEntry();
                    zip.putNextEntry(new ZipEntry(sub + "/flow.yaml"));
                    zip.write(("name: " + sub).getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    zip.closeEntry();
                    zip.putNextEntry(new ZipEntry(sub + "/fingers.json"));
                    zip.write("{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    zip.closeEntry();
                    zip.putNextEntry(new ZipEntry(sub + "/page.yaml"));
                    zip.write(("page: " + sub).getBytes(java.nio.charset.StandardCharsets.UTF_8));
                    zip.closeEntry();
                }
            }
            return out.toByteArray();
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * 构造一个只有子目录 SKILL.md、根级没有 SKILL.md 的 zip。v2 收紧点必须覆盖：应抛 missing.doc。
     */
    private byte[] subdirOnlySkillZipBytes() {
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(out)) {
                zip.putNextEntry(new ZipEntry("alpha/SKILL.md"));
                zip.write("## alpha".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
                zip.putNextEntry(new ZipEntry("alpha/flow.yaml"));
                zip.write("name: alpha".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
                zip.putNextEntry(new ZipEntry("beta/SKILL.md"));
                zip.write("## beta".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                zip.closeEntry();
            }
            return out.toByteArray();
        }
        catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private void prepareI18nUtil() {
        MessageSource messageSource = mock(MessageSource.class);
        when(messageSource.getMessage(any(), any(), any(Locale.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(messageSource.getMessage(eq("resource.import.success"), any(), any(Locale.class))).thenReturn("导入成功");
        when(messageSource.getMessage(eq("byclaw.skill.import.cover.updated"), any(), any(Locale.class)))
            .thenReturn("Skill 已覆盖更新成功");
        when(messageSource.getMessage(eq("byclaw.skill.import.cover.confirm.item"), any(), any(Locale.class)))
            .thenReturn("确认覆盖");
        ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class, "messageSource", messageSource);
    }
}
