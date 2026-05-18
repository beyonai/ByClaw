package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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

@ExtendWith(MockitoExtension.class)
class ByClawSkillUploadApplicationServiceTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    private static final String AGENT_PREFIX = "/.openclaw/workspace-baiying-agent-10000417/skills/";

    private static final String SUPER_PREFIX = "/.openclaw/workspace/skills/";

    @Mock
    private UserFS userFS;

    @Mock
    private SsResourceService ssResourceService;

    private ByClawSkillUploadApplicationService service;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("byclaw.skill.zip.empty", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包不能为空");
        messageSource.addMessage("byclaw.skill.zip.read.failed", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包解析失败");
        messageSource.addMessage("byclaw.skill.zip.size.exceeded", Locale.SIMPLIFIED_CHINESE, "超过最大允许大小");
        messageSource.addMessage("byclaw.skill.zip.missing.doc", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包必须有且仅有一个 SKILL.md");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        service = new ByClawSkillUploadApplicationService();
        ReflectionTestUtils.setField(service, "userFS", userFS);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
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
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

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
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "alpha/SKILL.md"));
        assertEquals("alpha", dto.getSkillName());
    }

    @Test
    void shouldRejectZipWithMultipleSkillDocs() {
        // 两个 SKILL.md（即便分布在不同子目录），按"必须有且仅有一个"判定违规。
        MultipartFile zip = buildZip("skill.zip",
            "a/SKILL.md", "x",
            "b/SKILL.md", "y");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
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
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("fol-auto-biztravel", dto.getSkillName());
        verify(userFS).delete(AGENT_PREFIX + "fol-auto-biztravel/");
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "fol-auto-biztravel/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(AGENT_PREFIX + "fol-auto-biztravel/scripts/run.py"));
    }

    @Test
    void shouldSilentlySkipPathTraversalEntry() {
        // 路径穿越静默忽略而不是抛错；只要 SKILL.md 唯一即可上传成功。
        MultipartFile zip = buildZip("skill.zip",
            "alpha/SKILL.md", "ok",
            "alpha/../../etc/passwd", "hack");
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

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
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("adminvip_main"));

        ByClawSkillDto dto = service.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        verify(userFS).delete(SUPER_PREFIX + "assistant-core/");
        ArgumentCaptor<String> pathCaptor = ArgumentCaptor.forClass(String.class);
        verify(userFS, atLeastOnce()).write(any(InputStream.class), anyLong(), anyString(), pathCaptor.capture());
        assertTrue(pathCaptor.getAllValues().contains(SUPER_PREFIX + "assistant-core/SKILL.md"));
        assertTrue(pathCaptor.getAllValues().contains(SUPER_PREFIX + "assistant-core/scripts/run.py"));
        assertEquals(SUPER_PREFIX + "assistant-core", dto.getSkillPath());
    }

    private SsResource resource(String resourceCode) {
        SsResource resource = new SsResource();
        resource.setResourceCode(resourceCode);
        return resource;
    }

    /** 构造一个 zip MultipartFile，参数按 (entryName, content) 成对传入；filename 决定 originalFilename。 */
    private MultipartFile buildZip(String filename, String... entries) {
        if (entries.length % 2 != 0) {
            throw new IllegalArgumentException("entries 必须成对");
        }
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(buf)) {
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
}
