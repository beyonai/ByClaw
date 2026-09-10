package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
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
        verify(mapper).insert(any());
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
            taskService, candidateService, null);
        JSONObject event = new JSONObject();
        event.put("event_type", "answerDelta");
        event.put("content", "处理中");

        assertFalse(handler.handle(5L, 1L, 2L, null, 4L, event));

        verify(taskService).promote(execution, "财务报告", null);
        verify(messageMapper, never()).insert(any());
        verify(publisher, never()).publish(any(), any(), any());
    }
}
