package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Locale;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.DisabledOnOs;
import org.junit.jupiter.api.condition.OS;
import org.junit.jupiter.api.extension.ExtendWith;
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
import static org.mockito.Mockito.when;

/**
 * Issue #155 端到端集成测试：用真实 ZIP fixture（保存在
 * /by/.sessions/10008648/qa/fixtures/）驱动两个 service 的生产代码路径：
 *
 * <ul>
 *   <li>{@link ByClawSkillUploadApplicationService#uploadSkillZip} → parseArchiveEntries → findUniqueSkillDoc</li>
 *   <li>{@link ByClawSkillResourceApplicationService#inspectSkillPackage} → readZipEntries → findSkillDoc</li>
 * </ul>
 *
 * 验收场景（issue #155）：
 * <ol>
 *   <li>根级 SKILL.md + 多个子目录各自含 SKILL.md → ACCEPT</li>
 *   <li>只有根级 SKILL.md，无任何子目录 → ACCEPT</li>
 *   <li>根级无 SKILL.md，仅子目录有 → REJECT (byclaw.skill.zip.missing.doc)</li>
 *   <li>完全无 SKILL.md → REJECT</li>
 *   <li>根级多份 SKILL.md → REJECT</li>
 * </ol>
 */
@DisabledOnOs(OS.WINDOWS)
@ExtendWith(MockitoExtension.class)
class Issue155E2EIntegrationTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    private static final String AGENT_PREFIX = "/.openclaw/workspace-baiying-agent-10000417/skills/";

    private static final Path FIXTURE_DIR = Paths.get("/by/.sessions/10008648/qa/fixtures");

    @Mock
    private UserFS userFS;

    @Mock
    private ByClawSkillPathResolver skillPathResolver;

    private ByClawSkillUploadApplicationService uploadService;

    private ByClawSkillResourceApplicationService resourceService;

    @BeforeEach
    void setUp() throws Exception {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("byclaw.skill.zip.empty", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包不能为空");
        messageSource.addMessage("byclaw.skill.zip.read.failed", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包解析失败");
        messageSource.addMessage("byclaw.skill.zip.file.invalid", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包必须是 zip 格式");
        messageSource.addMessage("byclaw.skill.zip.size.exceeded", Locale.SIMPLIFIED_CHINESE, "超过最大允许大小");
        messageSource.addMessage("byclaw.skill.zip.missing.doc", Locale.SIMPLIFIED_CHINESE, "Skill 压缩包必须有且仅有一个 SKILL.md");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        uploadService = new ByClawSkillUploadApplicationService();
        ReflectionTestUtils.setField(uploadService, "userFS", userFS);
        ReflectionTestUtils.setField(uploadService, "skillPathResolver", skillPathResolver);

        resourceService = new ByClawSkillResourceApplicationService();
        ReflectionTestUtils.setField(resourceService, "userFS", userFS);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    // ============================================================
    // 端到端：用真实 ZIP fixture 走 ByClawSkillUploadApplicationService
    // ============================================================

    @Test
    @DisplayName("E2E[upload] kaoqing.zip: 根级 + 3 子目录各自 SKILL.md → ACCEPT")
    void uploadKaoqingStyleZipShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("kaoqing.zip");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var dto = uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("kaoqing", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "kaoqing", dto.getSkillPath());
        assertEquals(AGENT_PREFIX + "kaoqing/SKILL.md", dto.getSkillDocObjectKey());
    }

    @Test
    @DisplayName("E2E[upload] kaoqing-realistic.zip: 真实业务结构 → ACCEPT")
    void uploadRealisticKaoqingZipShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("kaoqing-realistic.zip");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var dto = uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("kaoqing-realistic", dto.getSkillName());
        assertNotNull(dto.getSkillDocObjectKey());
        assertTrue(dto.getSkillDocObjectKey().endsWith("/SKILL.md"));
    }

    @Test
    @DisplayName("E2E[upload] alpha.zip: 只有根级 SKILL.md → ACCEPT")
    void uploadAlphaShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("alpha.zip");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var dto = uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("alpha", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "alpha/SKILL.md", dto.getSkillDocObjectKey());
    }

    @Test
    @DisplayName("E2E[upload] beta.zip: 根级 SKILL.md + 普通子目录 → ACCEPT")
    void uploadBetaShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("beta.zip");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var dto = uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("beta", dto.getSkillName());
    }

    @Test
    @DisplayName("E2E[upload] zeta.zip: 根级 + 深度 3 子目录 SKILL.md → ACCEPT (深度忽略)")
    void uploadZetaDeepNestedShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("zeta.zip");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var dto = uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("zeta", dto.getSkillName());
        assertEquals(AGENT_PREFIX + "zeta/SKILL.md", dto.getSkillDocObjectKey());
    }

    @Test
    @DisplayName("E2E[upload] mixed.zip: 根级 + 子目录混合大小写 SKILL.md → ACCEPT")
    void uploadMixedCaseShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("mixed.zip");
        when(skillPathResolver.resolveSkillRootPrefix(USER_CODE, RESOURCE_ID)).thenReturn(AGENT_PREFIX);

        var dto = uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip);

        assertEquals("mixed", dto.getSkillName());
    }

    @Test
    @DisplayName("E2E[upload] gamma.zip: 仅子目录 SKILL.md → REJECT")
    void uploadGammaOnlySubdirShouldBeRejected() throws Exception {
        MultipartFile zip = loadFixture("gamma.zip");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    @DisplayName("E2E[upload] delta.zip: 完全无 SKILL.md → REJECT")
    void uploadDeltaNoSkillDocShouldBeRejected() throws Exception {
        MultipartFile zip = loadFixture("delta.zip");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    @Test
    @DisplayName("E2E[upload] epsilon.zip: 根级多份 SKILL.md → REJECT")
    void uploadEpsilonMultipleRootShouldBeRejected() throws Exception {
        MultipartFile zip = loadFixture("epsilon.zip");

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> uploadService.uploadSkillZip(USER_CODE, RESOURCE_ID, zip));
        assertTrue(ex.getMessage().contains("SKILL.md"));
    }

    // ============================================================
    // 端到端：用真实 ZIP fixture 走 ByClawSkillResourceApplicationService
    // ============================================================

    @Test
    @DisplayName("E2E[resource] kaoqing.zip: 根级 + 3 子目录 SKILL.md → ACCEPT (issue #155 follow-up 同步规则)")
    void resourceKaoqingShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("kaoqing.zip");

        var metadata = resourceService.inspectSkillPackage(zip);

        assertNotNull(metadata);
        assertEquals("kaoqing", metadata.skillCode());
        assertEquals("kaoqing", metadata.skillName());
        assertEquals("kaoqing.zip", metadata.originalFilename());
        assertTrue(metadata.size() > 0);
    }

    @Test
    @DisplayName("E2E[resource] realistic kaoqing.zip: 真实业务 → ACCEPT")
    void resourceRealisticKaoqingShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("kaoqing-realistic.zip");

        var metadata = resourceService.inspectSkillPackage(zip);

        assertNotNull(metadata);
        assertEquals("kaoqing-realistic", metadata.skillCode());
    }

    @Test
    @DisplayName("E2E[resource] alpha.zip: 只有根级 SKILL.md → ACCEPT")
    void resourceAlphaShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("alpha.zip");

        var metadata = resourceService.inspectSkillPackage(zip);

        assertEquals("alpha", metadata.skillCode());
    }

    @Test
    @DisplayName("E2E[resource] zeta.zip: 根级 + 深度子目录 SKILL.md → ACCEPT")
    void resourceZetaDeepShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("zeta.zip");

        var metadata = resourceService.inspectSkillPackage(zip);

        assertEquals("zeta", metadata.skillCode());
    }

    @Test
    @DisplayName("E2E[resource] gamma.zip: 仅子目录 SKILL.md → REJECT (issue #155 follow-up 收紧点)")
    void resourceGammaOnlySubdirShouldBeRejected() throws Exception {
        MultipartFile zip = loadFixture("gamma.zip");

        assertThrows(IllegalArgumentException.class,
            () -> resourceService.inspectSkillPackage(zip));
    }

    @Test
    @DisplayName("E2E[resource] delta.zip: 无 SKILL.md → REJECT")
    void resourceDeltaNoSkillDocShouldBeRejected() throws Exception {
        MultipartFile zip = loadFixture("delta.zip");

        assertThrows(IllegalArgumentException.class,
            () -> resourceService.inspectSkillPackage(zip));
    }

    @Test
    @DisplayName("E2E[resource] epsilon.zip: 根级多份 SKILL.md → REJECT")
    void resourceEpsilonMultipleRootShouldBeRejected() throws Exception {
        MultipartFile zip = loadFixture("epsilon.zip");

        assertThrows(IllegalArgumentException.class,
            () -> resourceService.inspectSkillPackage(zip));
    }

    @Test
    @DisplayName("E2E[resource] mixed.zip: 根级 + 子目录混合大小写 SKILL.md → ACCEPT")
    void resourceMixedCaseShouldBeAccepted() throws Exception {
        MultipartFile zip = loadFixture("mixed.zip");

        var metadata = resourceService.inspectSkillPackage(zip);

        assertEquals("mixed", metadata.skillCode());
    }

    // ============================================================
    // Fixture 加载工具：从 /by/.sessions/10008648/qa/fixtures/ 读真实 ZIP 字节
    // ============================================================

    private MultipartFile loadFixture(String name) throws IOException {
        Path p = FIXTURE_DIR.resolve(name);
        if (!Files.exists(p)) {
            throw new IllegalStateException("fixture 缺失: " + p + "（请先跑 Issue155E2EFixtureBuilder）");
        }
        byte[] bytes = Files.readAllBytes(p);
        return new MockMultipartFile("file", name, "application/zip", bytes);
    }
}