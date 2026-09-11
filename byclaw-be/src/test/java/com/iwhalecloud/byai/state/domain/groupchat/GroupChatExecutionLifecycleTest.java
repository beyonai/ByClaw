package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.scheduling.annotation.Scheduled;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatExecutionLifecycleTest {
    private final ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final GroupChatTaskService tasks = mock(GroupChatTaskService.class);
    private final GroupChatEventPublisher publisher = mock(GroupChatEventPublisher.class);
    private ByaiGroupChatExecution execution;
    private GroupChatExecutionEventHandler handler;

    @BeforeEach
    void setUp() {
        execution = new ByaiGroupChatExecution();
        execution.setExecutionId(20071498L);
        execution.setCandidateSessionId(20071499L);
        execution.setGatewaySessionId("20071499");
        execution.setGroupSessionId(20071090L);
        execution.setSourceMessageId(20071497L);
        execution.setTargetAgentId(20037869L);
        execution.setInitiatorUserId(10000029L);
        execution.setTraceId("33d7a7e9-cc9f-4b56-b5cb-dc0b88c0cd3e");
        execution.setDisposition("TASK");
        execution.setStatus("RUNNING");
        execution.setStartTime(Date.from(Instant.now().minus(Duration.ofMinutes(15))));
        when(executions.selectById(20071498L)).thenReturn(execution);
        when(executions.selectRunningExecutions()).thenReturn(List.of(execution));
        when(executions.selectStaleRunning(any())).thenReturn(List.of(execution));
        when(executions.selectQueuedExecutions()).thenReturn(List.of());
        SsResourceService resources = mock(SsResourceService.class);
        UserService users = mock(UserService.class);
        TargetAgentResolver resolver = mock(TargetAgentResolver.class);
        SsResource agent = new SsResource();
        agent.setWorkerAgentType("BYCLAW_EXE");
        Users user = new Users();
        user.setUserCode("0027003719");
        when(resources.findById(20037869L)).thenReturn(agent);
        when(users.findById(10000029L)).thenReturn(user);
        when(resolver.resolveAgentType("BYCLAW_EXE", 20037869L, null, "0027003719"))
            .thenReturn("BYCLAW_EXE_0027003719");
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(300L);
        handler = new GroupChatExecutionEventHandler(messages, publisher, sequence, executions, null,
            resources, users, null, tasks, null, null, null, null, resolver);
    }

    @Test
    void scheduledWorkDoesNotRedispatchLongRunningTaskAndItsAnswerStillPersists() throws Exception {
        GroupChatGatewayExecutor gateway = mock(GroupChatGatewayExecutor.class);
        GroupChatExecutionCoordinator coordinator = new GroupChatExecutionCoordinator(executions,
            mock(SequenceService.class), gateway, mock(GroupChatCandidateSessionService.class));
        // 执行全部定时入口，覆盖原先独立的十分钟超时恢复任务，防止重发逻辑换入口后回归。
        for (Method method : GroupChatExecutionCoordinator.class.getMethods()) {
            if (method.isAnnotationPresent(Scheduled.class)) {
                method.invoke(coordinator);
            }
        }
        verify(executions, never()).requeueStaleRunning(any());
        verify(executions, never()).claim(any(), any());
        verifyNoInteractions(gateway);
        handle(event("finalAnswer", "采集已完成"));
        handle(event("appStreamResponse", ""));
        assertPrivateAnswer("采集已完成");
    }

    @ParameterizedTest
    @ValueSource(strings = {"trace_id", "session_id", "source_agent_type"})
    void unrelatedAnswerAndTerminalCannotFinishOrContaminateTask(String field) {
        JSONObject foreignAnswer = event("finalAnswer", "不属于本次任务");
        foreignAnswer.put(field, "another-execution");
        handle(foreignAnswer);
        JSONObject foreignTerminal = event("appStreamResponse", "");
        foreignTerminal.put(field, "another-execution");
        handle(foreignTerminal);
        verifyNoInteractions(messages, tasks, publisher);
        verify(executions, never()).markSucceeded(any(), any(), any());

        // 主 Agent 晚到的真实答案仍应入任务会话，不能被之前的终止事件截断。
        handle(event("finalAnswer", "采集已完成"));
        handle(event("appStreamResponse", ""));
        assertPrivateAnswer("采集已完成");
    }

    @ParameterizedTest
    @ValueSource(strings = {"trace_id", "session_id"})
    void missingExecutionIdentityCannotFinishTask(String field) {
        JSONObject terminal = event("appStreamResponse", "");
        terminal.remove(field);
        handle(terminal);
        verifyNoInteractions(messages, tasks, publisher);
        verify(executions, never()).markSucceeded(any(), any(), any());
    }

    @Test
    void childAgentDeltaAndErrorCannotBecomeTaskAnswerOrFailure() {
        JSONObject delta = event("answerDelta", "子 Agent 正文");
        delta.put("source_agent_type", "CHILD_AGENT");
        handle(delta);
        JSONObject error = event("error", "子 Agent 失败");
        error.put("source_agent_type", "CHILD_AGENT");
        handle(error);
        verifyNoInteractions(tasks, messages);
        verify(executions, never()).markFailed(any(), any(), any(), any());
        handle(event("answerDelta", "主 Agent 正文"));
        handle(event("appStreamResponse", ""));
        assertPrivateAnswer("主 Agent 正文");
    }

    @Test
    void chatPublishesOnlyTheMatchingAgentsAnswer() {
        execution.setDisposition("CHAT");
        JSONObject foreign = event("finalAnswer", "子 Agent 答案");
        foreign.put("source_agent_type", "CHILD_AGENT");
        handle(foreign);
        verifyNoInteractions(messages, publisher);
        handle(event("finalAnswer", "主 Agent 答案"));
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        assertThat(saved.getValue().getSessionId()).isEqualTo(20071090L);
        assertThat(saved.getValue().getMessageContent()).isEqualTo("主 Agent 答案");
        verify(publisher).publish(eq(20071090L), any(), any());
        verifyNoInteractions(tasks);
    }

    @Test
    void targetAgentErrorStillMarksTaskFailed() {
        handle(event("error", "执行失败"));
        verify(tasks).updateTurnStatus(20071499L, "FAILED");
        verify(executions).markFailed(eq(20071498L), any(), any(), any());
        verify(executions, never()).markSucceeded(any(), any(), any());
    }

    @Test
    void completedExecutionCannotMutateTaskOnReplay() {
        execution.setStatus("SUCCEEDED");
        handle(event("finalAnswer", "重复答案"));
        handle(event("appStreamResponse", ""));
        verifyNoInteractions(messages, tasks, publisher);
        verify(executions, never()).markSucceeded(any(), any(), any());
    }

    private void assertPrivateAnswer(String expected) {
        ArgumentCaptor<ByaiMessage> saved = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messages).insert(saved.capture());
        assertThat(saved.getValue().getSessionId()).isEqualTo(20071499L);
        assertThat(saved.getValue().getMessageContent()).isEqualTo(expected);
        verify(tasks).updateTurnStatus(20071499L, "WAITING_USER");
        verify(executions).markSucceeded(eq(20071498L), eq(300L), any());
        verifyNoInteractions(publisher);
    }

    private void handle(JSONObject event) {
        handler.handle(20071498L, 20071090L, 20071497L, null, 20037869L, event);
    }

    private JSONObject event(String type, String content) {
        JSONObject event = new JSONObject();
        event.put("event_type", type);
        event.put("trace_id", execution.getTraceId());
        event.put("session_id", "20071499");
        event.put("source_agent_type", "BYCLAW_EXE_0027003719");
        // 与 Redis 实际 Gateway envelope 保持一致，覆盖嵌套 choices/delta 正文提取。
        JSONObject delta = new JSONObject();
        delta.put("content", content);
        JSONObject choice = new JSONObject();
        choice.put("delta", delta);
        JSONObject data = new JSONObject();
        data.put("choices", List.of(choice));
        event.put("data", data);
        return event;
    }
}
