package com.iwhalecloud.byai.state.application.service.chat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.manager.dto.session.SessionUploadResult;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.RunningChatSnapshotService;
import com.iwhalecloud.byai.state.domain.chat.service.RunningOutputStreamRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketPublisher;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionTitleService;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.alibaba.fastjson.JSONObject;
import java.util.Date;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.multipart.MultipartFile;

class AssistantChatApplicationServiceTest {

    private GatewayClient gatewayClient;
    private RunningOutputStreamRegistry runningOutputStreamRegistry;
    private RunningChatSnapshotService runningChatSnapshotService;

    private SessionService sessionService;

    private SessionTitleService sessionTitleService;

    private ByaiSystemConfigService byaiSystemConfigService;

    private TaskPlanApplicationService taskPlanApplicationService;
    private TaskPlanWebSocketPublisher taskPlanWebSocketPublisher;
    private AssistantChatApplicationService assistantChatApplicationService;

    @BeforeEach
    void setUp() {
        gatewayClient = mock(GatewayClient.class);
        runningOutputStreamRegistry = mock(RunningOutputStreamRegistry.class);
        runningChatSnapshotService = mock(RunningChatSnapshotService.class);
        taskPlanApplicationService = mock(TaskPlanApplicationService.class);
        taskPlanWebSocketPublisher = mock(TaskPlanWebSocketPublisher.class);
        sessionService = mock(SessionService.class);
        sessionTitleService = mock(SessionTitleService.class);
        byaiSystemConfigService = mock(ByaiSystemConfigService.class);

        assistantChatApplicationService = new AssistantChatApplicationService(gatewayClient);
        ReflectionTestUtils.setField(assistantChatApplicationService, "runningOutputStreamRegistry",
            runningOutputStreamRegistry);
        ReflectionTestUtils.setField(assistantChatApplicationService, "runningChatSnapshotService",
            runningChatSnapshotService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "sessionService", sessionService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "sessionTitleService", sessionTitleService);
        ReflectionTestUtils.setField(assistantChatApplicationService, "byaiSystemConfigService", byaiSystemConfigService);
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
    void stopChat_clearsRunningStateAfterCancelSession() {
        StopChatDto stopChatDto = new StopChatDto();
        stopChatDto.setAgentId(30L);
        stopChatDto.setSessionId(10L);
        stopChatDto.setMessageId(20L);
        TaskPlanSnapshot cancelling = new TaskPlanSnapshot();
        cancelling.setStatus("CANCELLING");
        TaskPlanSnapshot cancelled = new TaskPlanSnapshot();
        cancelled.setStatus("CANCELLED");
        when(taskPlanApplicationService.requestCancellation(stopChatDto, "USER_STOPPED", "用户请求停止"))
            .thenReturn(cancelling);
        when(taskPlanApplicationService.confirmCancellation(stopChatDto, "USER_STOPPED", "用户已停止执行"))
            .thenReturn(cancelled);

        assistantChatApplicationService.stopChat(stopChatDto);

        verify(gatewayClient).cancelSession(eq("10"), eq("user cancel task"));
        verify(runningOutputStreamRegistry).release(10L, 20L);
        verify(runningChatSnapshotService).delete(10L, 20L);
        verify(taskPlanWebSocketPublisher).broadcast(1L, cancelling, null);
        verify(taskPlanWebSocketPublisher).broadcast(1L, cancelled, null);
    }

    @Test
    void stopChat_decodesGatewayMessageIdFromTraceIdWhenMessageIdIsAbsent() {
        String traceId = TraceIdCodec.encode(11L, 21L);
        StopChatDto stopChatDto = new StopChatDto();
        stopChatDto.setAgentId(30L);
        stopChatDto.setSessionId(10L);
        stopChatDto.setTraceId(traceId);
        stopChatDto.setLaneId("lane-a");

        assistantChatApplicationService.stopChat(stopChatDto);

        verify(gatewayClient).cancelSession(eq("10"), eq("user cancel task"));
        verify(runningOutputStreamRegistry).release(10L, 21L);
        verify(runningChatSnapshotService).delete(10L, 21L);
    }

    /**
     * 重启后前端补发的 STOP_CHAT 会落到没有任何上下文的新 pod 上：
     * 既不能停止本 pod 并不持有的 listener，也不能带着未知归属去清理运行态与快照，
     * 否则重启恢复扫描将失去接管该会话的依据。
     */
    @Test
    void stopChat_keepsRecoveryStateWhenAnswerOwnershipUnknown() {
        SessionStreamManager sessionStreamManager = mock(SessionStreamManager.class);
        ReflectionTestUtils.setField(assistantChatApplicationService, "sessionStreamManager", sessionStreamManager);
        ReflectionTestUtils.setField(assistantChatApplicationService, "outputStreamManager",
            mock(OutputStreamManager.class));
        ReflectionTestUtils.setField(assistantChatApplicationService, "scriptService", mock(ScriptService.class));
        when(sessionStreamManager.isSessionListenerActive("10")).thenReturn(false);
        when(runningOutputStreamRegistry.getRunning(10L)).thenReturn(new RunningChatInfo());

        StopChatDto stopChatDto = new StopChatDto();
        stopChatDto.setSessionId(10L);

        assistantChatApplicationService.stopChat(stopChatDto);

        verify(sessionStreamManager, never()).stopSessionListener(anyString());
        verify(runningOutputStreamRegistry).release(10L, null);
        verify(runningChatSnapshotService).delete(10L, null);
    }

    @Test
    void stopSentinelWaitsForBoundedQueueCapacityInsteadOfBeingDropped() throws Exception {
        OutputStreamManager outputStreamManager = mock(OutputStreamManager.class);
        ReflectionTestUtils.setField(assistantChatApplicationService, "outputStreamManager", outputStreamManager);
        ReflectionTestUtils.setField(assistantChatApplicationService, "scriptService", mock(ScriptService.class));

        SignallingQueue queue = new SignallingQueue(1);
        queue.add(new JSONObject());
        ChatProcessContext ctx = new ChatProcessContext(null, null);
        ctx.sessionId = 10L;
        ctx.gatewayEventQueue = queue;
        when(outputStreamManager.getContext("10")).thenReturn(ctx);

        StopChatDto stopChatDto = new StopChatDto();
        stopChatDto.setSessionId(10L);
        CompletableFuture<Void> flush = CompletableFuture.runAsync(() ->
            ReflectionTestUtils.invokeMethod(assistantChatApplicationService, "flushAccumulatedMessage", stopChatDto));

        assertThat(queue.awaitPut()).as("停止哨兵必须等待队列容量，不能在队列满时静默丢失").isTrue();
        assertThat(flush.isDone()).isFalse();
        queue.take();
        flush.get(1, TimeUnit.SECONDS);

        assertThat(queue.take().getString("event_type")).isEqualTo(ChatProcessContext.STOP_SENTINEL_EVENT);
    }

    @Test
    void uploadFiles_createsPendingSessionWithTimestampTitle() throws Exception {
        String sessionName = "File Upload 2026-08-11 14:30:25";
        ByaiSession session = new ByaiSession();
        session.setSessionId(10L);
        session.setSessionName(sessionName);
        when(byaiSystemConfigService.getDcSystemConfigValueByCode("DIG_EMPLOYEE_FILE_UPLOAD_CONFIG"))
            .thenReturn("{\"enabled\":false}");
        when(sessionTitleService.buildFileUploadTitle(any(Date.class))).thenReturn(sessionName);
        when(sessionService.createSession(eq(sessionName), eq("h_as"), eq(null),
            eq(ConversationObjectType.SUPER_ASSISTANT), eq(0)))
            .thenReturn(session);

        SessionUploadResult result = assistantChatApplicationService.uploadFiles(new MultipartFile[0], null, "h_as",
            null);

        assertThat(result.getSessionId()).isEqualTo(10L);
        assertThat(result.getSessionName()).isEqualTo(sessionName);
        verify(sessionTitleService).markInitialTitlePending(10L);
    }

    private static final class SignallingQueue extends ArrayBlockingQueue<JSONObject> {

        private final CountDownLatch putEntered = new CountDownLatch(1);

        SignallingQueue(int capacity) {
            super(capacity);
        }

        @Override
        public void put(JSONObject event) throws InterruptedException {
            putEntered.countDown();
            super.put(event);
        }

        boolean awaitPut() throws InterruptedException {
            return putEntered.await(1, TimeUnit.SECONDS);
        }
    }
}
