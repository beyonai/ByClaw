package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatDisposition;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispositionReader;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import org.mockito.ArgumentCaptor;
import java.util.List;

class GroupChatExecutionEventHandlerTest {
    @Test
    void ignoresNonFinalEvents() {
        ByaiMessageMapper mapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(mapper, publisher);
        JSONObject event = new JSONObject();
        event.put("event_type", "reasoningLogDelta");
        assertFalse(handler.handle(1L, 2L, 3L, 4L, event));
        verify(mapper, never()).insert(any());
    }

    @Test
    void persistsAndPublishesFinalAnswerWithReplyReference() {
        ByaiMessageMapper mapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(mapper, publisher);
        JSONObject event = new JSONObject();
        event.put("event_type", "final_answer");
        event.put("final_content", "answer");
        assertTrue(handler.handle(10L, 20L, 30L, 40L, event));
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(mapper).insert(saved.capture());
        assertThat(saved.getValue().getResComId()).isEqualTo(40L);
        verify(publisher).publish(any(), any(), any());
    }

    @Test
    void promotesTaskBeforePublishingAnyAnswerToGroup() {
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        ByaiGroupChatExecutionMapper executionMapper = mock(ByaiGroupChatExecutionMapper.class);
        UserService userService = mock(UserService.class);
        GroupChatDispositionReader reader = mock(GroupChatDispositionReader.class);
        GroupChatTaskService taskService = mock(GroupChatTaskService.class);
        GroupChatCandidateSessionService candidateService = mock(GroupChatCandidateSessionService.class);
        ByaiGroupChatExecution execution = new ByaiGroupChatExecution();
        execution.setExecutionId(5L);
        execution.setCandidateSessionId(6L);
        execution.setGroupSessionId(1L);
        execution.setSourceMessageId(2L);
        execution.setTargetAgentId(4L);
        execution.setInitiatorUserId(7L);
        execution.setDisposition("UNKNOWN");
        when(executionMapper.selectById(5L)).thenReturn(execution);
        when(executionMapper.decideDisposition(any(), any(), any(), any(), any())).thenReturn(1);
        Users user = new Users();
        user.setUserCode("u1");
        when(userService.findById(7L)).thenReturn(user);
        GroupChatDisposition disposition = new GroupChatDisposition();
        disposition.setKind("TASK");
        disposition.setTaskName("财务报告");
        when(reader.read("u1", 6L, 5L)).thenReturn(disposition);
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messageMapper, publisher,
            mock(SequenceService.class), executionMapper, null, mock(SsResourceService.class), userService, reader,
            taskService, candidateService, null, null);
        JSONObject event = new JSONObject();
        event.put("event_type", "answerDelta");
        event.put("content", "处理中");

        assertFalse(handler.handle(5L, 1L, 2L, null, 4L, event));

