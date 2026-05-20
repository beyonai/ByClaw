package com.iwhalecloud.byai.state.application.service.session;

import java.util.Collections;
import java.util.List;
import java.util.Locale;

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
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ByClawSkillDeleteApplicationServiceTest {

    private static final String USER_CODE = "adminvip";

    private static final Long RESOURCE_ID = 10000417L;

    private static final String AGENT_SKILL_PATH = "/.openclaw/workspace-baiying-agent-10000417/skills/fol-auto-biztravel";

    private static final String SUPER_SKILL_PATH = "/.openclaw/workspace/skills/assistant-core";

    @Mock
    private UserFS userFS;

    @Mock
    private SsResourceService ssResourceService;

    private ByClawSkillDeleteApplicationService service;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("byclaw.skill.download.path.invalid", Locale.SIMPLIFIED_CHINESE, "路径必须位于 /.openclaw/workspace/skills/ 之下");
        messageSource.addMessage("byclaw.skill.delete.notfound", Locale.SIMPLIFIED_CHINESE, "Skill 目录不存在或已被删除");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        service = new ByClawSkillDeleteApplicationService();
        ReflectionTestUtils.setField(service, "userFS", userFS);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void shouldDeleteSkillFromAgentWorkspace() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_PATH + "/"), isNull()))
            .thenReturn(List.of(AGENT_SKILL_PATH + "/SKILL.md", AGENT_SKILL_PATH + "/scripts/run.py"));

        ByClawSkillDto dto = service.deleteSkill(USER_CODE, RESOURCE_ID, AGENT_SKILL_PATH);

        verify(userFS).init();
        verify(userFS).delete(AGENT_SKILL_PATH + "/");
        assertEquals("fol-auto-biztravel", dto.getSkillName());
        assertEquals(AGENT_SKILL_PATH, dto.getSkillPath());
    }

    @Test
    void shouldDeleteSkillFromSuperAssistantWorkspace() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("adminvip_main"));
        when(userFS.list(eq(SUPER_SKILL_PATH + "/"), isNull()))
            .thenReturn(Collections.singletonList(SUPER_SKILL_PATH + "/SKILL.md"));

        ByClawSkillDto dto = service.deleteSkill(USER_CODE, RESOURCE_ID, SUPER_SKILL_PATH);

        verify(userFS).delete(SUPER_SKILL_PATH + "/");
        assertEquals("assistant-core", dto.getSkillName());
        assertEquals(SUPER_SKILL_PATH, dto.getSkillPath());
    }

    @Test
    void shouldRejectInvalidPath() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.deleteSkill(USER_CODE, RESOURCE_ID, "/.openclaw/workspace/skills/abc"));

        assertTrue(ex.getMessage().contains("workspace/skills"));
    }

    @Test
    void shouldRejectNonConcreteSkillPath() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.deleteSkill(USER_CODE, RESOURCE_ID, "/.openclaw/workspace-baiying-agent-10000417/skills"));

        assertTrue(ex.getMessage().contains("workspace/skills"));
    }

    @Test
    void shouldRejectMissingSkillDirectory() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_PATH + "/"), isNull())).thenReturn(Collections.emptyList());

        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> service.deleteSkill(USER_CODE, RESOURCE_ID, AGENT_SKILL_PATH));

        assertEquals("Skill 目录不存在或已被删除", ex.getMessage());
    }

    private SsResource resource(String resourceCode) {
        SsResource resource = new SsResource();
        resource.setResourceCode(resourceCode);
        return resource;
    }
}
