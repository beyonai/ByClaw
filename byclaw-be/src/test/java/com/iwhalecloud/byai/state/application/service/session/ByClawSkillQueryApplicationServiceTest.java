package com.iwhalecloud.byai.state.application.service.session;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
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
    private static final String SKILL_ROOT_PREFIX = "/.openclaw/workspace-baiying-agent-10000417/skills/";
    private static final String WORKSPACE_SKILL_ROOT_PREFIX = "/.openclaw/workspace/skills/";

    @Mock
    private UserFS userFS;

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
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void shouldAggregateSkillDirectoriesAndSortBySkillName() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            SKILL_ROOT_PREFIX + "zeta/SKILL.md",
            SKILL_ROOT_PREFIX + "zeta/resources/a.txt",
            SKILL_ROOT_PREFIX + "zeta/requirements.txt",
            SKILL_ROOT_PREFIX + "alpha/README.md",
            SKILL_ROOT_PREFIX + "alpha/SKILL.md",
            SKILL_ROOT_PREFIX + "README.md"));
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            WORKSPACE_SKILL_ROOT_PREFIX + "beta/SKILL.md",
            WORKSPACE_SKILL_ROOT_PREFIX + "zeta/SKILL.md",
            WORKSPACE_SKILL_ROOT_PREFIX + "nested/path/SKILL.md"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(3, result.size());
        assertEquals("alpha", result.get(0).getSkillName());
        assertEquals(SKILL_ROOT_PREFIX + "alpha", result.get(0).getSkillPath());
        assertEquals(SKILL_ROOT_PREFIX + "alpha/SKILL.md", result.get(0).getSkillDocObjectKey());
        assertEquals("beta", result.get(1).getSkillName());
        assertEquals(WORKSPACE_SKILL_ROOT_PREFIX + "beta", result.get(1).getSkillPath());
        assertEquals(WORKSPACE_SKILL_ROOT_PREFIX + "beta/SKILL.md", result.get(1).getSkillDocObjectKey());
        assertEquals("zeta", result.get(2).getSkillName());
        assertEquals(SKILL_ROOT_PREFIX + "zeta", result.get(2).getSkillPath());
        assertEquals(SKILL_ROOT_PREFIX + "zeta/SKILL.md", result.get(2).getSkillDocObjectKey());
        verify(userFS).list(eq(SKILL_ROOT_PREFIX), isNull());
        verify(userFS).list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull());
    }

    @Test
    void shouldFilterBySkillNameAndIgnoreDirectoryWithoutSkillDoc() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            SKILL_ROOT_PREFIX + "baiying/resources/prompt.txt",
            SKILL_ROOT_PREFIX + "baiying/requirements.txt",
            SKILL_ROOT_PREFIX + "github-weekly-commit-collector/SKILL.md"));
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull())).thenReturn(Collections.emptyList());

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, "bai");

        assertEquals(0, result.size());
    }

    @Test
    void shouldReturnOnlyOneLevelSkillDocFiles() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            SKILL_ROOT_PREFIX + "baiying/SKILL.md",
            SKILL_ROOT_PREFIX + "baiying/resources/SKILL.md",
            SKILL_ROOT_PREFIX + "baiying/README.md",
            SKILL_ROOT_PREFIX + "nested/path/SKILL.md"));
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull())).thenReturn(Collections.emptyList());

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(1, result.size());
        assertEquals("baiying", result.get(0).getSkillName());
        assertEquals(SKILL_ROOT_PREFIX + "baiying/SKILL.md", result.get(0).getSkillDocObjectKey());
    }

    @Test
    void shouldMatchKeywordAgainstSkillDirectoryNameOnly() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            SKILL_ROOT_PREFIX + "baiying-agent/SKILL.md",
            SKILL_ROOT_PREFIX + "other-skill/SKILL.md"));
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull())).thenReturn(Collections.emptyList());

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, "agent");

        assertEquals(1, result.size());
        assertEquals("baiying-agent", result.get(0).getSkillName());
    }

    @Test
    void shouldReturnEmptyListWhenBucketOrPrefixHasNoObjects() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull()))
            .thenReturn(Collections.emptyList());
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull()))
            .thenReturn(Collections.emptyList());

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(0, result.size());
    }

    @Test
    void shouldReturnEmptyListWhenObjectKeysIsNull() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull()))
            .thenReturn(null);
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull()))
            .thenReturn(null);

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
    void shouldRejectNullResourceId() {
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class,
            () -> byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, null, null));

        assertEquals("资源ID不能为空", exception.getMessage());
    }

    @Test
    void shouldIncludeGlobalWorkspaceSkillsWhenUserWorkspaceIsEmpty() {
        when(userFS.list(eq(SKILL_ROOT_PREFIX), isNull())).thenReturn(Collections.emptyList());
        when(userFS.list(eq(WORKSPACE_SKILL_ROOT_PREFIX), isNull())).thenReturn(Arrays.asList(
            WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core/SKILL.md",
            WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core/resources/logo.png"));

        List<ByClawSkillDto> result = byClawSkillQueryApplicationService.qrySkillListByUserCode(USER_CODE, RESOURCE_ID, null);

        assertEquals(1, result.size());
        assertEquals("assistant-core", result.get(0).getSkillName());
        assertEquals(WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core", result.get(0).getSkillPath());
        assertEquals(WORKSPACE_SKILL_ROOT_PREFIX + "assistant-core/SKILL.md", result.get(0).getSkillDocObjectKey());
    }
}
