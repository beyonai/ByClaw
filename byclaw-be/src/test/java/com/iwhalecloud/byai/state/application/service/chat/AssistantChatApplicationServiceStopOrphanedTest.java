package com.iwhalecloud.byai.state.application.service.chat;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.chat.service.SessionRuntimeStateService;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AssistantChatApplicationServiceStopOrphanedTest {

    final RunningOutputStreamRegistry running = mock(RunningOutputStreamRegistry.class);

    final OutputStreamManager streams = mock(OutputStreamManager.class);

    final SessionStreamManager sessionStreams = mock(SessionStreamManager.class);

    final RunningChatSnapshotService snapshots = mock(RunningChatSnapshotService.class);

    final TaskPlanApplicationService plans = mock(TaskPlanApplicationService.class);

    final AssistantChatApplicationService service = new AssistantChatApplicationService(mock(GatewayClient.class));

    @Test
    void anOrphanedTurnIsStoppedItsListenerContextCompletedAndItsRunningStateReleased() {
        ReflectionTestUtils.setField(service, "runningOutputStreamRegistry", running);
        ReflectionTestUtils.setField(service, "outputStreamManager", streams);
        ReflectionTestUtils.setField(service, "sessionStreamManager", sessionStreams);
        ReflectionTestUtils.setField(service, "runningChatSnapshotService", snapshots);
        ReflectionTestUtils.setField(service, "taskPlanApplicationService", plans);
        ReflectionTestUtils.setField(service, "sessionRuntimeStateService", mock(SessionRuntimeStateService.class));
        ReflectionTestUtils.setField(service, "scriptService", mock(ScriptService.class));
        RunningChatInfo info = new RunningChatInfo();
        info.setSessionId(101L);
        info.setRunning(true);
        info.setTraceId("dead-turn");
        info.setModelAnswerMessageId(11L);
        when(running.getRunning(101L)).thenReturn(info);
        ChatProcessContext dead = mock(ChatProcessContext.class);
        when(streams.getContext("101", "dead-turn")).thenReturn(dead);

        service.stopOrphanedChat(101L);

        verify(plans).cancel(any(com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto.class), eq("WORKER_LOST"), eq("执行宿主已离线，本轮已中断"));
        // Its terminal event will never arrive: completing it here is what lets the next turn release the session.
        verify(sessionStreams).completeSessionTurn(dead);
        verify(running).release(101L, 11L);
        verify(snapshots).delete(101L, 11L);
    }
}
