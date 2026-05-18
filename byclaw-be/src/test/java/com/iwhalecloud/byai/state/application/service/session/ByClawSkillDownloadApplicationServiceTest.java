package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ByClawSkillDownloadApplicationServiceTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    private static final String SKILL_PATH = "/.openclaw/workspace-baiying-agent-10000417/skills/fol-auto-biztravel";

    private static final String SUPER_SKILL_PATH = "/.openclaw/workspace/skills/assistant-core";

    @Mock
    private UserFS userFS;

    @Mock
    private SsResourceService ssResourceService;

    private ByClawSkillDownloadApplicationService service;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("byclaw.skill.download.empty", Locale.SIMPLIFIED_CHINESE, "Skill 目录不存在或没有任何文件");
        messageSource.addMessage("byclaw.skill.download.path.invalid", Locale.SIMPLIFIED_CHINESE, "路径必须位于 /.openclaw/workspace/skills/ 之下");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        service = new ByClawSkillDownloadApplicationService();
        ReflectionTestUtils.setField(service, "userFS", userFS);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void shouldStreamSkillDirectoryAsZipWithRelativeEntries() throws IOException {
        // 模拟 list 返回该 skill 下的对象 keys；read 返回各自内容。
        Map<String, byte[]> objectContents = new LinkedHashMap<>();
        objectContents.put(SKILL_PATH + "/SKILL.md", "# skill".getBytes());
        objectContents.put(SKILL_PATH + "/scripts/run.py", "print('hi')".getBytes());
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        when(userFS.list(eq(SKILL_PATH + "/"), isNull()))
            .thenReturn(new java.util.ArrayList<>(objectContents.keySet()));
        objectContents.forEach((key, value) -> when(userFS.read(eq(key))).thenReturn(new ByteArrayInputStream(value)));

        ByClawSkillDownloadApplicationService.SkillZipDownload download =
            service.prepare(USER_CODE, RESOURCE_ID, SKILL_PATH);

        assertEquals("fol-auto-biztravel.zip", download.getZipFileName());

        Map<String, byte[]> zipEntries = readZip(download.getBody());
        assertEquals(2, zipEntries.size());
        assertTrue(zipEntries.containsKey("SKILL.md"));
        assertTrue(zipEntries.containsKey("scripts/run.py"));
        assertEquals("# skill", new String(zipEntries.get("SKILL.md")));
        assertEquals("print('hi')", new String(zipEntries.get("scripts/run.py")));
    }

    @Test
    void shouldTrimTrailingSlashAndAcceptValidPath() throws IOException {
        when(userFS.list(eq(SKILL_PATH + "/"), isNull())).thenReturn(Collections.singletonList(SKILL_PATH + "/SKILL.md"));
        when(userFS.read(eq(SKILL_PATH + "/SKILL.md"))).thenReturn(new ByteArrayInputStream("doc".getBytes()));
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        ByClawSkillDownloadApplicationService.SkillZipDownload download = service
            .prepare(USER_CODE, RESOURCE_ID, SKILL_PATH + "/");

        assertEquals("fol-auto-biztravel.zip", download.getZipFileName());
        Map<String, byte[]> zipEntries = readZip(download.getBody());
        assertEquals(1, zipEntries.size());
        assertTrue(zipEntries.containsKey("SKILL.md"));
    }

    @Test
    void shouldRejectPathOutsideSkillsRoot() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.prepare(USER_CODE, RESOURCE_ID, "/.sessions/secret"));
        assertTrue(ex.getMessage().contains("workspace/skills"));
    }

    @Test
    void shouldRejectPathHittingSkillsPrefixWithoutConcreteSkill() {
        // 不允许直接拉走整个 skills/ 目录。
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.prepare(USER_CODE, RESOURCE_ID, "/.openclaw/workspace-baiying-agent-10000417/skills"));
        assertTrue(ex.getMessage().contains("workspace/skills"));
    }

    @Test
    void shouldRejectPathTraversal() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.prepare(USER_CODE, RESOURCE_ID,
                "/.openclaw/workspace-baiying-agent-10000417/skills/../../etc"));
        assertTrue(ex.getMessage().contains("workspace/skills"));
    }

    @Test
    void shouldRejectEmptyUserCode() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.prepare("  ", RESOURCE_ID, SKILL_PATH));
        assertEquals("userCode不能为空", ex.getMessage());
    }

    @Test
    void shouldRejectMissingSkillDirectory() {
        when(userFS.list(eq(SKILL_PATH + "/"), isNull())).thenReturn(Collections.emptyList());
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.prepare(USER_CODE, RESOURCE_ID, SKILL_PATH));
        assertEquals("Skill 目录不存在或没有任何文件", ex.getMessage());
    }

    @Test
    void shouldSkipObjectKeysOutsideSkillRoot() throws IOException {
        // list 不应该返回前缀外的 key，但服务里有兜底防御；这里验证防御生效。
        when(userFS.list(eq(SKILL_PATH + "/"), isNull())).thenReturn(Arrays.asList(
            SKILL_PATH + "/SKILL.md",
            "/.openclaw/somewhere/else.txt"));
        when(userFS.read(eq(SKILL_PATH + "/SKILL.md"))).thenReturn(new ByteArrayInputStream("ok".getBytes()));
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        ByClawSkillDownloadApplicationService.SkillZipDownload download =
            service.prepare(USER_CODE, RESOURCE_ID, SKILL_PATH);
        Map<String, byte[]> zipEntries = readZip(download.getBody());
        assertEquals(1, zipEntries.size());
        assertTrue(zipEntries.containsKey("SKILL.md"));
    }

    @Test
    void shouldDownloadFromSuperAssistantWorkspaceWhenResourceIdIsNull() throws IOException {
        when(userFS.list(eq(SUPER_SKILL_PATH + "/"), isNull()))
            .thenReturn(Collections.singletonList(SUPER_SKILL_PATH + "/SKILL.md"));
        when(userFS.read(eq(SUPER_SKILL_PATH + "/SKILL.md"))).thenReturn(new ByteArrayInputStream("doc".getBytes()));
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("adminvip_main"));

        ByClawSkillDownloadApplicationService.SkillZipDownload download =
            service.prepare(USER_CODE, RESOURCE_ID, SUPER_SKILL_PATH);

        assertEquals("assistant-core.zip", download.getZipFileName());
        Map<String, byte[]> zipEntries = readZip(download.getBody());
        assertEquals(1, zipEntries.size());
        assertTrue(zipEntries.containsKey("SKILL.md"));
    }

    private SsResource resource(String resourceCode) {
        SsResource resource = new SsResource();
        resource.setResourceCode(resourceCode);
        return resource;
    }

    private Map<String, byte[]> readZip(StreamingResponseBody body) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        body.writeTo(buf);
        Map<String, byte[]> result = new HashMap<>();
        try (ZipInputStream zin = new ZipInputStream(new ByteArrayInputStream(buf.toByteArray()))) {
            ZipEntry entry;
            while ((entry = zin.getNextEntry()) != null) {
                if (entry.isDirectory()) {
                    continue;
                }
                ByteArrayOutputStream contentBuf = new ByteArrayOutputStream();
                byte[] tmp = new byte[1024];
                int n;
                while ((n = zin.read(tmp)) > 0) {
                    contentBuf.write(tmp, 0, n);
                }
                result.put(entry.getName(), contentBuf.toByteArray());
            }
        }
        return result;
    }

    /** 仅用于编译期确保类型可见性（List 导入），实际未使用。 */
    @SuppressWarnings("unused")
    private List<String> dummy() {
        return Collections.emptyList();
    }
}
