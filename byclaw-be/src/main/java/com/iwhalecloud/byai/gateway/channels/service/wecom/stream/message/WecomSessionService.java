package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.message;

import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;

/**
 * Resolves/creates a {@link ByaiSession} for WeCom, mirroring
 * {@code DingtalkSessionService} but with a WeCom-specific ext dimension
 * ({@code wecomConversationId}) so it never collides with the DingTalk ext key.
 *
 * <p>Session keys (plan §7.4):
 * <ul>
 *   <li>single: {@code wecom:user:{userId}:bot:{botId}}</li>
 *   <li>group:  {@code wecom:chat:{chatId}:user:{userId}:bot:{botId}}</li>
 * </ul>
 * {@code chatId} is only present for group chats.
 *
 * <p>{@link #resolveSessionId} reads {@link CurrentUserHolder} for creator +
 * enterprise, so the caller MUST have set the login (via
 * {@link WecomUserService#resolveLoginInfo}) on this thread first.
 */
@Service
public class WecomSessionService {

    private static final String EXT_CODE_PREFIX = "wecomConversationId";
    private static final String EXT_PARAM_NAME = "企业微信会话ID";

    private final SessionService sessionService;
    private final SessionExtService sessionExtService;
    private final SequenceService sequenceService;

    public WecomSessionService(SessionService sessionService,
                               SessionExtService sessionExtService,
                               SequenceService sequenceService) {
        this.sessionService = sessionService;
        this.sessionExtService = sessionExtService;
        this.sequenceService = sequenceService;
    }

    /** Deterministic WeCom session key: single vs group dimensions. */
    public String buildSessionKey(String botId, String userId, String chatId, boolean group) {
        if (group) {
            return "wecom:chat:" + nz(chatId) + ":user:" + nz(userId) + ":bot:" + nz(botId);
        }
        return "wecom:user:" + nz(userId) + ":bot:" + nz(botId);
    }

    @Transactional
    public Long resolveSessionId(String userText, String sessionKey, Long agentId) {
        ByaiSessionExt sessionExt = sessionExtService.selectByParamCodeAndValue(EXT_CODE_PREFIX, sessionKey);
        if (sessionExt != null) {
            return sessionExt.getSessionId();
        }
        return createSession(userText, sessionKey, agentId).getSessionId();
    }

    private ByaiSession createSession(String userText, String sessionKey, Long agentId) {
        Long sessionId = sequenceService.nextVal();
        Date createTime = new Date();

        ByaiSession session = new ByaiSession();
        String sessionName = userText != null && userText.length() > 200 ? userText.substring(0, 200) : userText;
        session.setSessionName(sessionName);
        session.setSessionContent(userText);
        session.setCreateTime(createTime);
        session.setObjectId(agentId);
        session.setObjectType(ConversationObjectType.DIGITAL_EMPLOYEES);
        session.setSessionType(SessionType.H_AS.getCode());
        session.setSessionId(sessionId);
        session.setIsDebug(0);
        session.setCreatorId(CurrentUserHolder.getCurrentUserId());
        session.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        sessionService.save(session);

        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setExtId(sequenceService.nextVal());
        ext.setSessionId(sessionId);
        ext.setExtParamName(EXT_PARAM_NAME);
        ext.setExtParamCode(EXT_CODE_PREFIX);
        ext.setExtParamValue(sessionKey);
        sessionExtService.save(ext);

        return session;
    }

    private String nz(String v) {
        return v == null ? "" : v;
    }
}
