package com.iwhalecloud.byai.state.domain.chat.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskChatGuard;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** 在真实参数准备入口验证原聊天准入先于群任务登记，避免拒绝新输入时覆盖旧轮次。 */
class ScriptTaskTurnAdmissionTest extends I18nTestSupport {
    private final ScriptService script = new ScriptService();
    private final RunningOutputStreamRegistry registry = mock(RunningOutputStreamRegistry.class);
    private final GroupChatTaskChatGuard guard = mock(GroupChatTaskChatGuard.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final RuntimeException reachedMessagePreparation = new RuntimeException("message preparation boundary");
    private ChatProcessContext context;
    private RunningChatInfo running;

    @BeforeEach
    void setUp() {
        @SuppressWarnings("unchecked")
        ObjectProvider<GroupChatTaskChatGuard> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(guard);
        ReflectionTestUtils.setField(script, "groupChatTaskGuardProvider", provider);
        ReflectionTestUtils.setField(script, "runningOutputStreamRegistry", registry);
        ReflectionTestUtils.setField(script, "sequenceService", sequence);
        // 准入后停止在消息 ID 生成处，使测试不依赖后续持久化或 Gateway。
        when(sequence.nextVal()).thenThrow(reachedMessagePreparation);
        when(guard.beforeTurn(60L, 40L, null)).thenReturn(101L);
        AssistantChatDto dto = new AssistantChatDto();
        dto.setSessionId(60L);
        dto.setAgentId(40L);
        context = new ChatProcessContext(null, dto);
        running = new RunningChatInfo();
        running.setRunning(false);
        when(registry.getRunning(60L)).thenReturn(running);
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void acceptedInputRegistersTaskTurnAfterOrdinaryAdmission(boolean backgroundRunning) {
        running.setRunning(backgroundRunning);
        running.setRootActive(false);
        running.setAcceptingInput(true);
        assertThatThrownBy(() -> script.prepareParams(context)).isSameAs(reachedMessagePreparation);
        var order = org.mockito.Mockito.inOrder(registry, guard, sequence);
        order.verify(registry).getRunning(60L);
        order.verify(guard).beforeTurn(60L, 40L, null);
        order.verify(sequence).nextVal();
        assertThat(context.assistantChatDto.getGroupTaskTurnId()).isEqualTo(101L);
    }

    @Test
    void ordinaryAdmissionRejectionDoesNotRegisterOrFailTaskTurn() {
        running.setRunning(true);
        running.setRootActive(true);
        running.setAcceptingInput(false);
        assertThatThrownBy(() -> script.prepareParams(context)).isInstanceOf(BdpRuntimeException.class);
        verifyNoInteractions(guard, sequence);
        assertThat(context.assistantChatDto.getGroupTaskTurnId()).isNull();
    }

    @Test
    void serverOwnedContinuationKeepsItsIndependentTurnPath() {
        context.existingUserMessage = new ByaiMessageHotDtoDto();
        context.existingUserMessage.setMessageId(61L);
        assertThatThrownBy(() -> script.prepareParams(context)).isSameAs(reachedMessagePreparation);
        verifyNoInteractions(guard);
        verify(sequence).nextVal();
        assertThat(context.assistantChatDto.getGroupTaskTurnId()).isNull();
    }
}
