package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.commons.compress.archivers.tar.TarArchiveEntry;
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream;
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link ByClawSkillUploadApplicationService} 的单元测试。
 *
 * SKILL.md 校验规则（v2：根级唯一）：
 * - 唯一合法的 SKILL.md 必须在 ZIP 根级（segments.length == 1）；
 * - 根级 SKILL.md 必须有且仅有一份，否则视为缺文档（byclaw.skill.zip.missing.doc）；
 * - 子目录里的 SKILL.md 一律忽略——不参与校验、不参与排序、不影响判定。
 */
@DisabledOnOs(OS.WINDOWS)
@ExtendWith(MockitoExtension.class)
class ByClawSkillUploadApplicationServiceTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    private static final String AGENT_PREFIX = "/.openclaw/workspace-baiying-agent-10000417/skills/";

    private static final String SUPER_PREFIX = "/.openclaw/workspace/skills/";

    @Mock
    private UserFS userFS;

    @Mock
    private ByClawSkillPathResolver skillPathResolver;

    private ByClawSkillUploadApplicationService service;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("byclaw.skill.zip.empty", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包不能为空");
        messageSource.addMessage("byclaw.skill.zip.read.failed", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包解析失败");
        messageSource.addMessage("byclaw.skill.zip.file.invalid", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包必须是 zip 格式");
        messageSource.addMessage("byclaw.skill.zip.size.exceeded", Locale.SIMPLIFIED_CHINESE, "超过最大允许大小");
        messageSource.addMessage("byclaw.skill.zip.missing.doc", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包必须有且仅有一个 SKILL.md");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        service = new ByClawSkillUploadApplicationService();
        ReflectionTestUtils.setField(service, "userFS", userFS);
        ReflectionTestUtils.setField(service, "skillPathResolver", skillPathResolver);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    // ============================== 改造用例（7 个） ==============================

    @Test
    void shouldClearOldSkillAndWriteAllEntries() {
        // 改造点：SKILL.md 提到根级，沿用清空旧目录 + 全量覆盖语义。
        MultipartFile zip = buildZip("fol-auto-biztravel.zip",
            "SKILL.md", "# root",
            "scripts/run.py", "print('hi')");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        verify(userFS).init();
        verify(userFS).delete(AGENT_PREFIX + "fol-auto-biztravel/");
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "fol-auto-biztravel/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "fol-auto-biztravel/scripts/run.py"));

        assertEquals("fol-auto-biztravel", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "fol-auto-biztravel", dto.getSkillPath());
        assertNotNull(dto.getSkillDocObjectKey());
        assertTrue(dto.getSkillDocObjectKey().endsWith("/SKILL.md"));
    }

    @Test
    void shouldAcceptSkillDocWithLowerCaseFilenameAndNormalizeIt() {
        // 改造点：根级 skill.md（小写）也被识别，写入时统一规范化为 SKILL.md。
        MultipartFile zip = buildZip("alpha.zip",
            "skill.md", "# alpha");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "alpha/SKILL.md"));
        assertEquals("alpha", dto.getSkillName());
    }

    @Test
    void shouldIgnoreNestedSkillDocsWhenRootSkillDocExists() {
        // 改造点：根级 SKILL.md 存在时，子目录 SKILL.md 一律忽略、不参与判定；写入仍按现有"全部 entry 写入"语义。
        MultipartFile zip = buildZip("zmp-leave-complex.zip",
            "SKILL.md", "# root",
            "create-leave-request/SKILL.md", "# nano",
            "create-leave-request/flow.yaml", "name: create");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertEquals("zmp-leave-complex", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "zmp-leave-complex/SKILL.md", dto.getSkillDocObjectKey());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "zmp-leave-complex/SKILL.md"));
        // 子目录 SKILL.md 不参与校验，但依现有落盘语义仍会被写入到 skill 根下。
        assertTrue(pathCaptor.getAllValues()
            .contains(AGENT_PREFIX + "zmp-leave-complex/create-leave-request/SKILL.md"));
    }

    @Test
    void shouldAcceptChineseSkillDirectoryFromGbkEncodedZip() {
        // 改造点：根级 SKILL.md 配合 GBK 编码中文 zip 文件名；skillName 从 zip 文件名兜底。
        MultipartFile zip = buildZip("铁算盘财务健康分析.zip", Charset.forName("GBK"),
            "SKILL.md", "# 铁算盘",
            "references/persona-guide.md", "guide");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("铁算盘财务健康分析", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "铁算盘财务健康分析", dto.getSkillPath());
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "铁算盘财务健康分析/SKILL.md"));
        assertTrue(pathCaptor.getAllValues()
            .contains(AGENT_PREFIX + "铁算盘财务健康分析/references/persona-guide.md"));
    }

    @Test
    void shouldRejectZipWithMultipleRootSkillDocs() {
        // 改造点：根级出现两份 SKILL.md → 拒绝（保留原有严格性，避免歧义）。
        MultipartFile zip = buildZip("skill.zip",
            "SKILL.md", "x",
            "skill.md", "y");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    void shouldUploadMultipleSkillZips() {
        // 改造点：每个 zip 都按根级 SKILL.md 校验。
        MultipartFile alpha = buildZip("alpha.zip", "SKILL.md", "# alpha");
        MultipartFile beta = buildZip("beta.zip", "SKILL.md", "# beta");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var result = service.uploadSkillZips(USER_CODE, RESOURCE_ID, Arrays.asList(alpha, beta));

        assertEquals(2, result.size());
        assertEquals("alpha", result.get(0).getSkillName());
        assertEquals("beta", result.get(1).getSkillName());
        verify(userFS).delete(AGENT_PREFIX + "alpha/");
        verify(userFS).delete(AGENT_PREFIX + "beta/");
    }

    @Test
    void shouldSilentlySkipPathTraversalEntry() {
        // 改造点：根级 SKILL.md + 路径穿越静默忽略。
        MultipartFile zip = buildZip("skill.zip",
            "SKILL.md", "ok",
            "scripts/../../etc/passwd", "hack");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("skill", dto.getSkillName());
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        // passwd 穿越 entry 被静默丢弃，不会出现在写入列表中
        assertTrue(pathCaptor.getAllValues().stream().noneMatch(p -> p.contains("passwd")));
    }

    @Test
    void shouldUploadToSuperAssistantWorkspaceWhenResourceIdIsNull() {
        // 改造点：根级 SKILL.md 走超级助手工作空间（resourceId 为 null）。
        MultipartFile zip = buildZip("assistant-core.zip",
            "SKILL.md", "# Skill",
            "scripts/run.py", "print('hi')");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(SUPER_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        verify(userFS).delete(SUPER_PREFIX + "assistant-core/");
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(SUPER_PREFIX + "assistant-core/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(SUPER_PREFIX + "assistant-core/scripts/run.py"));
        assertEquals(SUPER_PREFIX + "assistant-core", dto.getSkillPath());
    }

    // ============================== 保留用例（4 个，不变） ==============================

    @Test
    void shouldRejectZipMissingSkillDoc() {
        // 完全无 SKILL.md → 拒绝（保留原行为）。
        MultipartFile zip = buildZip("skill.zip", "README.md", "no doc");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    void shouldFallbackSkillNameToZipNameWhenSkillDocAtRoot() {
        // 根级 SKILL.md + 文件在子目录，skillName 从 zip 文件名兜底。
        MultipartFile zip = buildZip("fol-auto-biztravel.zip",
            "SKILL.md", "# root",
            "scripts/run.py", "print('hi')");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("fol-auto-biztravel", dto.getSkillName());
        verify(userFS).delete(AGENT_PREFIX + "fol-auto-biztravel/");
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "fol-auto-biztravel/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "fol-auto-biztravel/scripts/run.py"));
    }

    @Test
    void shouldRejectTarGzSkillArchive() {
        // tar.gz 格式校验在 parse 之前发生，无论 SKILL.md 在哪里都直接拒绝。
        MultipartFile tarGz = buildTarGz("content-factory.tar.gz",
            "content-factory/SKILL.md", "# content factory",
            "content-factory/scripts/main.py", "print('hi')");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, tarGz));
        assertTrue(ex.getMessage().contains("zip"));
    }

    @Test
    void shouldRejectEmptyUserCode() {
        MultipartFile zip = buildZip("skill.zip", "SKILL.md", "x");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip("  ", RESOURCE_ID, zip));
        assertEquals("userCode不能为空", ex.getMessage());
    }

    // ============================== 新增用例（5 个） ==============================

    @Test
    void shouldAcceptRootSkillDocWithMultipleTopLevelSubdirSkills() {
        // 核心新增场景（kaoqing 场景）：根级 SKILL.md + 多个顶级子目录各自带 SKILL.md → 接受，
        // 子目录里的 SKILL.md 一律忽略、不参与校验。
        MultipartFile zip = buildZip("kaoqing.zip",
            "SKILL.md", "# root",
            "add-class/SKILL.md", "# nano-add-class",
            "add-class/flow.yaml", "name: add",
            "class-manage/SKILL.md", "# nano-class-manage",
            "class-manage/flow.yaml", "name: manage",
            "edit-kaoqin-group/SKILL.md", "# nano-edit-kaoqin-group",
            "edit-kaoqin-group/flow.yaml", "name: edit");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("kaoqing", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "kaoqing", dto.getSkillPath());
        assertEquals(AGENT_PREFIX + "kaoqing/SKILL.md", dto.getSkillDocObjectKey());

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        // 根级 SKILL.md 必须写入
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "kaoqing/SKILL.md"));
        // 三个子目录的 SKILL.md 均被忽略、不参与校验，但依落盘语义仍写入
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "kaoqing/add-class/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "kaoqing/class-manage/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "kaoqing/edit-kaoqin-group/SKILL.md"));
    }

    @Test
    void shouldRejectZipWithOnlySubdirectorySkillDocs() {
        // 根级无 SKILL.md、仅子目录有 → 拒绝（v2 新收紧点）。
        MultipartFile zip = buildZip("skill.zip",
            "alpha/SKILL.md", "# nano",
            "alpha/scripts/run.py", "print('hi')",
            "beta/SKILL.md", "# nano");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    void shouldIgnoreDeeplyNestedSkillDocsWhenRootSkillDocExists() {
        // 根级 SKILL.md + 任意深度子目录里的 SKILL.md 一律忽略（覆盖深度 2+ 的场景）。
        MultipartFile zip = buildZip("nested.zip",
            "SKILL.md", "# root",
            "a/b/c/d/SKILL.md", "# deep",
            "a/b/c/d/flow.yaml", "name: deep");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("nested", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "nested/SKILL.md", dto.getSkillDocObjectKey());

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "nested/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "nested/a/b/c/d/SKILL.md"));
    }

    @Test
    void shouldAcceptMixedCaseRootSkillDoc() {
        // 根级 SKILL.md 文件名大小写混合（skill.MD）也应被识别并规范化为 SKILL.md。
        MultipartFile zip = buildZip("skill.zip",
            "skill.MD", "# root",
            "scripts/run.py", "print('hi')");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("skill", dto.getSkillName());
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        // 写入时统一规范化为 "SKILL.md"
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "skill/SKILL.md"));
    }

    @Test
    void shouldAcceptRootSkillDocAndIgnoreMixedSubdirSkillDocs() {
        // 根级 SKILL.md + 多深度子目录里散落的 SKILL.md（含混合大小写）一律忽略。
        MultipartFile zip = buildZip("mixed.zip",
            "SKILL.md", "# root",
            "add-class/SKILL.md", "# nano-1",
            "class-manage/skill.md", "# nano-2",
            "edit-group/deep/nested/SKILL.md", "# nano-deep");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("mixed", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "mixed/SKILL.md", dto.getSkillDocObjectKey());

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "mixed/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "mixed/add-class/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "mixed/class-manage/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "mixed/edit-group/deep/nested/SKILL.md"));
    }

    @Test
    void shouldNotDeleteExistingSkillWhenRootSkillDocMissing() {
        // 根级无 SKILL.md 的包必须在校验阶段就拒绝，绝不能走到 userFS.delete 落盘副作用。
        MultipartFile zip = buildZip("bad.zip",
            "alpha/SKILL.md", "# only-subdir");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
        verify(userFS, org.mockito.Mockito.never()).delete(anyString());
    }

    // ============================== 工具方法 ==============================

    /** 构造一个 zip MultipartFile，参数按 (entryName, content) 成对传入；filename 决定 originalFilename。 */
    private MultipartFile buildZip(String filename, String... entries) {
        return buildZip(filename, null, entries);
    }

    private MultipartFile buildZip(String filename, Charset charset, String... entries) {
        if (entries.length % 2 != 0) {
            throw new IllegalArgumentException("entries 必须成对");
        }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (ZipOutputStream zos = charset == null ? new ZipOutputStream(buf) : new ZipOutputStream(buf, charset)) {
            for (int i = 0; i < entries.length; i += 2) {
                zos.putNextEntry(new ZipEntry(entries[i]));
                zos.write(entries[i + 1].getBytes());
                zos.closeEntry();
            }
        }
        catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return new MockMultipartFile("file", filename, "application/zip", buf.toByteArray());
    }

    private MultipartFile buildTarGz(String filename, String... entries) {
        if (entries.length % 2 != 0) {
            throw new IllegalArgumentException("entries 必须成对");
        }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (GzipCompressorOutputStream gzipOut = new GzipCompressorOutputStream(buf);
            TarArchiveOutputStream tos = new TarArchiveOutputStream(gzipOut)) {
            tos.setLongFileMode(TarArchiveOutputStream.LONGFILE_POSIX);
            for (int i = 0; i < entries.length; i += 2) {
                byte[] content = entries[i + 1].getBytes();
                TarArchiveEntry entry = new TarArchiveEntry(entries[i]);
                entry.setSize(content.length);
                tos.putArchiveEntry(entry);
                tos.write(content);
                tos.closeArchiveEntry();
            }
            tos.finish();
        }
        catch (IOException e) {
            throw new IllegalStateException(e);
        }
        return new MockMultipartFile("file", filename, "application/gzip", buf.toByteArray());
    }
}