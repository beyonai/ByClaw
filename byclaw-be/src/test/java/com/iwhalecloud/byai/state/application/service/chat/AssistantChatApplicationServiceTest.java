package com.iwhalecloud.byai.state.application.service.chat;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentTypeResolver;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketPublisher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import org.mockito.InOrder;

class AssistantChatApplicationServiceTest {

    private GatewayClient gatewayClient;
    private SsResourceService ssResourceService;
    private RunningOutputStreamRegistry runningOutputStreamRegistry;
    private RunningChatSnapshotService runningChatSnapshotService;
    private TaskPlanApplicationService taskPlanApplicationService;
    private TaskPlanWebSocketPublisher taskPlanWebSocketPublisher;
    private AssistantChatApplicationService assistantChatApplicationService;

    @BeforeEach
    void setUp() {
        gatewayClient = mock(GatewayClient.class);
        ssResourceService = mock(SsResourceService.class);
        runningOutputStreamRegistry = mock(RunningOutputStreamRegistry.class);
        runningChatSnapshotService = mock(RunningChatSnapshotService.class);
        taskPlanApplicationService = mock(TaskPlanApplicationService.class);
        taskPlanWebSocketPublisher = mock(TaskPlanWebSocketPublisher.class);

        assistantChatApplicationService = new AssistantChatApplicationService(gatewayClient);
        ReflectionTestUtils.setField(assistantChatApplicationService, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "targetAgentTypeResolver",
            new TargetAgentTypeResolver());
        ReflectionTestUtils.setField(assistantChatApplicationService, "runningOutputStreamRegistry",
            runningOutputStreamRegistry);
        ReflectionTestUtils.setField(assistantChatApplicationService, "runningChatSnapshotService",
            runningChatSnapshotService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "taskPlanApplicationService",
            taskPlanApplicationService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "taskPlanWebSocketPublisher",
            taskPlanWebSocketPublisher);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        loginInfo.setUserCode("u1");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void stopChat_clearsRunningStateAfterCancelTask() {
        StopChatDto stopChatDto = new StopChatDto();
        stopChatDto.setAgentId(30L);
        stopChatDto.setSessionId(10L);
        stopChatDto.setMessageId(20L);
        when(ssResourceService.findById(30L)).thenReturn(null);
        TaskPlanSnapshot cancelling = new TaskPlanSnapshot();
        cancelling.setStatus("CANCELLING");
        TaskPlanSnapshot cancelled = new TaskPlanSnapshot();
        cancelled.setStatus("CANCELLED");
        when(taskPlanApplicationService.requestCancellation(stopChatDto, "USER_STOPPED", "用户请求停止"))
            .thenReturn(cancelling);
        when(taskPlanApplicationService.confirmCancellation(stopChatDto, "USER_STOPPED", "用户已停止执行"))
            .thenReturn(cancelled);

        assistantChatApplicationService.stopChat(stopChatDto);

        InOrder order = inOrder(taskPlanApplicationService, gatewayClient, runningOutputStreamRegistry,
            runningChatSnapshotService);
        order.verify(taskPlanApplicationService).requestCancellation(stopChatDto, "USER_STOPPED", "用户请求停止");
        order.verify(gatewayClient).cancelTask(eq("20"), eq("10"), eq("user cancel task"), eq("BYCLAW_EXE_u1"),
            eq("u1"), eq("force"));
        order.verify(taskPlanApplicationService).confirmCancellation(stopChatDto, "USER_STOPPED", "用户已停止执行");
        order.verify(runningOutputStreamRegistry).release(10L, 20L);
        order.verify(runningChatSnapshotService).delete(10L, 20L);
        verify(taskPlanWebSocketPublisher).broadcast(1L, cancelling, null);
        verify(taskPlanWebSocketPublisher).broadcast(1L, cancelled, null);
    }
}
