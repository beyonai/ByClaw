package com.iwhalecloud.byai.state.application.service.session;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class SessionApplicationServiceTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void updateConversationSkipsDatabaseUpdateWhenNoFieldsCanBeUpdated() {
        SessionService sessionService = mock(SessionService.class);
        SessionApplicationService service = new SessionApplicationService();
        ReflectionTestUtils.setField(service, "sessionService", sessionService);

        SessionOpeartorDto dto = new SessionOpeartorDto();
        dto.setSessionId(100L);
        dto.setSessionContent("");

        ByaiSession result = service.updateConversation(dto);

        assertEquals(100L, result.getSessionId());
        assertNull(result.getSessionContent());
        assertNull(result.getEnterpriseId());
        verify(sessionService, never()).update(org.mockito.ArgumentMatchers.any(ByaiSession.class));
    }

    @Test
    void updateConversationUpdatesWhenSessionContentIsPresent() {
        SessionService sessionService = mock(SessionService.class);
        SessionApplicationService service = new SessionApplicationService();
        ReflectionTestUtils.setField(service, "sessionService", sessionService);

        SessionOpeartorDto dto = new SessionOpeartorDto();
        dto.setSessionId(100L);
        dto.setSessionContent("answer");

        service.updateConversation(dto);

        ArgumentCaptor<ByaiSession> captor = ArgumentCaptor.forClass(ByaiSession.class);
        verify(sessionService).update(captor.capture());
        assertEquals(100L, captor.getValue().getSessionId());
        assertEquals("answer", captor.getValue().getSessionContent());
    }
}
