package com.iwhalecloud.byai.state.domain.session.service;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import java.util.Date;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import java.util.function.Supplier;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

/**
 * 管理会话的自动标题。
 *
 * @author qin.guoquan
 * @date 2026-08-11 18:00:38
 */
@Service
public class SessionTitleService {
    private static final org.slf4j.Logger log = org.slf4j.LoggerFactory.getLogger(SessionTitleService.class);
    public static final String SUMMARY_PENDING_CODE = "summary_title_pending";

    @Autowired
    @Qualifier("sessionTitleExecutor")
    private Executor titleExecutor;

    @Autowired
    private MultiDeviceBroadcastService broadcastService;

    @Autowired
    private PlatformTransactionManager transactionManager;


    public static final String INITIAL_TITLE_PENDING_CODE = "initial_title_pending";

    private static final String INITIAL_TITLE_PENDING_NAME = "Initial Title Pending";

    private static final String INITIAL_TITLE_PENDING_VALUE = "1";

    private static final int AUTO_TITLE_MAX_LENGTH = 10;

    private final ByaiSessionMapper byaiSessionMapper;

    private final SessionExtService sessionExtService;

    private final SequenceService sequenceService;

    public SessionTitleService(ByaiSessionMapper byaiSessionMapper, SessionExtService sessionExtService,
        SequenceService sequenceService) {
        this.byaiSessionMapper = byaiSessionMapper;
        this.sessionExtService = sessionExtService;
        this.sequenceService = sequenceService;
    }

    /**
     * 生成仅上传附件时使用的临时会话标题。
     *
     * @param date 会话创建时间
     * @return 临时会话标题
     */
    public String buildFileUploadTitle(Date date) {
        return I18nUtil.get("session.file.upload.title", DateUtils.getFormatedDateTime(date));
    }

    /**
     * 标记会话仍需由第一条非空用户文字生成标题。
     *
     * @param sessionId 会话标识
     */
    public void markInitialTitlePending(Long sessionId) {
        ByaiSessionExt pendingExt = new ByaiSessionExt();
        pendingExt.setExtId(sequenceService.nextVal());
        pendingExt.setSessionId(sessionId);
        pendingExt.setExtParamName(INITIAL_TITLE_PENDING_NAME);
        pendingExt.setExtParamCode(INITIAL_TITLE_PENDING_CODE);
        pendingExt.setExtParamValue(INITIAL_TITLE_PENDING_VALUE);
        sessionExtService.save(pendingExt);
    }

    /**
     * 使用第一条非空用户文字更新待命名会话。只有待命名状态仍存在时才会更新，避免覆盖手工标题。
     *
     * @param sessionId 会话标识
     * @param chatContent 用户输入
     * @return 已更新的会话；无需更新时返回 {@code null}
     */
    public ByaiSession resolveInitialTitle(Long sessionId, String chatContent) {
        String normalizedContent = normalizeChatContent(chatContent);
        if (StringUtils.isBlank(normalizedContent)) {
            return null;
        }

        String sessionName = ChatUtils.truncateString(normalizedContent, AUTO_TITLE_MAX_LENGTH);
        Date updateTime = new Date();
        int updated = byaiSessionMapper.updateSessionNameWhenExtExists(sessionId, sessionName,
            INITIAL_TITLE_PENDING_CODE, CurrentUserHolder.getCurrentUserId(), updateTime);
        if (updated <= 0) {
            return null;
        }

        sessionExtService.deleteBySessionIdAndParamCode(sessionId, INITIAL_TITLE_PENDING_CODE);

        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setSessionName(sessionName);
        session.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        session.setUpdateTime(updateTime);
        return session;
    }

    /**
     * 取消自动标题，供用户手工重命名时调用。
     *
     * @param sessionId 会话标识
     */
    public void cancelInitialTitle(Long sessionId) {
        sessionExtService.deleteBySessionIdAndParamCode(sessionId, INITIAL_TITLE_PENDING_CODE);
        sessionExtService.deleteBySessionIdAndParamCode(sessionId, SUMMARY_PENDING_CODE);
    }

