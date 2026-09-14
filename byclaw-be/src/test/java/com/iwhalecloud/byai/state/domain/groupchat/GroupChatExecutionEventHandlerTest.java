package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatExecutionEventHandlerTest {
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
    private final GroupChatTaskService tasks = mock(GroupChatTaskService.class);
    private final GroupChatCandidateSessionService candidates = mock(GroupChatCandidateSessionService.class);
    private final GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
    private final GroupChatDispositionReader reader = mock(GroupChatDispositionReader.class);
    private final UserService users = mock(UserService.class);
    private final GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
    private final GroupChatMentionService mentions = mock(GroupChatMentionService.class);
    private final GroupChatExecutionCoordinator coordinator = mock(GroupChatExecutionCoordinator.class);
    private final ChatRuntimeStateService runtime = mock(ChatRuntimeStateService.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messages, publisher,
        sequence, executions, coordinator, mock(SsResourceService.class), users, reader, tasks, candidates,
        parser, mentions, runtime);
    private ByaiGroupChatExecution execution;
    private ByaiMessage answer;

    @BeforeEach
    void setUp() {
        execution = new ByaiGroupChatExecution();
        execution.setExecutionId(6L);
        execution.setCandidateSessionId(60L);
        execution.setGroupSessionId(1L);
        execution.setSourceMessageId(2L);
        execution.setTargetAgentId(4L);
        execution.setInitiatorUserId(7L);
        execution.setStatus("RUNNING");
        execution.setDisposition("TASK");
        execution.setTraceId(TraceIdCodec.encode(20L, 30L));
        when(executions.selectForUpdateByCandidateSessionId(60L)).thenReturn(execution);
        when(sequence.nextVal()).thenReturn(100L);
        when(parser.parse(anyLong(), anyLong(), any())).thenAnswer(call ->
            new GroupChatAgentMention(call.getArgument(2), List.of()));
        Users user = new Users();
        user.setUserCode("user-7");
        when(users.findById(7L)).thenReturn(user);
        answer = new ByaiMessage();
        answer.setMessageId(30L);
        answer.setSessionId(60L);
        answer.setProjectId(9L);
        answer.setUsage(2);
        answer.setIsComplete(true);
        answer.setMessageContent("采集完成");
        when(messages.selectByMessageId(30L)).thenReturn(answer);
    }

    @Test
    void taskUsesExistingPrivateAnswerWithoutInsertingOrBroadcastingItAgain() {
        handler.afterPersisted(context(60L, execution.getTraceId(), 30L));

        verify(messages, never()).insert(any(ByaiMessage.class));
        verify(tasks).updateTurnStatus(60L, "WAITING_USER");
        verify(executions).markSucceeded(eq(6L), eq(30L), any());
        verifyNoInteractions(publisher);
    }

    @Test
    void taskPromotesBeforeAnswerExistsAndContinuesRunning() {
        execution.setDisposition("UNKNOWN");
        when(messages.selectByMessageId(30L)).thenReturn(null);
        GroupChatDisposition disposition = new GroupChatDisposition();
        disposition.setKind("TASK");
        disposition.setTaskName("采集新闻");
        disposition.setAckText("正在采集");
        when(reader.read("user-7", 60L, 6L)).thenReturn(disposition);

        handler.reconcile(60L);

        verify(tasks).promote(execution, "采集新闻", "正在采集");
        verify(tasks, never()).updateTurnStatus(any(), any());
        verify(messages, never()).insert(any(ByaiMessage.class));
    }

    @Test
    void missingFileStaysUnknownWhileRunningAndFallsBackToChatAfterPersistence() {
        execution.setDisposition("UNKNOWN");
        when(messages.selectByMessageId(30L)).thenReturn(null, answer);
        handler.reconcile(60L);
        verify(executions, never()).decideDisposition(any(), any(), any(), any(), any());

        handler.reconcile(60L);

        verify(executions).decideDisposition(eq(6L), eq("CHAT"), isNull(), isNull(), any());
        verify(candidates).hideChatCandidate(60L);
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        assertThat(saved.getValue().getSessionId()).isEqualTo(1L);
        assertThat(saved.getValue().getMessageRef()).isEqualTo(2L);
        assertThat(saved.getValue().getCreatorId()).isEqualTo(4L);
        assertThat(saved.getValue().getMessageContent()).isEqualTo("采集完成");
    }

    @Test
    void chatProjectsOnlyFinalTextSegmentAndKeepsPrivateToolsOutOfGroup() {
        execution.setDisposition("CHAT");
        answer.setMessageContent("正在搜索最终答案");
        answer.setMessageStruct("""
            [{"contentType":"1002","seq":1,"choices":[{"delta":{"content":"正在搜索"}}]},
             {"contentType":"tool_call","seq":2,"choices":[{"delta":{"content":"private tool"}}]},
             {"contentType":"1002","seq":3,"choices":[{"delta":{"content":"最终答案"}}]}]
            """);

        handler.reconcile(60L);

        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        assertThat(saved.getValue().getMessageContent()).isEqualTo("最终答案");
        assertThat(saved.getValue().getMessageStruct()).isNull();
        verify(executions).markSucceeded(eq(6L), eq(100L), any());
        verify(publisher).publish(eq(1L), any(), isNull());
    }

    @Test
    void chatDoesNotPublishIntermediateTextWhenTheTurnEndsAfterReasoning() {
        execution.setDisposition("CHAT");
        answer.setMessageContent("正在搜索");
        answer.setMessageStruct("""
            [{"contentType":"1002","seq":1,"choices":[{"delta":{"content":"正在搜索"}}]}]
            """);
        answer.setInferLog("""
            [{"contentType":"tool_call","seq":2,"choices":[{"delta":{"content":"search"}}]}]
            """);

        handler.reconcile(60L);

        verify(messages, never()).insert(any(ByaiMessage.class));
        verify(executions).markFailed(eq(6L), eq("EMPTY_ANSWER"), any(), any());
    }

    @Test
    void completedInitialTurnDoesNotChangeTaskOrPublishOnReplay() {
        execution.setStatus("SUCCEEDED");
        handler.afterPersisted(context(60L, execution.getTraceId(), 30L));
        handler.reconcile(60L);
        verifyNoInteractions(messages, tasks, publisher);
    }

    @Test
    void neverProjectsAnotherSessionsAnswerOrIncompleteMessage() {
        answer.setSessionId(61L);
        handler.reconcile(60L);
        answer.setSessionId(60L);
        answer.setIsComplete(false);
        answer.setMsgStatus(1);
        handler.reconcile(60L);
        verifyNoInteractions(tasks, publisher);
        verify(executions, never()).markSucceeded(any(), any(), any());
    }

    @Test
    void failedPersistedTurnRemainsFailedAfterRecovery() {
        answer.setMetadata("{\"turnFailed\":true}");
        handler.reconcile(60L);
        verify(tasks).updateTurnStatus(60L, "FAILED");
        verify(executions).markFailed(eq(6L), eq("TURN_FAILED"), any(), any());
        verifyNoInteractions(publisher);
    }

    @Test
    void failedChatDoesNotPublishPartialAnswer() {
        execution.setDisposition("CHAT");
        ChatProcessContext context = context(60L, execution.getTraceId(), 30L);
        context.gatewayError = true;
        handler.afterPersisted(context);
        verify(messages, never()).insert(any(ByaiMessage.class));
        verify(executions).markFailed(eq(6L), eq("TURN_FAILED"), any(), any());
    }

    @Test
    void projectionFailureLeavesExecutionAvailableForRetry() {
        execution.setDisposition("CHAT");
        doThrow(new IllegalStateException("database unavailable")).doReturn(1)
            .when(messages).insert(any(ByaiMessage.class));
        assertThatThrownBy(() -> handler.reconcile(60L)).isInstanceOf(IllegalStateException.class);
        verify(executions, never()).markSucceeded(any(), any(), any());

        handler.reconcile(60L);

        verify(executions).markSucceeded(eq(6L), eq(100L), any());
    }

    @Test
    void subsequentTurnCompletesOnlyMatchingRuntimeTrace() {
        execution.setStatus("SUCCEEDED");
        ChatRuntimeState current = new ChatRuntimeState();
        current.setTraceId("new-trace");
        when(runtime.get(60L)).thenReturn(current);
        handler.afterPersisted(context(60L, "old-trace", 31L));
        verifyNoInteractions(tasks);

        handler.afterPersisted(context(60L, "new-trace", 32L));

        verify(tasks).updateTurnStatus(60L, "WAITING_USER");
        verifyNoInteractions(messages, publisher);
    }

    @Test
    void independentChildrenCompleteWithoutMixingAnswers() {
        ByaiGroupChatExecution second = new ByaiGroupChatExecution();
        second.setExecutionId(8L);
        second.setCandidateSessionId(80L);
        second.setGroupSessionId(1L);
        second.setTargetAgentId(5L);
        second.setStatus("RUNNING");
        second.setDisposition("TASK");
        second.setTraceId(TraceIdCodec.encode(21L, 31L));
        when(executions.selectForUpdateByCandidateSessionId(80L)).thenReturn(second);
        ByaiMessage secondAnswer = new ByaiMessage();
        secondAnswer.setMessageId(31L);
        secondAnswer.setSessionId(80L);
        secondAnswer.setUsage(2);
        secondAnswer.setIsComplete(true);
        secondAnswer.setMessageContent("另一个任务");
        when(messages.selectByMessageId(31L)).thenReturn(secondAnswer);

        handler.reconcile(80L);
        handler.reconcile(60L);

        verify(executions).markSucceeded(eq(8L), eq(31L), any());
        verify(executions).markSucceeded(eq(6L), eq(30L), any());
        verify(tasks).updateTurnStatus(80L, "WAITING_USER");
        verify(tasks).updateTurnStatus(60L, "WAITING_USER");
        verify(messages, never()).insert(any(ByaiMessage.class));
    }

    @Test
    void taskMentionNormalizationPreservesProcessStructureAndDispatchesFinalMentions() {
        ResourceVo resource = new ResourceVo();
        resource.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        resource.setResourceId("40");
        resource.setResourceName("协作员工");
        answer.setMessageContent("[@协作员工](uid=DIG_EMPLOYEE_40)");
        answer.setMetadata("{\"messageRenderVersion\":\"v2\"}");
        answer.setMessageStruct("""
            [{"contentType":"1002","seq":5,"choices":[{"delta":{"content":"[@协作员工](uid=DIG_EMPLOYEE_40)"}}]}]
            """);
        when(parser.parse(1L, 4L, answer.getMessageContent()))
            .thenReturn(new GroupChatAgentMention("{{DIG_EMPLOYEE_40}}", List.of(resource)));

        handler.reconcile(60L);

        ArgumentCaptor<ByaiMessageHotDto> update = ArgumentCaptor.forClass(ByaiMessageHotDto.class);
        verify(messages).updateByMessageId(update.capture());
        assertThat(update.getValue().getMetadata()).contains("messageRenderVersion", "resourceList");
        assertThat(JSON.parseArray(update.getValue().getMessageStruct()).getJSONObject(0).getLong("seq"))
            .isEqualTo(5L);
        assertThat(update.getValue().getMessageStruct()).contains("{{DIG_EMPLOYEE_40}}");
        verify(coordinator).enqueueChild(execution, 40L, answer.getMessageId(),
            execution.getSourceMessageId(), "{{DIG_EMPLOYEE_40}}", List.of(resource));
        verify(messages, never()).insert(any(ByaiMessage.class));
    }

    private ChatProcessContext context(Long sessionId, String traceId, Long answerId) {
        ChatProcessContext context = new ChatProcessContext(null, null);
        context.sessionId = sessionId;
        context.traceId = traceId;
        context.modelAnswerMessageId = answerId;
        return context;
    }
}