        verify(taskService).promote(execution, "财务报告", null);
        verify(messageMapper, never()).insert(any());
        verify(publisher, never()).publish(any(), any(), any());
    }

    @Test
    void chatNormalizesMentionsPublishesResourcesAndDispatchesChild() {
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        ByaiGroupChatExecutionMapper executionMapper = mock(ByaiGroupChatExecutionMapper.class);
        GroupChatExecutionCoordinator coordinator = mock(GroupChatExecutionCoordinator.class);
        GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
        SequenceService sequenceService = mock(SequenceService.class);
        ByaiGroupChatExecution execution = execution(5L, "CHAT");
        ResourceVo resource = resource(30L);
        when(executionMapper.selectById(5L)).thenReturn(execution);
        when(sequenceService.nextVal()).thenReturn(99L);
        when(parser.parse(1L, 4L, "[@伪造](uid?=DIG_EMPLOYEE_30)"))
            .thenReturn(new GroupChatAgentMention("{{DIG_EMPLOYEE_30}}", List.of(resource)));
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messageMapper, publisher,
            sequenceService, executionMapper, coordinator, mock(SsResourceService.class), mock(UserService.class),
            null, mock(GroupChatTaskService.class), mock(GroupChatCandidateSessionService.class), null, parser);
        JSONObject event = new JSONObject();
        event.put("event_type", "finalAnswer");
        event.put("content", "[@伪造](uid?=DIG_EMPLOYEE_30)");

        assertTrue(handler.handle(5L, 1L, 2L, null, 4L, event));

        ArgumentCaptor<ByaiMessage> messageCaptor = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messageMapper).insert(messageCaptor.capture());
        assertThat(messageCaptor.getValue().getMessageContent()).isEqualTo("{{DIG_EMPLOYEE_30}}");
        assertThat(messageCaptor.getValue().getMetadata()).contains("resourceList", "真实智能体");
        ArgumentCaptor<JSONObject> eventCaptor = ArgumentCaptor.forClass(JSONObject.class);
        verify(publisher).publish(eq(1L), eventCaptor.capture(), eq(null));
        assertThat(eventCaptor.getValue().getJSONArray("resourceList")).hasSize(1);
        verify(coordinator).enqueueChild(execution, 30L);
        verify(executionMapper).markSucceeded(eq(5L), eq(99L), any());
    }

    @Test
    void chatIndexesHumanMentionsWithThePublicMessage() {
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        ByaiGroupChatExecutionMapper executionMapper = mock(ByaiGroupChatExecutionMapper.class);
        GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
        GroupChatMentionService mentionService = mock(GroupChatMentionService.class);
        SequenceService sequenceService = mock(SequenceService.class);
        ByaiGroupChatExecution execution = execution(8L, "CHAT");
        ResourceVo human = resource(AgentMetaEnum.HUMAN, 30L);
        when(executionMapper.selectById(8L)).thenReturn(execution);
        when(sequenceService.nextVal()).thenReturn(102L);
        when(parser.parse(1L, 4L, "@human"))
            .thenReturn(new GroupChatAgentMention("{{HUMAN_30}}", List.of(human)));
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messageMapper,
            mock(GroupChatEventPublisher.class), sequenceService, executionMapper, null,
            mock(SsResourceService.class), mock(UserService.class), null, mock(GroupChatTaskService.class),
            mock(GroupChatCandidateSessionService.class), null, parser, mentionService);
        JSONObject event = new JSONObject();
        event.put("event_type", "finalAnswer");
        event.put("content", "@human");

        assertTrue(handler.handle(8L, 1L, 2L, null, 4L, event));

        verify(mentionService).indexHumanMentions(1L, 102L, 4L, null, List.of(human));
    }

    @Test
    void mentionIndexFailureDoesNotPoisonChatProjectionRetry() {
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        GroupChatMentionService mentionService = mock(GroupChatMentionService.class);
        SequenceService sequenceService = mock(SequenceService.class);
        ResourceVo human = resource(AgentMetaEnum.HUMAN, 30L);
        GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
        when(parser.parse(1L, 4L, "@human"))
            .thenReturn(new GroupChatAgentMention("{{HUMAN_30}}", List.of(human)));
        when(sequenceService.nextVal()).thenReturn(102L, 103L);
        doThrow(new IllegalStateException("index failed")).doNothing().when(mentionService)
            .indexHumanMentions(eq(1L), any(), eq(4L), eq(null), eq(List.of(human)));
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messageMapper, publisher,
            sequenceService, null, null, mock(SsResourceService.class), mock(UserService.class), null,
            mock(GroupChatTaskService.class), mock(GroupChatCandidateSessionService.class), null, parser,
            mentionService);
        JSONObject event = new JSONObject();
        event.put("event_type", "finalAnswer");
        event.put("content", "@human");

        assertThatThrownBy(() -> handler.handle(1L, 2L, null, 4L, event))
            .isInstanceOf(IllegalStateException.class);
        assertTrue(handler.handle(1L, 2L, null, 4L, event));

        verify(messageMapper, times(2)).insert(any(ByaiMessage.class));
        verify(publisher).publish(eq(1L), any(JSONObject.class), eq(null));
    }

    @Test
    void chatRedeliveryUsesPersistedAnswerMessageAsIdempotencyBoundary() {
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        ByaiGroupChatExecutionMapper executionMapper = mock(ByaiGroupChatExecutionMapper.class);
        GroupChatExecutionCoordinator coordinator = mock(GroupChatExecutionCoordinator.class);
        GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
        ByaiGroupChatExecution execution = execution(7L, "CHAT");
        execution.setAnswerMessageId(101L);
        when(executionMapper.selectById(7L)).thenReturn(execution);
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messageMapper, publisher,
            mock(SequenceService.class), executionMapper, coordinator, mock(SsResourceService.class),
            mock(UserService.class), null, mock(GroupChatTaskService.class),
            mock(GroupChatCandidateSessionService.class), null, parser);
        JSONObject event = new JSONObject();
        event.put("event_type", "finalAnswer");
        event.put("content", "[@智能体](uid?=DIG_EMPLOYEE_30)");

        assertFalse(handler.handle(7L, 1L, 2L, null, 4L, event));

        verifyNoInteractions(messageMapper, publisher, coordinator, parser);
    }

    @Test
    void taskFinalAnswerAlsoDispatchesParsedAgentMentions() {
        ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
        GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
        ByaiGroupChatExecutionMapper executionMapper = mock(ByaiGroupChatExecutionMapper.class);
        GroupChatExecutionCoordinator coordinator = mock(GroupChatExecutionCoordinator.class);
        GroupChatAgentMentionParser parser = mock(GroupChatAgentMentionParser.class);
        SequenceService sequenceService = mock(SequenceService.class);
        GroupChatTaskService taskService = mock(GroupChatTaskService.class);
        ByaiGroupChatExecution execution = execution(6L, "TASK");
        ResourceVo resource = resource(30L);
        when(executionMapper.selectById(6L)).thenReturn(execution);
        when(sequenceService.nextVal()).thenReturn(100L);
        when(parser.parse(1L, 4L, "final"))
            .thenReturn(new GroupChatAgentMention("{{DIG_EMPLOYEE_30}}", List.of(resource)));
        GroupChatExecutionEventHandler handler = new GroupChatExecutionEventHandler(messageMapper, publisher,
            sequenceService, executionMapper, coordinator, mock(SsResourceService.class), mock(UserService.class),
            null, taskService, mock(GroupChatCandidateSessionService.class), null, parser);
        JSONObject answer = new JSONObject();
        answer.put("event_type", "finalAnswer");
        answer.put("content", "final");
        JSONObject terminal = new JSONObject();
        terminal.put("event_type", "appStreamResponse");

        assertFalse(handler.handle(6L, 1L, 2L, null, 4L, answer));
        assertFalse(handler.handle(6L, 1L, 2L, null, 4L, terminal));

        ArgumentCaptor<ByaiMessage> messageCaptor = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messageMapper).insert(messageCaptor.capture());
        assertThat(messageCaptor.getValue().getMessageContent()).isEqualTo("{{DIG_EMPLOYEE_30}}");
        assertThat(messageCaptor.getValue().getMetadata()).contains("resourceList", "真实智能体");
        verify(coordinator).enqueueChild(execution, 30L);
    }

    private ByaiGroupChatExecution execution(Long id, String disposition) {
        ByaiGroupChatExecution execution = new ByaiGroupChatExecution();
        execution.setExecutionId(id);
        execution.setCandidateSessionId(60L);
        execution.setGroupSessionId(1L);
        execution.setSourceMessageId(2L);
        execution.setTargetAgentId(4L);
        execution.setInitiatorUserId(7L);
        execution.setDisposition(disposition);
        return execution;
    }

    private ResourceVo resource(Long id) {
        return resource(AgentMetaEnum.DIG_EMPLOYEE, id);
    }

    private ResourceVo resource(AgentMetaEnum type, Long id) {
        ResourceVo resource = new ResourceVo();
        resource.setId(type.name() + "_" + id);
        resource.setResourceId(String.valueOf(id));
        resource.setResourceName("真实智能体");
        resource.setResourceType(type);
        return resource;
    }
}