    /** Persist before publishing createSession, so a later manual rename can cancel the summary. */
    public void markSummaryPending(Long sessionId) {
        try {
            ByaiSessionExt pending = new ByaiSessionExt();
            pending.setExtId(sequenceService.nextVal());
            pending.setSessionId(sessionId);
            pending.setExtParamCode(SUMMARY_PENDING_CODE);
            pending.setExtParamName("Summary Title Pending");
            pending.setExtParamValue("1");
            sessionExtService.save(pending);
        }
        catch (RuntimeException error) {
            log.warn("Could not schedule session title, sessionId={}", sessionId);
        }
    }

    /** Return immediately; retain the local title on overload, model failure or a process restart. */
    public void summarizeAsync(Long sessionId, String initialTitle, Supplier<String> generate) {
        LoginInfo login = CurrentUserHolder.getLoginInfo();
        LocaleContext locale = LocaleContextHolder.getLocaleContext();
        Runnable submit = () -> {
            try {
                titleExecutor.execute(() -> {
                    LoginInfo previousLogin = CurrentUserHolder.getLoginInfo();
                    LocaleContext previousLocale = LocaleContextHolder.getLocaleContext();
                    try {
                        CurrentUserHolder.setLoginInfo(login);
                        LocaleContextHolder.setLocaleContext(locale);
                        String title = StringUtils.substring(StringUtils.trimToEmpty(generate.get()), 0, 255);
                        if (StringUtils.isBlank(title)) return;
                        Date now = new Date();
                        Long userId = login == null ? null : login.getUserId();
                        if (userId == null) return;
                        ByaiSession update = new ByaiSession();
                        update.setSessionId(sessionId);
                        update.setSessionName(title);
                        update.setUpdateBy(userId);
                        update.setUpdateTime(now);
                        // Claim the marker and update the title in one transaction. A concurrent manual
                        // rename waits for this DELETE, then writes its own title after we commit.
                        Boolean changed = new TransactionTemplate(transactionManager).execute(status -> {
                            if (sessionExtService.deleteBySessionIdAndParamCode(sessionId, SUMMARY_PENDING_CODE) <= 0) {
                                return false;
                            }
                            // Session state is nullable JSON/text, not an active/deleted flag.
                            // Deleted sessions have no row; ownership still fences the update.
                            return byaiSessionMapper.update(update, new LambdaUpdateWrapper<ByaiSession>()
                                .eq(ByaiSession::getSessionId, sessionId)
                                .eq(ByaiSession::getCreatorId, userId)) > 0;
                        });
                        if (Boolean.TRUE.equals(changed)) {
                            var event = (com.alibaba.fastjson.JSONObject) JSON.toJSON(update);
                            event.put("previousSessionName", initialTitle);
                            broadcastService.broadcastToUserDevices(userId, sessionId,
                                SseResponseEventEnum.sessionTitleUpdated, event.toJSONString(), null);
                        }
                    }
                    catch (RuntimeException error) {
                        log.warn("Session title enrichment failed, sessionId={}", sessionId);
                    }
                    finally {
                        clearSummaryPending(sessionId);
                        if (previousLogin == null) CurrentUserHolder.clearLoginInfo();
                        else CurrentUserHolder.setLoginInfo(previousLogin);
                        LocaleContextHolder.setLocaleContext(previousLocale);
                    }
                });
            }
            catch (RejectedExecutionException error) {
                clearSummaryPending(sessionId);
                log.debug("Session title queue full, retaining local title, sessionId={}", sessionId);
            }
        };
        if (TransactionSynchronizationManager.isSynchronizationActive()
            && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() { submit.run(); }
            });
        }
        else submit.run();
    }

    private void clearSummaryPending(Long sessionId) {
        try {
            sessionExtService.deleteBySessionIdAndParamCode(sessionId, SUMMARY_PENDING_CODE);
        }
        catch (RuntimeException error) {
            log.warn("Could not clear session title marker, sessionId={}", sessionId);
        }
    }

    private String normalizeChatContent(String chatContent) {
        return StringUtils.trimToEmpty(chatContent).replaceAll("\\{\\{[^}]*+\\}\\}", "").trim();
    }
}
