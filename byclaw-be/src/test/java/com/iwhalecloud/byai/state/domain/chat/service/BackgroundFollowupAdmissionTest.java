package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;

class BackgroundFollowupAdmissionTest {
    @Test
    void idleRootAcceptsNewMessageWhileBackgroundAgentsKeepWorking() {
        RunningChatInfo running = running(false, true);
        ChatProcessContext ctx = context(null);
        assertThatCode(() -> admit(ctx, running)).doesNotThrowAnyException();
        assertThat(ctx.concurrentGatewayTurn).isTrue();
        assertThat(ctx.continueRunningTrace).isFalse();
        assertThat(ctx.sendByFrameworkMsgOnly).isFalse();
        assertThat(ctx.modelAnswerMessageId).isNull();
    }

    @Test
    void activeCaptainAndUnknownInputStateStillRejectIndependentRequests() {
        assertThatThrownBy(() -> admit(context(null), running(true, false)))
            .hasMessageContaining("当前会话仍在运行中");
        assertThatThrownBy(() -> admit(context(null), running(false, null)))
            .hasMessageContaining("当前会话仍在运行中");
    }

    @Test
    void matchingTraceStillUsesTheExistingInteractionContinuation() {
        ChatProcessContext ctx = context("original");
        admit(ctx, running(false, true));
        assertThat(ctx.continueRunningTrace).isTrue();
        assertThat(ctx.sendByFrameworkMsgOnly).isTrue();
        assertThat(ctx.modelAnswerMessageId).isEqualTo(12L);
    }

    private ChatProcessContext context(String trace) {
        AssistantChatDto dto = new AssistantChatDto();
        dto.setTraceId(trace);
        ChatProcessContext ctx = new ChatProcessContext(null, dto);
        ctx.sessionId = 10L;
        return ctx;
    }

    private RunningChatInfo running(Boolean rootActive, Boolean acceptingInput) {
        RunningChatInfo running = new RunningChatInfo();
        running.setRunning(true);
        running.setRuntimeSource("test-runtime");
        running.setRootActive(rootActive);
        running.setAcceptingInput(acceptingInput);
        running.setActiveChildCount(4L);
        running.setTraceId("original");
        running.setUserMessageId(11L);
        running.setModelAnswerMessageId(12L);
        return running;
    }

    private void admit(ChatProcessContext ctx, RunningChatInfo running) {
        ScriptService service = new ScriptService();
        RunningOutputStreamRegistry registry = mock(RunningOutputStreamRegistry.class);
        ReflectionTestUtils.setField(service, "runningOutputStreamRegistry", registry);
        when(registry.getRunning(10L)).thenReturn(running);
        ReflectionTestUtils.invokeMethod(service, "resolveRunningTraceState", ctx);
    }
}
