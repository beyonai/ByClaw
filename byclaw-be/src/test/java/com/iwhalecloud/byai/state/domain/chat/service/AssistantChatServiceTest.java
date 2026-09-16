package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import com.iwhalecloud.byai.state.domain.chat.spi.PendingTaskConfirmHook;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskChatGuard;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

@ExtendWith(MockitoExtension.class)
class AssistantChatServiceTest {

    @InjectMocks
    private AssistantChatService assistantChatService;

    @Mock
    private SessionTitleService sessionTitleService;

    @Mock
    private SessionService sessionService;

    @Test
    void handleSessionLogic_emitsTitleUpdateForFirstUserText() {
        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setSessionId(10L);
        assistantChatDto.setSessionType(SessionType.H_AS.getCode());
        assistantChatDto.setChatContent("请分析这个文件");
        ByaiSession updatedSession = new ByaiSession();
        updatedSession.setSessionId(10L);
        updatedSession.setSessionName("请分析这个文件");
        when(sessionService.findById(10L)).thenReturn(updatedSession);
        when(sessionTitleService.resolveInitialTitle(10L, "请分析这个文件")).thenReturn(updatedSession);
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();

        ReflectionTestUtils.invokeMethod(assistantChatService, "handleSessionLogic", outputStream, assistantChatDto);

        verify(sessionTitleService).resolveInitialTitle(10L, "请分析这个文件");
        String eventPayload = outputStream.toString(StandardCharsets.UTF_8);
        assertThat(eventPayload).contains("\"event\":\"sessionTitleUpdated\"");
        assertThat(eventPayload).contains("\"sessionName\":\"请分析这个文件\"");
    }
    @Test
    void failedHistoryPreparationReportsRetryAndReleasesPrivateTaskTurn() {
        AssistantChatDto dto = new AssistantChatDto();
        dto.setSessionId(60L);
        dto.setSessionType(SessionType.H_AS.getCode());
        dto.setAgentId(40L);
        dto.setChatContent("继续任务");
        TargetAgentResolver resolver = mock(TargetAgentResolver.class);
        when(resolver.resolveAgentId(dto)).thenReturn(41L);
        GroupChatTaskChatGuard guard = mock(GroupChatTaskChatGuard.class);
        when(guard.beforeTurn(60L, 41L)).thenReturn(true);
        @SuppressWarnings("unchecked")
        ObjectProvider<GroupChatTaskChatGuard> guards = mock(ObjectProvider.class);
        when(guards.getIfAvailable()).thenReturn(guard);
        @SuppressWarnings("unchecked")
        ObjectProvider<PendingTaskConfirmHook> hooks = mock(ObjectProvider.class);
        ScriptService script = mock(ScriptService.class);
        ChatTurnPreparationException failure = new ChatTurnPreparationException(
            "历史上下文准备失败，请重试", new IllegalStateException("UserFS unavailable"));
        doThrow(new BdpRuntimeException(failure.getMessage(), failure))
            .when(script).executeAssistantChat(any(), eq(dto), anyLong());
        ReflectionTestUtils.setField(assistantChatService, "targetAgentResolver", resolver);
        ReflectionTestUtils.setField(assistantChatService, "groupChatTaskGuardProvider", guards);
        ReflectionTestUtils.setField(assistantChatService, "pendingTaskConfirmHookProvider", hooks);
        ReflectionTestUtils.setField(assistantChatService, "scriptService", script);
        ByteArrayOutputStream output = new ByteArrayOutputStream();

        assertThatThrownBy(() -> assistantChatService.chat(dto, output, null))
            .isInstanceOf(BdpRuntimeException.class).hasCause(failure);

        verify(guard).beforeTurn(60L, 41L);
        verify(guard).afterTurn(60L, false);
        assertThat(output.toString(StandardCharsets.UTF_8)).contains("error", "历史上下文准备失败，请重试");
    }

}
