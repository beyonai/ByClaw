package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.sql.Connection;
import javax.sql.DataSource;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.state.application.service.chat.AssistantChatApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationStore;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;

/** Uses real Spring transaction boundaries with mocked JDBC; no external services are contacted. */
class GroupChatTaskCancellationTest {
    private final ByaiGroupChatTaskMapper tasks = mock(ByaiGroupChatTaskMapper.class);
    private final GroupChatTaskAuthorizationService authorization = mock(GroupChatTaskAuthorizationService.class);
    private final GroupChatPendingPublicationStore pending = mock(GroupChatPendingPublicationStore.class);
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private final AssistantChatApplicationService chat = mock(AssistantChatApplicationService.class);
    private final RunningOutputStreamRegistry registry = mock(RunningOutputStreamRegistry.class);
    private final ChatRuntimeStateService runtimes = mock(ChatRuntimeStateService.class);
    private final Connection connection = mock(Connection.class);
    private final ByaiGroupChatTask task = new ByaiGroupChatTask();
    private GroupChatTaskService service;
    private DataSourceTransactionManager transactions;

    @BeforeEach
    void setUp() throws Exception {
        DataSource dataSource = mock(DataSource.class);
        when(dataSource.getConnection()).thenReturn(connection);
        transactions = new DataSourceTransactionManager(dataSource);
        service = new GroupChatTaskService(tasks, null, null, null, null, null, authorization,
            null, null, null, null, events, pending, null, null);
        ReflectionTestUtils.setField(service, "transactionManager", transactions);
        ReflectionTestUtils.setField(service, "chatApplicationService", chat);
        ReflectionTestUtils.setField(service, "runningRegistry", registry);
        ReflectionTestUtils.setField(service, "chatRuntimeStateService", runtimes);
        task.setTaskSessionId(60L);
        task.setGroupSessionId(1L);
        task.setTargetAgentId(4L);
        task.setStatus("ACTIVE");
        task.setTurnStatus("RUNNING");
        when(tasks.selectForUpdate(60L)).thenReturn(task);
        when(tasks.cancel(eq(60L), any())).thenReturn(1);
    }

    @Test
    void stopsCurrentAgentAfterReleasingValidationLockAndBeforeCancellation() throws Exception {
        RunningChatInfo running = new RunningChatInfo();
        running.setAgentId(9L);
        running.setAgentCode("current-agent");
        running.setModelAnswerMessageId(70L);
        running.setTraceId("current-trace");
        running.setLaneId("current-lane");
        running.setClientRequestId("current-request");
        when(registry.getRunning(60L)).thenReturn(running);
        doAnswer(invocation -> {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            // The synchronous stop callback may acquire its own transaction after the validation lock commits.
            new TransactionTemplate(transactions).executeWithoutResult(status ->
                assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isTrue());
            return null;
        }).when(chat).stopChat(any());

        service.cancel(60L);

        ArgumentCaptor<StopChatDto> dto = ArgumentCaptor.forClass(StopChatDto.class);
        InOrder order = inOrder(authorization, tasks, connection, chat, pending, events);
        order.verify(authorization).requireCanceller(60L);
        order.verify(tasks).selectForUpdate(60L);
        order.verify(connection).commit();
        order.verify(chat).stopChat(dto.capture());
        order.verify(authorization).requireCanceller(60L);
        order.verify(tasks).selectForUpdate(60L);
        order.verify(tasks).cancel(eq(60L), any());
        order.verify(pending).clear(task, null);
        order.verify(connection).commit();
        order.verify(events).publish(eq(1L), any(), eq(null));
        assertThat(dto.getValue()).extracting("sessionId", "agentId", "agentCode", "messageId",
            "traceId", "laneId", "clientRequestId")
            .containsExactly(60L, 9L, "current-agent", 70L, "current-trace", "current-lane", "current-request");
        ArgumentCaptor<JSONObject> event = ArgumentCaptor.forClass(JSONObject.class);
        verify(events).publish(eq(1L), event.capture(), eq(null));
        assertThat(event.getValue().getString("status")).isEqualTo("CANCELLED");
    }

