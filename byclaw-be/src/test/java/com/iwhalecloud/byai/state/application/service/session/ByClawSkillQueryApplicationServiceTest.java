package com.iwhalecloud.byai.state.application.service.session;

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

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ByClawSkillQueryApplicationServiceTest {

    private static final String USER_CODE = "adminvip";
    private static final Long RESOURCE_ID = 10000417L;
    private static final String AGENT_SKILL_ROOT_PREFIX = "/.openclaw/workspace-baiying-agent-10000417/skills/";
    private static final String WORKSPACE_SKILL_ROOT_PREFIX = "/.openclaw/workspace/skills/";

    @Mock
    private UserFS userFS;

    @Mock
    private SsResourceService ssResourceService;

    private ByClawSkillQueryApplicationService byClawSkillQueryApplicationService;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        messageSource.addMessage("resource.resourceid.notnull", Locale.SIMPLIFIED_CHINESE, "资源ID不能为空");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        byClawSkillQueryApplicationService = new ByClawSkillQueryApplicationService();
        ReflectionTestUtils.setField(byClawSkillQueryApplicationService, "userFS", userFS);
        ReflectionTestUtils.setField(byClawSkillQueryApplicationService, "ssResourceService", ssResourceService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void shouldAggregateSkillDirectoriesAndSortBySkillName() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            AGENT_SKILL_ROOT_PREFIX + "zeta/SKILL.md",
            AGENT_SKILL_ROOT_PREFIX + "zeta/resources/a.txt",
            AGENT_SKILL_ROOT_PREFIX + "zeta/requirements.txt",
            AGENT_SKILL_ROOT_PREFIX + "alpha/README.md",
            AGENT_SKILL_ROOT_PREFIX + "alpha/SKILL.md",
            AGENT_SKILL_ROOT_PREFIX + "README.md"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(2, result.size());
        assertEquals("alpha", result.get(0).getSkillName());
        assertEquals(AGENT_SKILL_ROOT_PREFIX + "alpha", result.get(0).getSkillPath());
        assertEquals(AGENT_SKILL_ROOT_PREFIX + "alpha/SKILL.md", result.get(0).getSkillDocObjectKey());
        assertEquals("zeta", result.get(1).getSkillName());
        assertEquals(AGENT_SKILL_ROOT_PREFIX + "zeta", result.get(1).getSkillPath());
        assertEquals(AGENT_SKILL_ROOT_PREFIX + "zeta/SKILL.md", result.get(1).getSkillDocObjectKey());
        verify(userFS).list(eq(AGENT_SKILL_ROOT_PREFIX), isNull());
    }

    @Test
    void shouldFilterBySkillNameAndIgnoreDirectoryWithoutSkillDoc() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            AGENT_SKILL_ROOT_PREFIX + "baiying/resources/prompt.txt",
            AGENT_SKILL_ROOT_PREFIX + "baiying/requirements.txt",
            AGENT_SKILL_ROOT_PREFIX + "github-weekly-commit-collector/SKILL.md"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, "bai");

        assertEquals(0, result.size());
    }

    @Test
    void shouldReturnOnlyOneLevelSkillDocFiles() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            AGENT_SKILL_ROOT_PREFIX + "baiying/SKILL.md",
            AGENT_SKILL_ROOT_PREFIX + "baiying/resources/SKILL.md",
            AGENT_SKILL_ROOT_PREFIX + "baiying/README.md",
            AGENT_SKILL_ROOT_PREFIX + "nested/path/SKILL.md"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(1, result.size());
        assertEquals("baiying", result.get(0).getSkillName());
        assertEquals(AGENT_SKILL_ROOT_PREFIX + "baiying/SKILL.md", result.get(0).getSkillDocObjectKey());
    }

    @Test
    void shouldMatchKeywordAgainstSkillDirectoryNameOnly() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            AGENT_SKILL_ROOT_PREFIX + "baiying-agent/SKILL.md",
            AGENT_SKILL_ROOT_PREFIX + "other-skill/SKILL.md"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, "agent");

        assertEquals(1, result.size());
        assertEquals("baiying-agent", result.get(0).getSkillName());
    }

    @Test
    void shouldReturnEmptyListWhenBucketOrPrefixHasNoObjects() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_ROOT_PREFIX), isNull())).thenReturn(Collections.emptyList());

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(0, result.size());
    }

    @Test
    void shouldReturnEmptyListWhenObjectKeysIsNull() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("employee_10000417"));
        when(userFS.list(eq(AGENT_SKILL_ROOT_PREFIX), isNull())).thenReturn(null);

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(0, result.size());
    }

    @Test
    void shouldRejectBlankUserCode() {
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class,
            () -> byClawSkillQueryApplicationService.qrySkillListByUserCode("  ", RESOURCE_ID, null));

        assertEquals("userCode不能为空", exception.getMessage());
    }

    @Test
    void shouldQuerySuperAssistantWorkspaceWhenResourceIdIsNull() {
        when(ssResourceService.findById(RESOURCE_ID)).thenReturn(resource("adminvip_main"));
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core/SKILL.md",
            WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core/resources/logo.png"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(1, result.size());
        assertEquals("assistant-core", result.get(0).getSkillName());
        assertEquals(WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core", result.get(0).getSkillPath());
        assertEquals(WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core/SKILL.md", result.get(0).getSkillDocObjectKey());
    }

    private SsResource resource(String resourceCode) {
        SsResource resource = new SsResource();
        resource.setResourceCode(resourceCode);
        return resource;
    }
}
