package com.iwhalecloud.byai.state.application.service.session;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.storage.ObjectStorage;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.StorageObject;
import com.iwhalecloud.byai.common.storage.model.StoragePrefix;
import com.iwhalecloud.byai.state.domain.chat.dto.UserSpaceDto;
import com.iwhalecloud.byai.state.domain.chat.vo.UserSpaceVo;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawFileDto;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ByClawFileQueryApplicationServiceTest {

    private static final String USER_CODE = "adminvip";
    private static final String SESSION_ID = "10014538";
    private static final String SESSION_PREFIX = "/.sessions/10014538/";

    @Mock
    private UserFS userFS;

    @Mock
    private ObjectStorage objectStorage;

    private ByClawFileQueryApplicationService byClawFileQueryApplicationService;

    @BeforeEach
    void setUp() {
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("byclaw.user.code.notempty", Locale.SIMPLIFIED_CHINESE, "userCode不能为空");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        byClawFileQueryApplicationService = new ByClawFileQueryApplicationService();
        ReflectionTestUtils.setField(byClawFileQueryApplicationService, "userFS", userFS);
        ReflectionTestUtils.setField(byClawFileQueryApplicationService, "objectStorage", objectStorage);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void shouldListSessionFilesFromUserFsAndSortByObjectKey() {
        when(userFS.list(eq(SESSION_PREFIX), isNull())).thenReturn(Arrays.asList(
            "/.sessions/10014538/reports/zeta.md",
            "/.sessions/10014538/reports/alpha.md",
            "/.sessions/10014538/",
            "/.openclaw/ignored.md"));

        List<ByClawFileDto> result = byClawFileQueryApplicationService.qryByClawFileByUserCode(
            USER_CODE, null, SESSION_ID);

        assertEquals(2, result.size());
        assertEquals("/.sessions/10014538/reports/alpha.md", result.get(0).getObjectKey());
        assertEquals("alpha.md", result.get(0).getFileName());
        assertEquals("/.sessions/10014538/reports/alpha.md", result.get(0).getFilePath());
        assertEquals("/.sessions/10014538/reports/zeta.md", result.get(1).getObjectKey());
        verify(userFS).list(eq(SESSION_PREFIX), isNull());
    }

    @Test
    void shouldListAllSessionFilesWhenSessionIdIsBlank() {
        when(userFS.list(eq("/.sessions/"), isNull())).thenReturn(Arrays.asList(
            "/.sessions/session-a/out.md",
            "/.sessions/session-b/nested/out.md",
            "/.sessions/session-c/",
            "/.openclaw/ignored.md"));

        List<ByClawFileDto> result = byClawFileQueryApplicationService.qryByClawFileByUserCode(
            USER_CODE, null, " ");

        assertEquals(2, result.size());
        assertEquals("/.sessions/session-a/out.md", result.get(0).getObjectKey());
        assertEquals("/.sessions/session-b/nested/out.md", result.get(1).getObjectKey());
    }

    @Test
    void shouldFilterByKeywordAgainstObjectKeyAndFileName() {
        when(userFS.list(eq(SESSION_PREFIX), isNull())).thenReturn(Arrays.asList(
            "/.sessions/10014538/reports/alpha.md",
            "/.sessions/10014538/reports/beta.txt",
            "/.sessions/10014538/notes/readme.md"));

        List<ByClawFileDto> result = byClawFileQueryApplicationService.qryByClawFileByUserCode(
            USER_CODE, "REPORTS", SESSION_ID);

        assertEquals(2, result.size());
        assertEquals("alpha.md", result.get(0).getFileName());
        assertEquals("beta.txt", result.get(1).getFileName());
    }

    @Test
    void shouldReturnEmptyListWhenUserFsReturnsNull() {
        when(userFS.list(eq(SESSION_PREFIX), isNull())).thenReturn(null);

        List<ByClawFileDto> result = byClawFileQueryApplicationService.qryByClawFileByUserCode(
            USER_CODE, null, SESSION_ID);

        assertEquals(0, result.size());
    }

    @Test
    void shouldRestoreOriginalUserContextAfterQuery() {
        LoginInfo originalLoginInfo = new LoginInfo();
        originalLoginInfo.setUserCode("original");
        CurrentUserHolder.setLoginInfo(originalLoginInfo);
        when(userFS.list(eq(SESSION_PREFIX), isNull())).thenReturn(Collections.emptyList());

        byClawFileQueryApplicationService.qryByClawFileByUserCode(USER_CODE, null, SESSION_ID);

        assertEquals("original", CurrentUserHolder.getCurrentUserCode());
    }

    @Test
    void shouldRejectBlankUserCode() {
        IllegalArgumentException exception = assertThrows(IllegalArgumentException.class,
            () -> byClawFileQueryApplicationService.qryByClawFileByUserCode("  ", null, SESSION_ID));

        assertEquals("userCode不能为空", exception.getMessage());
    }

    @Test
    void shouldListUserSpaceThroughConfiguredObjectStorage() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(USER_CODE);
        CurrentUserHolder.setLoginInfo(loginInfo);

        UserSpaceDto userSpaceDto = new UserSpaceDto();
        userSpaceDto.setResourceId(10005856L);
        when(objectStorage.list(any(StoragePrefix.class), isNull()))
            .thenReturn(Arrays.asList(
                StorageObject.builder()
                    .bucketOrRoot("byclaw-adminvip")
                    .path("by/.openclaw/workspace-baiying-agent-10005856/config.json")
                    .build(),
                StorageObject.builder()
                    .bucketOrRoot("byclaw-adminvip")
                    .path("by/.openclaw/workspace-baiying-agent-10005856/reports/")
                    .isDir(true)
                    .build()));

        List<UserSpaceVo> result = byClawFileQueryApplicationService.listUserSpace(userSpaceDto);

        ArgumentCaptor<StoragePrefix> prefixCaptor = ArgumentCaptor.forClass(StoragePrefix.class);
        verify(objectStorage).list(prefixCaptor.capture(), isNull());
        StoragePrefix storagePrefix = prefixCaptor.getValue();
        assertEquals("workspace", storagePrefix.getNamespace());
        assertEquals("byclaw-adminvip", storagePrefix.getBucketOrRoot());
        assertEquals("by/.openclaw/workspace-baiying-agent-10005856/", storagePrefix.getPrefix());
        assertEquals("private", storagePrefix.getShareType());

        assertEquals(2, result.size());
        assertEquals("config.json", result.get(0).getName());
        assertEquals("/by/.openclaw/workspace-baiying-agent-10005856/config.json", result.get(0).getFilePath());
        assertEquals("reports", result.get(1).getName());
        assertEquals("/by/.openclaw/workspace-baiying-agent-10005856/reports/", result.get(1).getFilePath());
        assertTrue(result.get(1).isDir());
    }
}
