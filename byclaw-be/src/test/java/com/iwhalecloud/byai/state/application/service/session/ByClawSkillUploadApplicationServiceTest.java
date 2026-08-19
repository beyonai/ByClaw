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
import org.apache.commons.compress.archivers.zip.ZipArchiveEntry;
import org.apache.commons.compress.archivers.zip.ZipArchiveOutputStream;
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

    @Test
    void shouldClearOldSkillAndWriteAllEntries() {
        MultipartFile zip = buildZip("skill.zip",
            "fol-auto-biztravel/SKILL.md", "# Skill",
            "fol-auto-biztravel/scripts/run.py", "print('hi')");
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
        // skill.md（小写）也被识别，但写入时统一规范化为 SKILL.md。
        MultipartFile zip = buildZip("skill.zip",
            "alpha/skill.md", "# alpha");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "alpha/SKILL.md"));
        assertEquals("alpha", dto.getSkillName());
    }

    @Test
    void shouldIgnoreNestedSkillDocsWhenTopLevelSkillDocExists() {
        MultipartFile zip = buildZip("zmp-leave-complex.zip",
            "zmp-leave-complex/SKILL.md", "# root",
            "zmp-leave-complex/create-leave-request/SKILL.md", "# nano",
            "zmp-leave-complex/create-leave-request/flow.yaml", "name: create");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertEquals("zmp-leave-complex", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "zmp-leave-complex/SKILL.md", dto.getSkillDocObjectKey());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "zmp-leave-complex/SKILL.md"));
        assertTrue(pathCaptor.getAllValues()
            .contains(AGENT_PREFIX + "zmp-leave-complex/create-leave-request/SKILL.md"));
    }

    @Test
    void shouldOnlyValidateSkillRootDocAndIgnoreChildDirectoryWithoutSkillDoc() {
        MultipartFile zip = buildZip("add-class.zip",
            "add-class/SKILL.md", "# add class",
            "add-class/flow.yaml", "name: add-class",
            "add-class/ceshi/data.txt", "child content",
            "__MACOSX/add-class/._.DS_Store", "mac metadata");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertEquals("add-class", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "add-class/SKILL.md", dto.getSkillDocObjectKey());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "add-class/ceshi/data.txt"));
        assertTrue(pathCaptor.getAllValues().stream().noneMatch(path -> path.contains("__MACOSX")));
    }

    @Test
    void shouldAcceptChineseSkillDirectoryFromGbkEncodedZip() {
        MultipartFile zip = buildZip("铁算盘财务健康分析.zip", Charset.forName("GBK"),
            "铁算盘财务健康分析/SKILL.md", "# 铁算盘",
            "铁算盘财务健康分析/references/persona-guide.md", "guide");
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
    void shouldAcceptUtf8ChineseEntryNamesWithoutLanguageEncodingFlag() {
        MultipartFile zip = buildUtf8ZipWithoutLanguageEncodingFlag("ppt-master.zip",
            "ppt-master/SKILL.md", "# PPT Master",
            "ppt-master/templates/brands/中汽研/design_spec.md", "brand spec");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("ppt-master", dto.getSkillName());
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues()
            .contains(AGENT_PREFIX + "ppt-master/templates/brands/中汽研/design_spec.md"));
    }

    @Test
    void shouldRejectZipWithMultipleSkillDocs() {
        // 两个顶层 skill 目录都存在 SKILL.md，仍按单 skill zip 判定违规。
        MultipartFile zip = buildZip("skill.zip",
            "a/SKILL.md", "x",
            "b/SKILL.md", "y");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    void shouldUploadMultipleSkillZips() {
        MultipartFile alpha = buildZip("alpha.zip", "alpha/SKILL.md", "# alpha");
        MultipartFile beta = buildZip("beta.zip", "beta/SKILL.md", "# beta");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var result = service.uploadSkillZips(USER_CODE, RESOURCE_ID, Arrays.asList(alpha, beta));

        assertEquals(2, result.size());
        assertEquals("alpha", result.get(0).getSkillName());
        assertEquals("beta", result.get(1).getSkillName());
        verify(userFS).delete(AGENT_PREFIX + "alpha/");
        verify(userFS).delete(AGENT_PREFIX + "beta/");
    }

    @Test
    void shouldRejectZipMissingSkillDoc() {
        MultipartFile zip = buildZip("skill.zip", "alpha/README.md", "no doc");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    void shouldFallbackSkillNameToZipNameWhenSkillDocAtRoot() {
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
        MultipartFile tarGz = buildTarGz("content-factory.tar.gz",
            "content-factory/SKILL.md", "# content factory",
            "content-factory/scripts/main.py", "print('hi')");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, tarGz));
        assertTrue(ex.getMessage().contains("zip"));
    }

    @Test
    void shouldRejectTarGzSkillArchiveWhenSkillDocAtRoot() {
        MultipartFile tarGz = buildTarGz("root-skill.tar.gz",
            "SKILL.md", "# root",
            "scripts/run.py", "print('hi')");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, tarGz));
        assertTrue(ex.getMessage().contains("zip"));
    }

    @Test
    void shouldSilentlySkipPathTraversalEntry() {
        // 路径穿越静默忽略而不是抛错；只要 SKILL.md 唯一即可上传成功。
        MultipartFile zip = buildZip("skill.zip",
            "alpha/SKILL.md", "ok",
            "alpha/../../etc/passwd", "hack");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("alpha", dto.getSkillName());
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        // passwd 穿越 entry 被静默丢弃，不会出现在写入列表中
        assertTrue(pathCaptor.getAllValues().stream().noneMatch(p -> p.contains("passwd")));
    }

    @Test
    void shouldRejectEmptyUserCode() {
        MultipartFile zip = buildZip("skill.zip", "a/SKILL.md", "x");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip("  ", RESOURCE_ID, zip));
        assertEquals("userCode不能为空", ex.getMessage());
    }

    @Test
    void shouldRejectEmptyZip() {
        MockMultipartFile zip = new MockMultipartFile("file", "empty.zip", "application/zip", new byte[0]);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertEquals("Skill 压缩包不能为空", ex.getMessage());
    }

    @Test
    void shouldUploadToSuperAssistantWorkspaceWhenResourceIdIsNull() {
        MultipartFile zip = buildZip("assistant-core.zip",
            "assistant-core/SKILL.md", "# Skill",
            "assistant-core/scripts/run.py", "print('hi')");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(SUPER_PREFIX);

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        verify(userFS).delete(SUPER_PREFIX + "assistant-core/");
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(SUPER_PREFIX + "assistant-core/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(SUPER_PREFIX + "assistant-core/scripts/run.py"));
        assertEquals(SUPER_PREFIX + "assistant-core", dto.getSkillPath());
    }

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

    private MultipartFile buildUtf8ZipWithoutLanguageEncodingFlag(String filename, String... entries) {
        if (entries.length % 2 != 0) {
            throw new IllegalArgumentException("entries 必须成对");
        }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (ZipArchiveOutputStream zos = new ZipArchiveOutputStream(buf)) {
            zos.setEncoding("UTF-8");
            zos.setUseLanguageEncodingFlag(false);
            zos.setCreateUnicodeExtraFields(ZipArchiveOutputStream.UnicodeExtraFieldPolicy.NEVER);
            for (int i = 0; i < entries.length; i += 2) {
                zos.putArchiveEntry(new ZipArchiveEntry(entries[i]));
                zos.write(entries[i + 1].getBytes());
                zos.closeArchiveEntry();
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