    @Test
    void usesDurableCurrentAgentWhenRegistryHasExpired() {
        ChatRuntimeState runtime = new ChatRuntimeState();
        AssistantChatDto assistant = new AssistantChatDto();
        assistant.setAgentId(8L);
        assistant.setAgentCode("handoff-agent");
        assistant.setLaneId("lane");
        runtime.setAssistantChatDto(assistant);
        runtime.setModelAnswerMessageId(71L);
        runtime.setTraceId("trace");
        runtime.setClientRequestId("request");
        when(runtimes.get(60L)).thenReturn(runtime);
        service.cancel(60L);
        ArgumentCaptor<StopChatDto> dto = ArgumentCaptor.forClass(StopChatDto.class);
        verify(chat).stopChat(dto.capture());
        assertThat(dto.getValue()).extracting("agentId", "agentCode", "messageId", "traceId", "laneId", "clientRequestId")
            .containsExactly(8L, "handoff-agent", 71L, "trace", "lane", "request");
    }

    @Test
    void fallsBackToTaskIdentityWhenRuntimeIsMissing() {
        service.cancel(60L);
        ArgumentCaptor<StopChatDto> dto = ArgumentCaptor.forClass(StopChatDto.class);
        verify(chat).stopChat(dto.capture());
        assertThat(dto.getValue().getSessionId()).isEqualTo(60L);
        assertThat(dto.getValue().getAgentId()).isEqualTo(4L);
        assertThat(dto.getValue().getMessageId()).isNull();
    }

    @ParameterizedTest
    @ValueSource(strings = {"WAITING_USER", "FAILED", "UNKNOWN"})
    void nonRunningTasksCancelWithoutStopping(String turnStatus) {
        task.setTurnStatus(turnStatus);
        service.cancel(60L);
        verifyNoInteractions(chat, registry, runtimes);
        verify(tasks).cancel(eq(60L), any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"PUBLISHED", "CANCELLED", "UNKNOWN"})
    void terminalTasksRejectBeforeStop(String status) {
        task.setStatus(status);
        assertThatThrownBy(() -> service.cancel(60L)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(chat, registry, runtimes, pending, events);
        verify(tasks, never()).cancel(any(), any());
    }

    @Test
    void missingLockedTaskRejectsBeforeStop() {
        when(tasks.selectForUpdate(60L)).thenReturn(null);
        assertThatThrownBy(() -> service.cancel(60L)).isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(chat, pending, events);
    }

    @Test
    void unauthorizedCallerCannotLockOrStop() {
        when(authorization.requireCanceller(60L)).thenThrow(new IllegalArgumentException("not allowed"));
        assertThatThrownBy(() -> service.cancel(60L)).hasMessage("not allowed");
        verifyNoInteractions(tasks, chat, registry, runtimes, pending, events);
    }

    @Test
    void stopFailureDoesNotMarkCancelled() {
        doThrow(new IllegalStateException("stop failed")).when(chat).stopChat(any());
        assertThatThrownBy(() -> service.cancel(60L)).hasMessage("stop failed");
        verify(tasks, never()).cancel(any(), any());
        verifyNoInteractions(pending, events);
    }

    @Test
    void concurrentCompletionIsNotOverwrittenAfterStop() {
        doAnswer(invocation -> {
            task.setStatus("PUBLISHED");
            return null;
        }).when(chat).stopChat(any());
        assertThatThrownBy(() -> service.cancel(60L)).hasMessage("Task is no longer active");
        verify(tasks, never()).cancel(any(), any());
        verifyNoInteractions(pending, events);
    }

    @Test
    void concurrentNewTurnIsNotCancelledWithoutStoppingIt() {
        RunningChatInfo original = new RunningChatInfo();
        original.setModelAnswerMessageId(70L);
        original.setTraceId("original");
        RunningChatInfo newer = new RunningChatInfo();
        newer.setModelAnswerMessageId(71L);
        newer.setTraceId("newer");
        when(registry.getRunning(60L)).thenReturn(original, newer);
        assertThatThrownBy(() -> service.cancel(60L)).hasMessage("Task started a new turn; retry cancellation");
        verify(chat).stopChat(any());
        verify(tasks, never()).cancel(any(), any());
        verifyNoInteractions(pending, events);
    }

    @Test
    void permissionRevokedDuringStopPreventsCancellationWrite() {
        when(authorization.requireCanceller(60L)).thenReturn(task)
            .thenThrow(new IllegalArgumentException("permission revoked"));
        assertThatThrownBy(() -> service.cancel(60L)).hasMessage("permission revoked");
        verify(chat).stopChat(any());
        verify(tasks, never()).cancel(any(), any());
        verifyNoInteractions(pending, events);
    }

    @Test
    void failedConditionalUpdateDoesNotClearPendingOrBroadcast() {
        when(tasks.cancel(eq(60L), any())).thenReturn(0);
        assertThatThrownBy(() -> service.cancel(60L)).hasMessage("Task is no longer active");
        verifyNoInteractions(pending, events);
    }
}
