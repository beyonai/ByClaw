package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatInternalSessionAccess;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.interfaces.controller.chat.AssistantChatController;

class GroupChatInternalSessionAccessTest {
    @Test
    void internalHistoryIsRejectedBeforeReadingMessages() {
        SessionService sessions = mock(SessionService.class);
        ByaiMessageHotService messages = mock(ByaiMessageHotService.class);
        MessageService service = new MessageService();
        ReflectionTestUtils.setField(service, "sessionService", sessions);
        ReflectionTestUtils.setField(service, "byaiMessageHotService", messages);
        when(sessions.findById(12L)).thenReturn(session("GROUP_CHAT_ROUTING"));
        MessageQo query = new MessageQo();
        query.setSessionId(12L);
        assertThatThrownBy(() -> service.getMessages(query)).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> service.getConversationOutline(query)).isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(messages);
    }

    @Test
    void internalRuntimeIsHiddenEvenFromOwnerButBusinessSessionsRemainAccessible() {
        AssistantChatController controller = new AssistantChatController();
        assertThat((Boolean) ReflectionTestUtils.invokeMethod(controller, "isCurrentUserSession",
            session("GROUP_CHAT_ROUTING"), 7L)).isFalse();
        for (String state : new String[] {"GROUP_TASK_CANDIDATE", "GROUP_TASK", "GROUP_CHAT_DISPATCH"}) {
            ByaiSession session = session(state);
            GroupChatInternalSessionAccess.requirePublic(session);
            assertThat((Boolean) ReflectionTestUtils.invokeMethod(controller, "isCurrentUserSession", session, 7L))
                .isTrue();
        }
    }

    @Test
    void publicSendCannotStartAnAssessmentSession() {
        AssistantChatService service = new AssistantChatService();
        SessionService sessions = mock(SessionService.class);
        ReflectionTestUtils.setField(service, "sessionService", sessions);
        when(sessions.findById(12L)).thenReturn(session("GROUP_CHAT_ROUTING"));
        AssistantChatDto input = new AssistantChatDto();
        input.setSessionId(12L);
        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "handleSessionLogic", null, input))
            .isInstanceOf(ResponseStatusException.class);
    }

    private ByaiSession session(String state) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(12L);
        session.setCreatorId(7L);
        session.setState(state);
        return session;
    }
}
