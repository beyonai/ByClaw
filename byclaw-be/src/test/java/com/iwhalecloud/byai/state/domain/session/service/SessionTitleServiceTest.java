package com.iwhalecloud.byai.state.domain.session.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.Locale;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class SessionTitleServiceTest {

    @Mock
    private ByaiSessionMapper byaiSessionMapper;

    @Mock
    private SessionExtService sessionExtService;

    @Mock
    private SequenceService sequenceService;

    private SessionTitleService sessionTitleService;

    private MessageSource originalMessageSource;

    @BeforeEach
    void setUp() {
        sessionTitleService = new SessionTitleService(byaiSessionMapper, sessionExtService, sequenceService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(100L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        StaticMessageSource messageSource = new StaticMessageSource();
        messageSource.addMessage("session.file.upload.title", Locale.US, "File Upload {0}");
        messageSource.addMessage("session.file.upload.title", Locale.SIMPLIFIED_CHINESE, "文件上传 {0}");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.US);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void summaryRunsOffRequestAndRestoresLocaleAndUser() {
        java.util.List<Runnable> queue = new java.util.ArrayList<>();
        java.util.concurrent.Executor executor = queue::add;
        var broadcast = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(sessionTitleService, "titleExecutor", executor);
        ReflectionTestUtils.setField(sessionTitleService, "broadcastService", broadcast);
        var transactions = org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class);
        ReflectionTestUtils.setField(sessionTitleService, "transactionManager", transactions);
        when(sessionExtService.deleteBySessionIdAndParamCode(10L, SessionTitleService.SUMMARY_PENDING_CODE))
            .thenReturn(1);
        when(byaiSessionMapper.update(any(ByaiSession.class), any(com.baomidou.mybatisplus.core.conditions.Wrapper.class)))
            .thenReturn(1);
        java.util.concurrent.atomic.AtomicBoolean generated = new java.util.concurrent.atomic.AtomicBoolean();
        sessionTitleService.summarizeAsync(10L, "Local title", () -> {
            assertThat(CurrentUserHolder.getCurrentUserId()).isEqualTo(100L);
            assertThat(LocaleContextHolder.getLocale()).isEqualTo(Locale.US);
            generated.set(true);
            return "Generated title";
        });
        assertThat(generated).isFalse();
        assertThat(queue).hasSize(1);
        CurrentUserHolder.clearLoginInfo();
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
        queue.getFirst().run();
        assertThat(generated).isTrue();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        assertThat(LocaleContextHolder.getLocale()).isEqualTo(Locale.SIMPLIFIED_CHINESE);
        ArgumentCaptor<String> data = ArgumentCaptor.forClass(String.class);
        verify(broadcast).broadcastToUserDevices(eq(100L), eq(10L), eq("sessionTitleUpdated"),
            data.capture(), org.mockito.ArgumentMatchers.isNull());
        assertThat(com.alibaba.fastjson.JSON.parseObject(data.getValue()).getString("sessionName"))
            .isEqualTo("Generated title");
    }

    @Test
    void removedSummaryMarkerDoesNotPublishOrOverwriteManualTitle() {
        java.util.List<Runnable> queue = new java.util.ArrayList<>();
        ReflectionTestUtils.setField(sessionTitleService, "titleExecutor", (java.util.concurrent.Executor) queue::add);
        var broadcast = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(sessionTitleService, "broadcastService", broadcast);
        ReflectionTestUtils.setField(sessionTitleService, "transactionManager",
            org.mockito.Mockito.mock(org.springframework.transaction.PlatformTransactionManager.class));
        sessionTitleService.summarizeAsync(10L, "Local title", () -> "Late generated title");
        sessionTitleService.cancelInitialTitle(10L);
        queue.getFirst().run();
        verify(sessionExtService, org.mockito.Mockito.atLeastOnce()).deleteBySessionIdAndParamCode(10L,
            SessionTitleService.SUMMARY_PENDING_CODE);
        org.mockito.Mockito.verifyNoInteractions(broadcast, byaiSessionMapper);
    }

    @Test
    void rejectedSummaryDoesNotRunModelOnCaller() {
        ReflectionTestUtils.setField(sessionTitleService, "titleExecutor", (java.util.concurrent.Executor) task -> {
            throw new java.util.concurrent.RejectedExecutionException("full");
        });
        sessionTitleService.summarizeAsync(10L, "Local title", () -> { throw new AssertionError("Model ran on caller"); });
        verify(sessionExtService).deleteBySessionIdAndParamCode(10L, SessionTitleService.SUMMARY_PENDING_CODE);
    }

    @Test
    void summaryWaitsForCommitAndIsNotSubmittedOnRollback() {
        java.util.List<Runnable> queue = new java.util.ArrayList<>();
        ReflectionTestUtils.setField(sessionTitleService, "titleExecutor", (java.util.concurrent.Executor) queue::add);
        org.springframework.transaction.support.TransactionSynchronizationManager.initSynchronization();
        org.springframework.transaction.support.TransactionSynchronizationManager.setActualTransactionActive(true);
        try {
            sessionTitleService.summarizeAsync(10L, "Local title", () -> "title");
            assertThat(queue).isEmpty();
            var callbacks = org.springframework.transaction.support.TransactionSynchronizationManager.getSynchronizations();
            callbacks.forEach(callback -> callback.afterCompletion(
                org.springframework.transaction.support.TransactionSynchronization.STATUS_ROLLED_BACK));
            assertThat(queue).isEmpty();
        }
        finally {
            org.springframework.transaction.support.TransactionSynchronizationManager.clearSynchronization();
            org.springframework.transaction.support.TransactionSynchronizationManager.setActualTransactionActive(false);
        }
    }

    @Test
    void summaryFailureLeavesFallbackAndRestoresContext() {
        java.util.List<Runnable> queue = new java.util.ArrayList<>();
        ReflectionTestUtils.setField(sessionTitleService, "titleExecutor", (java.util.concurrent.Executor) queue::add);
        sessionTitleService.summarizeAsync(10L, "Local title", () -> { throw new IllegalStateException("model unavailable"); });
        CurrentUserHolder.clearLoginInfo();
        queue.getFirst().run();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(byaiSessionMapper, never()).updateSessionNameWhenExtExists(any(), any(), any(), any(), any());
        verify(sessionExtService).deleteBySessionIdAndParamCode(10L, SessionTitleService.SUMMARY_PENDING_CODE);
    }

    @Test
    void buildFileUploadTitle_includesFullDateTime() {
        Date date = DateUtils.parseStrToDate("2026-08-11 14:30:25", DateUtils.DATE_TIME_FORMAT);

        assertThat(sessionTitleService.buildFileUploadTitle(date)).isEqualTo("File Upload 2026-08-11 14:30:25");
    }

    @Test
    void markInitialTitlePending_savesSessionExtension() {
        when(sequenceService.nextVal()).thenReturn(99L);

        sessionTitleService.markInitialTitlePending(10L);

        ArgumentCaptor<ByaiSessionExt> captor = ArgumentCaptor.forClass(ByaiSessionExt.class);
        verify(sessionExtService).save(captor.capture());
        ByaiSessionExt saved = captor.getValue();
        assertThat(saved.getExtId()).isEqualTo(99L);
        assertThat(saved.getSessionId()).isEqualTo(10L);
        assertThat(saved.getExtParamCode()).isEqualTo(SessionTitleService.INITIAL_TITLE_PENDING_CODE);
        assertThat(saved.getExtParamValue()).isEqualTo("1");
    }

    @Test
    void resolveInitialTitle_usesFirstNonBlankUserTextAndClearsPendingState() {
        when(byaiSessionMapper.updateSessionNameWhenExtExists(eq(10L), eq("请分析这个文件中的风"),
            eq(SessionTitleService.INITIAL_TITLE_PENDING_CODE), eq(100L), any(Date.class))).thenReturn(1);

        ByaiSession updated = sessionTitleService.resolveInitialTitle(10L, " {{agent}} 请分析这个文件中的风险 ");

        assertThat(updated).isNotNull();
        assertThat(updated.getSessionName()).isEqualTo("请分析这个文件中的风");
        verify(sessionExtService).deleteBySessionIdAndParamCode(10L,
            SessionTitleService.INITIAL_TITLE_PENDING_CODE);
    }

    @Test
    void resolveInitialTitle_keepsPendingStateWhenMessageHasNoUsableText() {
        ByaiSession updated = sessionTitleService.resolveInitialTitle(10L, " {{agent}} ");

        assertThat(updated).isNull();
        verify(byaiSessionMapper, never()).updateSessionNameWhenExtExists(any(), any(), any(), any(), any());
        verify(sessionExtService, never()).deleteBySessionIdAndParamCode(any(), any());
    }

    @Test
    void resolveInitialTitle_doesNotOverwriteWhenPendingStateWasCleared() {
        when(byaiSessionMapper.updateSessionNameWhenExtExists(eq(10L), eq("第一条用户文字"),
            eq(SessionTitleService.INITIAL_TITLE_PENDING_CODE), eq(100L), any(Date.class))).thenReturn(0);

        ByaiSession updated = sessionTitleService.resolveInitialTitle(10L, "第一条用户文字");

        assertThat(updated).isNull();
        verify(sessionExtService, never()).deleteBySessionIdAndParamCode(any(), any());
    }

    @Test
    void cancelInitialTitle_clearsPendingStateForManualRename() {
        sessionTitleService.cancelInitialTitle(10L);

        verify(sessionExtService).deleteBySessionIdAndParamCode(10L,
            SessionTitleService.INITIAL_TITLE_PENDING_CODE);
    }
}
