package com.iwhalecloud.byai.state.application.service.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.message.model.SessionOpeartorDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class SessionApplicationServiceTest {

    @Mock
    private SessionService sessionService;

    @Mock
    private SessionTitleService sessionTitleService;

    private SessionApplicationService sessionApplicationService;

    @BeforeEach
    void setUp() {
        sessionApplicationService = new SessionApplicationService();
        ReflectionTestUtils.setField(sessionApplicationService, "sessionService", sessionService);
        ReflectionTestUtils.setField(sessionApplicationService, "sessionTitleService", sessionTitleService);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void updateConversationSkipsDatabaseUpdateWhenNoFieldsCanBeUpdated() {
        SessionOpeartorDto dto = new SessionOpeartorDto();
        dto.setSessionId(100L);
        dto.setSessionContent("");

        ByaiSession result = sessionApplicationService.updateConversation(dto);

        assertEquals(100L, result.getSessionId());
        assertNull(result.getSessionContent());
        assertNull(result.getEnterpriseId());
        verify(sessionService, never()).update(org.mockito.ArgumentMatchers.any(ByaiSession.class));
    }

    @Test
    void updateConversationUpdatesWhenSessionContentIsPresent() {
        SessionOpeartorDto dto = new SessionOpeartorDto();
        dto.setSessionId(100L);
        dto.setSessionContent("answer");

        sessionApplicationService.updateConversation(dto);

        ArgumentCaptor<ByaiSession> captor = ArgumentCaptor.forClass(ByaiSession.class);
        verify(sessionService).update(captor.capture());
        assertEquals(100L, captor.getValue().getSessionId());
        assertEquals("answer", captor.getValue().getSessionContent());
    }

    @Test
    void updateConversation_cancelsAutomaticTitleForManualRename() {
        SessionOpeartorDto request = new SessionOpeartorDto();
        request.setSessionId(10L);
        request.setSessionName("手工标题");

        sessionApplicationService.updateConversation(request);

        verify(sessionTitleService).cancelInitialTitle(10L);
        ArgumentCaptor<ByaiSession> captor = ArgumentCaptor.forClass(ByaiSession.class);
        verify(sessionService).update(captor.capture());
        assertThat(captor.getValue().getSessionName()).isEqualTo("手工标题");
    }

    @Test
    void updateConversation_keepsAutomaticTitlePendingForContentOnlyUpdate() {
        SessionOpeartorDto request = new SessionOpeartorDto();
        request.setSessionId(10L);
        request.setSessionContent("最新回复");

        sessionApplicationService.updateConversation(request);

        verify(sessionTitleService, never()).cancelInitialTitle(10L);
    }
}
