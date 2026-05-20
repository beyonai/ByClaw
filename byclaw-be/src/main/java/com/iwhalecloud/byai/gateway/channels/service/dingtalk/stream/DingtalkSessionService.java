package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import java.util.Date;

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

@Service
public class DingtalkSessionService {

    private static final String EXT_CODE_PREFIX = "dingtalkConversationId";
    private static final String EXT_PARAM_NAME = "钉钉会话ID";

    private final SessionService sessionService;
    private final SessionExtService sessionExtService;
    private final SequenceService sequenceService;

    public DingtalkSessionService(
            SessionService sessionService,
            SessionExtService sessionExtService,
            SequenceService sequenceService
    ) {
        this.sessionService = sessionService;
        this.sessionExtService = sessionExtService;
        this.sequenceService = sequenceService;
    }

    @Transactional
    public Long resolveSessionId(String userText, String sessionExtValue, Long agentId) {
        ByaiSessionExt sessionExt = sessionExtService.selectByParamCodeAndValue(EXT_CODE_PREFIX, sessionExtValue);
        if (sessionExt != null) {
            return sessionExt.getSessionId();
        }
        ByaiSession session = createSession(userText, sessionExtValue, agentId);
        return session.getSessionId();
    }

    private ByaiSession createSession(String userText, String sessionExtValue, Long agentId) {
        Long sessionId = sequenceService.nextVal();
        Date createTime = new Date();

        ByaiSession session = new ByaiSession();
        session.setSessionName(userText);
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
        ext.setExtParamValue(sessionExtValue);
        sessionExtService.save(ext);

        return session;
    }
}
