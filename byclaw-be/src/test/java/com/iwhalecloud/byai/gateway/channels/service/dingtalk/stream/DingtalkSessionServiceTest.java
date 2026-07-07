package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DingtalkSessionServiceTest {

    private final SessionService sessionService = mock(SessionService.class);
    private final SessionExtService sessionExtService = mock(SessionExtService.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final DingtalkSessionService service = new DingtalkSessionService(
            sessionService,
            sessionExtService,
            sequenceService
    );

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolveSessionId_returnsExistingSessionIdWhenExtExists() {
        ByaiSessionExt ext = new ByaiSessionExt();
        ext.setSessionId(1001L);
        when(sessionExtService.selectByParamCodeAndValue("dingtalkConversationId", "conversation-001"))
                .thenReturn(ext);

        Long sessionId = service.resolveSessionId("hello", "conversation-001", 2001L);

        assertThat(sessionId).isEqualTo(1001L);
        verify(sessionService, never()).save(any());
        verify(sequenceService, never()).nextVal();
    }

    @Test
    void resolveSessionId_createsSessionAndExtWhenExtMissing() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(3001L);
        loginInfo.setEnterpriseId(4001L);
        CurrentUserHolder.setLoginInfo(loginInfo);
        when(sessionExtService.selectByParamCodeAndValue("dingtalkConversationId", "conversation-002"))
                .thenReturn(null);
        when(sequenceService.nextVal()).thenReturn(5001L, 5002L);

        Long sessionId = service.resolveSessionId("user text", "conversation-002", 6001L);

        assertThat(sessionId).isEqualTo(5001L);

        ArgumentCaptor<ByaiSession> sessionCaptor = ArgumentCaptor.forClass(ByaiSession.class);
        verify(sessionService).save(sessionCaptor.capture());
        ByaiSession session = sessionCaptor.getValue();
        assertThat(session.getSessionId()).isEqualTo(5001L);
        assertThat(session.getSessionName()).isEqualTo("user text");
        assertThat(session.getSessionContent()).isEqualTo("user text");
        assertThat(session.getObjectId()).isEqualTo(6001L);
        assertThat(session.getObjectType()).isEqualTo(ConversationObjectType.DIGITAL_EMPLOYEES);
        assertThat(session.getSessionType()).isEqualTo(SessionType.H_AS.getCode());
        assertThat(session.getIsDebug()).isZero();
        assertThat(session.getCreatorId()).isEqualTo(3001L);
        assertThat(session.getEnterpriseId()).isEqualTo(4001L);
        assertThat(session.getCreateTime()).isNotNull();

        ArgumentCaptor<ByaiSessionExt> extCaptor = ArgumentCaptor.forClass(ByaiSessionExt.class);
        verify(sessionExtService).save(extCaptor.capture());
        ByaiSessionExt ext = extCaptor.getValue();
        assertThat(ext.getExtId()).isEqualTo(5002L);
        assertThat(ext.getSessionId()).isEqualTo(5001L);
        assertThat(ext.getExtParamName()).isEqualTo("钉钉会话ID");
        assertThat(ext.getExtParamCode()).isEqualTo("dingtalkConversationId");
        assertThat(ext.getExtParamValue()).isEqualTo("conversation-002");
    }
}
