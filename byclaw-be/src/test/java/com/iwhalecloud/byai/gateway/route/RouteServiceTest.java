package com.iwhalecloud.byai.gateway.route;

import com.alibaba.fastjson.JSONObject;
import com.alibaba.fastjson.JSONArray;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhaleai.byai.framework.core.protocol.ExecutionStatus;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatStreamRuntimeCoordinator;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.GatewayStreamEventProcessor;
import com.iwhalecloud.byai.state.domain.chat.service.PythonSseService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.chat.service.TraceIdCodec;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
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
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Locale;
import java.util.concurrent.LinkedBlockingQueue;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class RouteServiceTest {

    private GatewayClient gatewayClient;
    private PythonSseService pythonSseService;
    private GatewayStreamEventProcessor gatewayStreamEventProcessor;
    private ChatStreamRuntimeCoordinator chatStreamRuntimeCoordinator;
    private SandboxService sandboxService;
    private SequenceService sequenceService;
    private JwtService jwtService;
    private TargetAgentResolver targetAgentResolver;
    private RouteService routeService;
    private StaticMessageSource messageSource;

    @BeforeEach
    void setUp() {
        gatewayClient = mock(GatewayClient.class);
        pythonSseService = mock(PythonSseService.class);
        gatewayStreamEventProcessor = new GatewayStreamEventProcessor();
        chatStreamRuntimeCoordinator = mock(ChatStreamRuntimeCoordinator.class);
        sandboxService = mock(SandboxService.class);
        sequenceService = mock(SequenceService.class);
        jwtService = mock(JwtService.class);
        targetAgentResolver = new TargetAgentResolver();
        messageSource = new StaticMessageSource();
        messageSource.addMessage("sandbox.launch.progress.start", Locale.SIMPLIFIED_CHINESE, "个人助理正在启动中，请等待");
        messageSource.addMessage("sandbox.launch.progress.waiting", Locale.SIMPLIFIED_CHINESE, "个人助理仍在启动中，请稍等");
        messageSource.addMessage("sandbox.launch.progress.ready", Locale.SIMPLIFIED_CHINESE, "个人助理已启动，正在处理请求");
        messageSource.addMessage("sandbox.launch.progress.failed", Locale.SIMPLIFIED_CHINESE, "沙箱启动失败，请联系管理员");
        messageSource.addMessage("sandbox.launch.model.config.required", Locale.SIMPLIFIED_CHINESE,
                "沙箱启动失败，模型参数配置不完整，请联系管理员");
        messageSource.addMessage("sandbox.launch.progress.start", Locale.US, "Your personal assistant is starting up, please wait.");
        messageSource.addMessage("sandbox.launch.progress.waiting", Locale.US,
                "Your personal assistant is still starting up, please wait a moment.");
        messageSource.addMessage("sandbox.launch.progress.ready", Locale.US,
                "Your personal assistant is ready and processing your request.");
        messageSource.addMessage("sandbox.launch.progress.failed", Locale.US,
                "Sandbox startup failed, please contact the administrator.");
        messageSource.addMessage("sandbox.launch.model.config.required", Locale.US,
                "Sandbox startup failed because model parameters are incomplete. Please contact the administrator.");
        when(jwtService.createJwt(any())).thenReturn("test-beyond-token");

        routeService = new RouteService();
        ReflectionTestUtils.setField(routeService, "gatewayClient", gatewayClient);
        ReflectionTestUtils.setField(routeService, "pythonSseService", pythonSseService);
        ReflectionTestUtils.setField(routeService, "gatewayStreamEventProcessor", gatewayStreamEventProcessor);
        ReflectionTestUtils.setField(routeService, "chatStreamRuntimeCoordinator", chatStreamRuntimeCoordinator);
        ReflectionTestUtils.setField(routeService, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(routeService, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(routeService, "jwtService", jwtService);
        ReflectionTestUtils.setField(routeService, "targetAgentResolver", targetAgentResolver);
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
                .contains("reasoningLogEnd")
                .contains("个人助理正在启动中，请等待")
                .contains("个人助理已启动，正在处理请求");
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
        verify(chatStreamRuntimeCoordinator, times(1)).stopIfStarted("3", true);
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
    void route_emitsModelConfigMessage_whenSandboxRestartFailsWithBusinessException() {
        ChatProcessContext ctx = buildContext();
        when(sequenceService.nextVal()).thenReturn(100L);
        when(sandboxService.restartSandboxAfterRemoteExitWithoutWait("u1", null, "BYCLAW_EXE_u1"))
                .thenThrow(new BdpRuntimeException(I18nUtil.get("sandbox.launch.model.config.required")));

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenReturn(failedResponse(ExecutionStatus.ERR_AGENT_TYPE_UNAVAILABLE, "agent unavailable"));

        assertThatThrownBy(() -> routeService.route(ctx))
                .isInstanceOf(BdpRuntimeException.class)
                .hasMessage("沙箱启动失败，模型参数配置不完整，请联系管理员");

        org.assertj.core.api.Assertions.assertThat(output(ctx))
                .contains("reasoningLogStart")
                .contains("reasoningLogEnd")
                .contains("沙箱启动失败，模型参数配置不完整，请联系管理员")
                .doesNotContain("沙箱启动失败，请联系管理员");
        verify(gatewayClient, times(1)).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
        verify(sandboxService, never()).waitWorkerReadySync(anyString(), anyLong());
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

    @Test
    void route_replacesCompositeSkillPlaceholderBeforeSendingToGateway() throws Exception {
        ChatProcessContext ctx = buildContext();
        ctx.getAssistantChatDto().setChatContent(
                "{{DIG_EMPLOYEE_10000998#SKILL_/.openclaw/workspace-baiying-agent-10000998/skills/persona-cfo}}22");

        ResourceVo agent = new ResourceVo();
        agent.setResourceType(AgentMetaEnum.DIG_EMPLOYEE);
        agent.setResourceId("10000998");
        agent.setResourceName("liu0518");

        ResourceVo skill = new ResourceVo();
        skill.setResourceType(AgentMetaEnum.SKILL);
        skill.setResourceId("/.openclaw/workspace-baiying-agent-10000998/skills/persona-cfo");
        skill.setResourceName("persona-cfo");
        ctx.getAssistantChatDto().setResourceList(Arrays.asList(agent, skill));

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(currentTraceDoneEvent(ctx));
                    return successResponse();
                });

        routeService.route(ctx);

        ArgumentCaptor<Object> contentCaptor = ArgumentCaptor.forClass(Object.class);
        verify(gatewayClient).sendMessage(anyString(), anyString(), contentCaptor.capture(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
        org.assertj.core.api.Assertions.assertThat(contentCaptor.getValue()).isEqualTo("@liu0518#persona-cfo 22");
    }

    @Test
    void route_prefixesNonMentionPlaceholderBeforeSendingToGateway() throws Exception {
        ChatProcessContext ctx = buildContext();
        ctx.getAssistantChatDto().setChatContent(
                "{{SKILL_/.openclaw/workspace-baiying-agent-10000998/skills/persona-cfo}}22");

        ResourceVo skill = new ResourceVo();
        skill.setResourceType(AgentMetaEnum.SKILL);
        skill.setResourceId("/.openclaw/workspace-baiying-agent-10000998/skills/persona-cfo");
        skill.setResourceName("persona-cfo");
        ctx.getAssistantChatDto().setResourceList(Arrays.asList(skill));

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(currentTraceDoneEvent(ctx));
                    return successResponse();
                });

        routeService.route(ctx);

        ArgumentCaptor<Object> contentCaptor = ArgumentCaptor.forClass(Object.class);
        verify(gatewayClient).sendMessage(anyString(), anyString(), contentCaptor.capture(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());
        org.assertj.core.api.Assertions.assertThat(contentCaptor.getValue()).isEqualTo("#persona-cfo 22");
    }

    @Test
    void route_sendsSingleAgentHandoffRequestWithoutBackendContextInjection() throws Exception {
        ChatProcessContext ctx = buildContext();
        ctx.getAssistantChatDto().setChatContent("请承接上条 coder 交接单，并给出 reviewer 结论");
        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(currentTraceDoneEvent(ctx));
                    return successResponse();
                });

        routeService.route(ctx);

        ArgumentCaptor<Object> contentCaptor = ArgumentCaptor.forClass(Object.class);
        verify(gatewayClient).sendMessage(anyString(), anyString(), contentCaptor.capture(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any());

        org.assertj.core.api.Assertions.assertThat(contentCaptor.getValue().toString())
                .isEqualTo("请承接上条 coder 交接单，并给出 reviewer 结论")
                .doesNotContain("[ByClaw handoff context]");
    }

    @Test
    void route_sendsSingleGatewayMessageWithMultiAgentLaneBatchPayload() throws Exception {
        ChatProcessContext ctx = buildContext();
        ctx.getAssistantChatDto().setChatContent("请承接任务并分别回答");
        JSONObject multiAgent = new JSONObject();
        multiAgent.put("turnId", "turn-1");
        multiAgent.put("mode", "parallel");
        JSONArray lanes = new JSONArray();
        lanes.add(lane("lane-a", 101L, "agent-a", "Agent A", "client-a", 11L, 21L, 1));
        lanes.add(lane("lane-b", 102L, "agent-b", "Agent B", "client-b", 12L, 22L, 2));
        multiAgent.put("lanes", lanes);
        ctx.getAssistantChatDto().getExtParams().put("multiAgent", multiAgent);
        when(sequenceService.nextVal()).thenReturn(1001L, 1002L);

        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(doneEvent(TraceIdCodec.encode(11L, 21L)));
                    ctx.gatewayEventQueue.offer(doneEvent(TraceIdCodec.encode(12L, 22L)));
                    return successResponse();
                });

        routeService.route(ctx);

        ArgumentCaptor<String> answerMessageIdCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> traceIdCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object> contentCaptor = ArgumentCaptor.forClass(Object.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> paramsCaptor = (ArgumentCaptor) ArgumentCaptor.forClass(Map.class);
        verify(gatewayClient).sendMessage(anyString(), anyString(), contentCaptor.capture(), anyString(), any(),
                anyString(), anyString(), answerMessageIdCaptor.capture(), traceIdCaptor.capture(),
                paramsCaptor.capture(), any());

        String laneATraceId = TraceIdCodec.encode(11L, 21L);
        String laneBTraceId = TraceIdCodec.encode(12L, 22L);
        org.assertj.core.api.Assertions.assertThat(contentCaptor.getValue()).isEqualTo("请承接任务并分别回答");
        org.assertj.core.api.Assertions.assertThat(answerMessageIdCaptor.getValue()).isEqualTo("2");
        org.assertj.core.api.Assertions.assertThat(traceIdCaptor.getValue())
                .isEqualTo(TraceIdCodec.encode(ctx.getUserMessageId(), ctx.getModelAnswerMessageId()));
        Map<String, Object> params = paramsCaptor.getValue();
        JSONObject batchPayload = (JSONObject) params.get("multi_agent");
        org.assertj.core.api.Assertions.assertThat(batchPayload)
                .containsEntry("turnId", "turn-1")
                .containsEntry("mode", "parallel");
        JSONArray batchLanes = batchPayload.getJSONArray("lanes");
        org.assertj.core.api.Assertions.assertThat(batchLanes).hasSize(2);
        JSONObject laneAPayload = batchLanes.stream()
                .map(JSONObject.class::cast)
                .filter(payload -> "lane-a".equals(payload.getString("laneId")))
                .findFirst()
                .orElseThrow();
        org.assertj.core.api.Assertions.assertThat(laneAPayload)
                .containsEntry("laneId", "lane-a")
                .containsEntry("clientRequestId", "client-a")
                .containsEntry("queryMessageId", "11")
                .containsEntry("answerMessageId", "21")
                .containsEntry("traceId", laneATraceId);
        JSONObject laneBPayload = batchLanes.stream()
                .map(JSONObject.class::cast)
                .filter(payload -> "lane-b".equals(payload.getString("laneId")))
                .findFirst()
                .orElseThrow();
        org.assertj.core.api.Assertions.assertThat(laneBPayload)
                .containsEntry("laneId", "lane-b")
                .containsEntry("clientRequestId", "client-b")
                .containsEntry("queryMessageId", "12")
                .containsEntry("answerMessageId", "22")
                .containsEntry("traceId", laneBTraceId);
        org.assertj.core.api.Assertions.assertThat(ctx.getMultiAgentMessageContextsByTraceId())
                .containsKeys(laneATraceId, laneBTraceId);
        org.assertj.core.api.Assertions.assertThat(ctx.getMultiAgentMessageContextsByTraceId().get(laneATraceId)
                .getMessageId()).isEqualTo(1001L);
        org.assertj.core.api.Assertions.assertThat(ctx.getMultiAgentMessageContextsByTraceId().get(laneBTraceId)
                .getMessageId()).isEqualTo(1002L);
    }

    @Test
    void route_derivesUniqueTraceIdsForMultiAgentLanesWhenMessageIdsAreMissing() throws Exception {
        ChatProcessContext ctx = buildContext();
        JSONObject multiAgent = new JSONObject();
        multiAgent.put("turnId", "turn-1");
        multiAgent.put("mode", "parallel");
        JSONArray lanes = new JSONArray();
        lanes.add(lane("lane-a", 101L, "agent-a", "Agent A", "client-a", null, null, 1));
        lanes.add(lane("lane-b", 102L, "agent-b", "Agent B", "client-b", null, null, 2));
        multiAgent.put("lanes", lanes);
        ctx.getAssistantChatDto().getExtParams().put("multiAgent", multiAgent);

        String laneATraceId = ctx.getTraceId() + ":lane:client-a";
        String laneBTraceId = ctx.getTraceId() + ":lane:client-b";
        when(gatewayClient.sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), any(), any()))
                .thenAnswer(invocation -> {
                    ctx.gatewayEventQueue.offer(doneEvent(laneATraceId));
                    ctx.gatewayEventQueue.offer(doneEvent(laneBTraceId));
                    return successResponse();
                });

        routeService.route(ctx);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Map<String, Object>> paramsCaptor = (ArgumentCaptor) ArgumentCaptor.forClass(Map.class);
        verify(gatewayClient).sendMessage(anyString(), anyString(), any(), anyString(), any(),
                anyString(), anyString(), anyString(), anyString(), paramsCaptor.capture(), any());

        JSONObject batchPayload = (JSONObject) paramsCaptor.getValue().get("multi_agent");
        JSONArray batchLanes = batchPayload.getJSONArray("lanes");
        JSONObject laneAPayload = batchLanes.stream()
                .map(JSONObject.class::cast)
                .filter(payload -> "lane-a".equals(payload.getString("laneId")))
                .findFirst()
                .orElseThrow();
        JSONObject laneBPayload = batchLanes.stream()
                .map(JSONObject.class::cast)
                .filter(payload -> "lane-b".equals(payload.getString("laneId")))
                .findFirst()
                .orElseThrow();

        org.assertj.core.api.Assertions.assertThat(laneAPayload.getString("traceId")).isEqualTo(laneATraceId);
        org.assertj.core.api.Assertions.assertThat(laneBPayload.getString("traceId")).isEqualTo(laneBTraceId);
        org.assertj.core.api.Assertions.assertThat(ctx.getMultiAgentTraceIds())
                .containsExactlyInAnyOrder(laneATraceId, laneBTraceId);
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
        ctx.setTraceId(TraceIdCodec.encode(ctx.getUserMessageId(), ctx.getModelAnswerMessageId()));
        ctx.setMessageContext(new MessageContext(AgentTypeEnum.AGENT, ctx.getModelAnswerMessageId()));
        ctx.setParams(new HashMap<>());
        ctx.getParams().put("worker_agent_type", workerAgentType);
        ctx.gatewayEventQueue = new LinkedBlockingQueue<>();
        when(chatStreamRuntimeCoordinator.startIfNecessary(ctx)).thenReturn(true);
        return ctx;
    }

    private JSONObject currentTraceDoneEvent(ChatProcessContext ctx) {
        return doneEvent(TraceIdCodec.encode(ctx.getUserMessageId(), ctx.getModelAnswerMessageId()));
    }

    private JSONObject doneEvent(String traceId) {
        JSONObject event = new JSONObject();
        event.put("event_type", SseResponseEventEnum.appStreamResponse);
        event.put("trace_id", traceId);
        event.put("data", "{}");
        return event;
    }

    private JSONObject lane(String laneId, Long agentId, String agentCode, String agentName, String clientRequestId,
        Long queryMessageId, Long answerMessageId, Integer order) {
        JSONObject lane = new JSONObject();
        lane.put("laneId", laneId);
        lane.put("agentId", agentId);
        lane.put("agentCode", agentCode);
        lane.put("agentName", agentName);
        lane.put("clientRequestId", clientRequestId);
        if (queryMessageId != null) {
            lane.put("queryMessageId", String.valueOf(queryMessageId));
        }
        if (answerMessageId != null) {
            lane.put("answerMessageId", String.valueOf(answerMessageId));
        }
        lane.put("order", order);
        return lane;
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
