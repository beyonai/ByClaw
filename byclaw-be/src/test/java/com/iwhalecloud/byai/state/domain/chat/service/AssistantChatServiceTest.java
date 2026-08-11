package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;

@ExtendWith(MockitoExtension.class)
class AssistantChatServiceTest {

    @InjectMocks
    private AssistantChatService assistantChatService;

    @Mock
    private SessionTitleService sessionTitleService;

    @Test
    void handleSessionLogic_emitsTitleUpdateForFirstUserText() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setSessionId(10L);
        assistantChatDto.setSessionType(SessionType.H_AS.getCode());
        assistantChatDto.setChatContent("请分析这个文件");
        ByaiSession updatedSession = new ByaiSession();
        updatedSession.setSessionId(10L);
        updatedSession.setSessionName("请分析这个文件");
        when(sessionTitleService.resolveInitialTitle(10L, "请分析这个文件")).thenReturn(updatedSession);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        ReflectionTestUtils.invokeMethod(assistantChatService, "handleSessionLogic", outputStream, assistantChatDto);

        verify(sessionTitleService).resolveInitialTitle(10L, "请分析这个文件");
        String eventPayload = outputStream.toString(StandardCharsets.UTF_8);
        assertThat(eventPayload).contains("\"event\":\"sessionTitleUpdated\"");
        assertThat(eventPayload).contains("\"sessionName\":\"请分析这个文件\"");
    }
}
