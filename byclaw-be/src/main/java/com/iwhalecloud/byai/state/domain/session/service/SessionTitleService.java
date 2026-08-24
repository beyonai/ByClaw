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
    }

    private String normalizeChatContent(String chatContent) {
        return StringUtils.trimToEmpty(chatContent).replaceAll("\\{\\{[^}]*+\\}\\}", "").trim();
    }
}
