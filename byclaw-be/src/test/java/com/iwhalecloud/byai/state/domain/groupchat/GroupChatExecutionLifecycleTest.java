package com.iwhalecloud.byai.state.domain.groupchat;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.lang.reflect.Method;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatExecutionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatExecutionCoordinator;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatExecutionEventHandler;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatGatewayExecutor;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatStreamRouter;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatExecutionLifecycleTest {
    @Test
    void scheduledWorkDoesNotRedispatchLongRunningTasks() throws Exception {
        ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
        GroupChatGatewayExecutor gateway = mock(GroupChatGatewayExecutor.class);
        when(executions.selectQueuedExecutions()).thenReturn(List.of());
        GroupChatExecutionCoordinator coordinator = new GroupChatExecutionCoordinator(executions,
            mock(SequenceService.class), gateway, mock(GroupChatCandidateSessionService.class));
        // 运行全部定时入口，避免分类观察被误改成重新发送同一个 Agent turn。
        for (Method method : GroupChatExecutionCoordinator.class.getMethods()) {
            if (method.isAnnotationPresent(Scheduled.class)) {
                method.invoke(coordinator);
            }
        }
        verify(executions, never()).requeueStaleRunning(any());
        verify(executions, never()).claim(any(), any());
        verifyNoInteractions(gateway);
    }

    @Test
    void dispositionObservationFailureDoesNotBlockOtherAgents() {
        ByaiGroupChatExecutionMapper executions = mock(ByaiGroupChatExecutionMapper.class);
        GroupChatExecutionEventHandler handler = mock(GroupChatExecutionEventHandler.class);
        ByaiGroupChatExecution first = new ByaiGroupChatExecution();
        first.setCandidateSessionId(60L);
        ByaiGroupChatExecution second = new ByaiGroupChatExecution();
        second.setCandidateSessionId(80L);
        when(executions.selectRunningExecutions()).thenReturn(List.of(first, second));
        doThrow(new IllegalStateException("temporary file read failure")).when(handler).reconcile(60L);

        new GroupChatStreamRouter(executions, handler).pollRunningExecutions();

        verify(handler).reconcile(60L);
        verify(handler).reconcile(80L);
    }
}
