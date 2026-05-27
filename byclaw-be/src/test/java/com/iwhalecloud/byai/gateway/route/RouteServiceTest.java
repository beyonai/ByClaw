package com.iwhalecloud.byai.gateway.route;

import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhaleai.byai.framework.core.protocol.ExecutionStatus;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.PythonSseService;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentTypeResolver;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.context.support.StaticMessageSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.context.i18n.LocaleContextHolder;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RouteServiceTest {

    private GatewayClient gatewayClient;
    private PythonSseService pythonSseService;
    private SessionStreamManager sessionStreamManager;
    private SandboxService sandboxService;
    private OutputStreamManager outputStreamManager;
    private SequenceService sequenceService;
    private JwtService jwtService;
    private TargetAgentTypeResolver targetAgentTypeResolver;
    private RouteService routeService;
    private StaticMessageSource messageSource;

    @BeforeEach
    void setUp() {
        gatewayClient = mock(GatewayClient.class);
        pythonSseService = mock(PythonSseService.class);
        sessionStreamManager = mock(SessionStreamManager.class);
        sandboxService = mock(SandboxService.class);
        outputStreamManager = mock(OutputStreamManager.class);
        sequenceService = mock(SequenceService.class);
        jwtService = mock(JwtService.class);
        targetAgentTypeResolver = new TargetAgentTypeResolver();
        messageSource = new StaticMessageSource();
        messageSource.addMessage("sandbox.launch.progress.start", Locale.SIMPLIFIED_CHINESE, "个人助理正在启动中，请等待");
        messageSource.addMessage("sandbox.launch.progress.waiting", Locale.SIMPLIFIED_CHINESE, "个人助理仍在启动中，请稍等");
        messageSource.addMessage("sandbox.launch.progress.failed", Locale.SIMPLIFIED_CHINESE, "沙箱启动失败，请联系管理员");
        messageSource.addMessage("sandbox.launch.progress.start", Locale.US, "Your personal assistant is starting up, please wait.");
        messageSource.addMessage("sandbox.launch.progress.waiting", Locale.US,
                "Your personal assistant is still starting up, please wait a moment.");
        messageSource.addMessage("sandbox.launch.progress.failed", Locale.US,
                "Sandbox startup failed, please contact the administrator.");
        when(jwtService.createJwt(any())).thenReturn("test-beyond-token");

        routeService = new RouteService();
        ReflectionTestUtils.setField(routeService, "gatewayClient", gatewayClient);
        ReflectionTestUtils.setField(routeService, "pythonSseService", pythonSseService);
        ReflectionTestUtils.setField(routeService, "sessionStreamManager", sessionStreamManager);
        ReflectionTestUtils.setField(routeService, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(routeService, "outputStreamManager", outputStreamManager);
        ReflectionTestUtils.setField(routeService, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(routeService, "jwtService", jwtService);
        ReflectionTestUtils.setField(routeService, "targetAgentTypeResolver", targetAgentTypeResolver);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("u1");
        loginInfo.setUserId(100L);
        loginInfo.setUserName("testUser");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
        LocaleContextHolder.resetLocaleContext();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
    }

    @Test
    void route_retriesOnceAfterSandboxReady_whenGatewaySendFailsWithRetriableError() throws Exception {
        ChatProcessContext ctx = buildContext();
        when(sequenceService.nextVal()).thenReturn(100L);
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1"))
                .thenReturn(new com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(anyString(), anyLong())).thenReturn(true);

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(failedResponse(ExecutionStatus.ERR_WORKER_NOT_ONLINE, "worker offline"))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(currentTraceDoneEvent(ctx));
                    return successResponse();
                });
        routeService.route(ctx);

        InOrder inOrder = inOrder(gatewayClient, sandboxService);
        inOrder.verify(gatewayClient).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
        inOrder.verify(sandboxService).restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1");
        inOrder.verify(sandboxService).waitWorkerReadySync("BYCLAW_EXE_u1", SandboxService.WORKER_READY_TIMEOUT_MS);
        inOrder.verify(gatewayClient).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());

        verify(sandboxService, times(1)).restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(gatewayClient, times(2)).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());

        ArgumentCaptor<java.util.Map<String, Object>> metadataCaptor = ArgumentCaptor.forClass(java.util.Map.class);
        verify(gatewayClient, atLeastOnce()).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), metadataCaptor.capture());
        org.assertj.core.api.Assertions.assertThat(metadataCaptor.getValue())
                .containsEntry("Beyond-Token", "test-beyond-token");
        org.assertj.core.api.Assertions.assertThat(output(ctx))
                .contains("reasoningLogStart")
                .contains("个人助理正在启动中，请等待");
    }

    @Test
    void route_throwsAfterSingleRetry_whenGatewaySendStillFails() {
        ChatProcessContext ctx = buildContext();
        when(sequenceService.nextVal()).thenReturn(100L);
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1"))
                .thenReturn(new com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(anyString(), anyLong())).thenReturn(true);

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(failedResponse(ExecutionStatus.ERR_WORKER_NOT_ONLINE, "worker offline"))
                .thenReturn(failedResponse(ExecutionStatus.ERR_AGENT_TYPE_UNAVAILABLE, "agent unavailable"));
        assertThatThrownBy(() -> routeService.route(ctx))
                .isInstanceOf(BdpRuntimeException.class)
                .hasMessage("Gateway SDK 消息发送失败: agent unavailable");

        verify(sandboxService, times(1)).restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1");
        verify(gatewayClient, times(2)).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
        verify(sessionStreamManager, times(1)).stopSessionListener("3");
    }

    @Test
    void route_emitsFailureThought_whenSandboxNeverBecomesReady() {
        ChatProcessContext ctx = buildContext();
        when(sequenceService.nextVal()).thenReturn(100L, 101L, 102L, 103L);
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1"))
                .thenReturn(new com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(anyString(), anyLong())).thenReturn(false, false, false);

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(failedResponse(ExecutionStatus.ERR_WORKER_NOT_ONLINE, "worker offline"));

        assertThatThrownBy(() -> routeService.route(ctx))
                .isInstanceOf(BdpRuntimeException.class)
                .hasMessage("沙箱启动失败，请联系管理员");

        org.assertj.core.api.Assertions.assertThat(output(ctx))
                .contains("reasoningLogStart")
                .contains("reasoningLogDelta")
                .contains("reasoningLogEnd")
                .contains("个人助理仍在启动中，请稍等")
                .contains("沙箱启动失败，请联系管理员");
        verify(gatewayClient, times(1)).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
    }

    @Test
    void route_retriesByclawCodeSandboxWithUserScopedTargetAgentType() throws Exception {
        ChatProcessContext ctx = buildContext(WorkerAgentType.BYCLAW_CODE.getCode(), 123L);
        when(sequenceService.nextVal()).thenReturn(100L);
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", 123L, "BYCLAW_CODE_u1"))
                .thenReturn(new com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData());
        when(sandboxService.waitWorkerReadySync(anyString(), anyLong())).thenReturn(true);

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(failedResponse(ExecutionStatus.ERR_WORKER_NOT_ONLINE, "worker offline"))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(currentTraceDoneEvent(ctx));
                    return successResponse();
                });
        routeService.route(ctx);

        ArgumentCaptor<String> targetAgentTypeCaptor = ArgumentCaptor.forClass(String.class);
        verify(gatewayClient, times(2)).sendMessage(targetAgentTypeCaptor.capture(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());

        org.assertj.core.api.Assertions.assertThat(targetAgentTypeCaptor.getAllValues())
                .containsExactly("BYCLAW_CODE_u1", "BYCLAW_CODE_u1");
        verify(sandboxService, times(1)).restartSandboxAfterRemoteExitWithoutWait("u1", 123L, "BYCLAW_CODE_u1");
    }

    private ChatProcessContext buildContext() {
        return buildContext(WorkerAgentType.BYCLAW_EXE.getCode(), null);
    }

    private ChatProcessContext buildContext(String workerAgentType, Long agentId) {
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setChatContent("hello");
        chatDto.setAgentId(agentId);

        ChatProcessContext ctx = new ChatProcessContext(new ByteArrayOutputStream(), chatDto);
        ctx.setSessionId(3L);
        ctx.setUserMessageId(1L);
        ctx.setModelAnswerMessageId(2L);
        ctx.setParams(new HashMap<>());
        ctx.getParams().put("worker_agent_type", workerAgentType);
        return ctx;
    }

    private JSONObject currentTraceDoneEvent(ChatProcessContext ctx) {
        JSONObject event = new JSONObject();
        event.put("event_type", SseResponseEventEnum.appStreamResponse);
        event.put("trace_id", ctx.getUserMessageId() + "_" + ctx.getModelAnswerMessageId());
        event.put("data", "{}");
        return event;
    }

    private GatewayClient.SendResponse successResponse() {
        return GatewayClient.SendResponse.builder()
                .success(true)
                .messageId("msg-1")
                .targetWorkerId("worker-1")
                .build();
    }

    private GatewayClient.SendResponse failedResponse(String errorCode, String error) {
        return GatewayClient.SendResponse.builder()
                .success(false)
                .errorCode(errorCode)
                .error(error)
                .build();
    }

    private String output(ChatProcessContext ctx) {
        return new String(((ByteArrayOutputStream) ctx.res).toByteArray(), StandardCharsets.UTF_8);
    }
}
