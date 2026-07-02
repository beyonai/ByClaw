package com.iwhalecloud.byai.gateway.route;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhaleai.byai.framework.core.protocol.ActionType;
import com.iwhaleai.byai.framework.core.protocol.ExecutionStatus;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.feign.response.sandbox.SandboxLaunchData;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.common.enums.MessageContentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.ChatStreamRuntimeCoordinator;
import com.iwhalecloud.byai.state.domain.chat.service.GatewayStreamEventProcessor;
import com.iwhalecloud.byai.state.domain.chat.service.PythonSseService;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentResolver;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import static com.iwhalecloud.byai.gateway.sandbox.service.SandboxService.WORKER_READY_TIMEOUT_MS;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RouteService {

    private static final int SANDBOX_STARTUP_WAIT_ROUNDS = 5;

    @Autowired
    private GatewayClient gatewayClient;

    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private GatewayStreamEventProcessor gatewayStreamEventProcessor;

    @Autowired
    private ChatStreamRuntimeCoordinator chatStreamRuntimeCoordinator;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private TargetAgentResolver targetAgentResolver;

    @Autowired
    private InterfaceRouteService interfaceRouteService;

    @Autowired
    private A2aRouteService a2aRouteService;

    /**
     * 判断是否为接口集成类型
     */
    private boolean isIntegrationTypeInterface(ChatProcessContext ctx) {
        AssistantChatDto chatDto = ctx.getAssistantChatDto();
        Long agentId = chatDto.getAgentId();
        if (agentId == null) {
            return false;
        }
        List<AgentResourceChatInfoDto> chatAgentResourceInfo = (List<AgentResourceChatInfoDto>) ctx.getParams().get("agent_list");
        if (CollectionUtils.isEmpty(chatAgentResourceInfo)) {
            return false;
        }
        return chatAgentResourceInfo.stream().anyMatch(
                item -> item.getId().equals(agentId) &&
                        "FROM_THIRD".equals(item.getCreateType()) &&
                        "INTERFACE".equals(item.getIntegrationType()));
    }

    /**
     * 判断是否为A2A集成类型
     */
    private boolean isIntegrationTypeA2A(ChatProcessContext ctx) {
        AssistantChatDto chatDto = ctx.getAssistantChatDto();
        Long agentId = chatDto.getAgentId();
        if (agentId == null) {
            return false;
        }
        List<AgentResourceChatInfoDto> chatAgentResourceInfo = (List<AgentResourceChatInfoDto>) ctx.getParams().get("agent_list");
        if (CollectionUtils.isEmpty(chatAgentResourceInfo)) {
            return false;
        }
        return chatAgentResourceInfo.stream().anyMatch(
                item -> item.getId().equals(agentId) &&
                        "FROM_THIRD".equals(item.getCreateType()) &&
                        "A2A".equals(item.getIntegrationType()));
    }

    /**
     * Gateway 模式：通过 Gateway SDK 发送消息后，请求线程在本方法中循环消费事件队列，
     * 将每个 answerDelta 等增量事件即时写入 OutputStream，实现 SSE 实时推流。
     * <p>
     * 核心思路：所有 OutputStream 写操作都在 Tomcat 请求线程（http-nio-*）上执行，
     * 避免非请求线程写流时 Tomcat NIO 不能实时 flush 到 TCP socket 的问题。
     * Redis 监听器只负责将事件 JSONObject 投入 gatewayEventQueue，本方法消费队列并写流。
     * 收到 appStreamResponse 或 error 事件后退出循环，由 execute() 继续调用
     * storeMessage / afterProcess，最终由 cleanupResources 关闭流。
     */
    public void route(ChatProcessContext ctx) throws Exception {
        if (isIntegrationTypeInterface(ctx)) {
            interfaceRouteService.route(ctx);
            return;
        }
        if (isIntegrationTypeA2A(ctx)) {
            a2aRouteService.route(ctx);
            return;
        }

        ctx.loginInfo = CurrentUserHolder.getLoginInfo();

        String sessionId = String.valueOf(ctx.sessionId);
        String userCode = (ctx.loginInfo != null && ctx.loginInfo.getUserCode() != null)
                ? ctx.loginInfo.getUserCode()
                : "";
        if (userCode.isEmpty()) {
            return;
        }

        AssistantChatDto chatDto = ctx.getAssistantChatDto();
        // openclaw的workerId，固定这样拼接，在openclaw的channel实现中要保持一致
        String targetAgentType = MapParamUtil.getStringValue(ctx.getParams(), "worker_agent_type") ;
        String content = ctx.assistantChatDto.getChatContent();
        Long agentId = ctx.assistantChatDto.getAgentId();
        List<ResourceVo> resourceList = chatDto.getResourceList();

        targetAgentType = targetAgentResolver.resolveAgentType(targetAgentType, agentId, chatDto.getSourceAgentType(),
                userCode);
        ctx.targetAgentType = targetAgentType;

        // 处理 content 中的资源占位符替换，如 {{DIG_EMPLOYEE_10812779}} 替换为 @xxxxx
        content = replaceResourcePlaceholders(content, resourceList);

        boolean runtimeStarted = chatStreamRuntimeCoordinator.startIfNecessary(ctx);

        String answerMessageId = StringUtils.isNotEmpty(ctx.assistantChatDto.getResumeMessageId())
            ? ctx.assistantChatDto.getResumeMessageId()
            : String.valueOf(ctx.modelAnswerMessageId);
        String traceId = ctx.traceId;

        String reqMetadata = ctx.assistantChatDto.getMetadata();

        GatewayClient.SendResponse response;
        try {
            response = sendMessageWithWorkerRetry(
                    userCode,
                    sessionId,
                    content,
                    chatDto,
                    ctx.getParams(),
                    answerMessageId,
                    traceId,
                    reqMetadata,
                    targetAgentType,
                    agentId,
                    ctx
            );
        } catch (Exception e) {
            chatStreamRuntimeCoordinator.stopIfStarted(sessionId, runtimeStarted);
            throw e;
        }

        log.info("Gateway SDK 消息发送成功, messageId: {}, targetWorker: {}, sessionId: {}, content: {}",
                response.getMessageId(), response.getTargetWorkerId(), sessionId, content);

        if (ctx.sendByFrameworkMsgOnly) {
            log.info("会话复用已有 Redis Stream 监听，本次仅发送 Gateway 消息完成, sessionId: {}, traceId: {}",
                sessionId, traceId);
            return;
        }

        if (ChatTransport.WEBSOCKET.equals(ctx.transport)) {
            ctx.asyncResponse = true;
            log.info("WebSocket 会话已发送 Gateway，后续由 Redis Stream 路由异步推送, sessionId: {}, traceId: {}",
                sessionId, traceId);
            return;
        }

        try {
            // 请求线程循环消费事件队列，依次写入 OutputStream，保证逐包实时推流
            while (true) {
                JSONObject dataJson = ctx.gatewayEventQueue.poll(5, TimeUnit.MINUTES);
                if (dataJson == null) {
                    log.error("Gateway 响应超时, sessionId: {}", sessionId);
                    throw new BdpRuntimeException("Gateway 响应超时");
                }

                // 用户停止会话：stopChat 向队列投递的停止哨兵。退出事件循环，
                // 由 execute() 继续调用 storeMessage/afterProcess 将已堆积内容按正常完成落库。
                if (ChatProcessContext.STOP_SENTINEL_EVENT.equals(dataJson.getString("event_type"))) {
                    if (ctx.messageContext != null) {
                        ctx.messageContext.setComplete(true);
                    }
                    log.info("收到停止哨兵，退出事件循环并落库已堆积消息, sessionId: {}", sessionId);
                    chatStreamRuntimeCoordinator.stopIfStarted(sessionId, runtimeStarted);
                    break;
                }

                String eventType = dataJson.getString("event_type");

                JSONObject metadata = dataJson.getJSONObject("metadata");
                if (gatewayStreamEventProcessor.handleHistoryEventIfNecessary(ctx, dataJson)) {
                    continue;
                }

                eventType = gatewayStreamEventProcessor.normalizeEventType(ctx, dataJson);
                if (gatewayStreamEventProcessor.shouldIgnoreEvent(ctx, eventType, dataJson)) {
                    continue;
                }

                // ========== 当前 traceId：原有逻辑，积累 + 推送客户端 ==========
                String errorMsg = metadata != null ? metadata.getString("error") : "unknown gateway error";
                if (metadata == null) {
                    metadata = new JSONObject();
                }
                // 错误事件：写出错误消息，标记 gatewayError，退出循环
                if (SseResponseEventEnum.error.equals(eventType)) {
                    JSONObject errorPayload = new JSONObject();
                    errorPayload.put("message", errorMsg);
                    errorPayload.put("traceback", errorMsg);
                    errorPayload.put("sessionId", sessionId);
                    CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.error, errorPayload.toJSONString());
                    ctx.gatewayError = true;
                    log.error("收到 Gateway error 事件，退出事件循环, sessionId: {}", sessionId);
                    chatStreamRuntimeCoordinator.stopIfStarted(sessionId, runtimeStarted);
                    break;
                }

                // 其他事件（answerDelta / answerStart / answerEnd 等）：
                // 构造与 Python SSE 格式一致的 JSON 行，写入 OutputStream
                String eventData = gatewayStreamEventProcessor.buildEventData(ctx, dataJson, metadata);
                JSONObject lineJson = new JSONObject();
                lineJson.put("event", eventType);
                lineJson.put("data", eventData);

                pythonSseService.getContentFromPythonStreamV3(lineJson.toJSONString(), ctx.res,
                        ctx.messageContext, ctx.getAgentIds(), ctx);

                // 任务正常结束：storeMessage() 将在请求线程中写出含完整数据的 appStreamResponse
                if (SseResponseEventEnum.appStreamResponse.equals(eventType)) {
                    if (ctx.messageContext != null) {
                        ctx.messageContext.setComplete(true);
                    }
                    log.info("收到 appStreamResponse，退出事件循环, sessionId: {}", sessionId);
                    chatStreamRuntimeCoordinator.stopIfStarted(sessionId, runtimeStarted);
                    break;
                }
            }
        } finally {
            // 无论正常/超时/异常，当前请求如果启动了监听，则负责停止并清理上下文。
            chatStreamRuntimeCoordinator.stopIfStarted(sessionId, runtimeStarted);
        }
    }

    /**
     * 替换内容中的资源占位符
     * 将 {{resourceType_resourceId}} 格式替换为对应的资源名称
     * 如果资源类型为 DIG_EMPLOYEE，则在名称前添加 @ 符号，并在替换内容后添加空格
     *
     * @param content 原始内容
     * @param resourceList 资源列表
     * @return 替换后的内容
     */
    private String replaceResourcePlaceholders(String content, List<ResourceVo> resourceList) {
        if (StringUtils.isBlank(content) || CollectionUtils.isEmpty(resourceList)) {
            return content;
        }

        // 检查是否包含占位符格式 {{}}
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("\\{\\{([^}]++)\\}\\}");
        java.util.regex.Matcher matcher = pattern.matcher(content);

        // 构建资源ID到资源信息的映射，resourceId的格式为：resourceType_resourceId
        Map<String, ResourceVo> resourceMap = new HashMap<>();
        for (ResourceVo resource : resourceList) {
            if (resource.getResourceType() != null && StringUtils.isNotBlank(resource.getResourceId())) {
                // 构建ID格式：resourceType_resourceId，如 DIG_EMPLOYEE_10812779
                String resourceKey = resource.getResourceType().getCode() + "_" + resource.getResourceId();
                resourceMap.put(resourceKey, resource);
            } else if (StringUtils.isNotBlank(resource.getId())) {
                resourceMap.put(resource.getId(), resource);
            }
        }

        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String placeholder = matcher.group(1); // 获取占位符内部的内容，如 DIG_EMPLOYEE_10812779
            String replacement = resolveResourcePlaceholder(placeholder, resourceMap);

            if (replacement != null) {
                replacement = prefixResourcePlaceholder(replacement);
                matcher.appendReplacement(result, java.util.regex.Matcher.quoteReplacement(replacement + " "));
            }
            // 如果找不到对应的资源，保留原占位符
        }
        matcher.appendTail(result);

        return result.toString();
    }

    private String prefixResourcePlaceholder(String replacement) {
        if (replacement.startsWith("@")) {
            return replacement;
        }
        return "#" + replacement;
    }

    private String resolveResourcePlaceholder(String placeholder, Map<String, ResourceVo> resourceMap) {
        if (StringUtils.isBlank(placeholder)) {
            return null;
        }
        if (placeholder.contains("#")) {
            String[] parts = placeholder.split("#");
            List<String> replacements = new ArrayList<>();
            for (String part : parts) {
                String replacement = resolveSingleResourcePlaceholder(part, resourceMap);
                if (replacement == null) {
                    return null;
                }
                replacements.add(replacement);
            }
            return String.join("#", replacements);
        }
        return resolveSingleResourcePlaceholder(placeholder, resourceMap);
    }

    private String resolveSingleResourcePlaceholder(String placeholder, Map<String, ResourceVo> resourceMap) {
        ResourceVo resource = resourceMap.get(placeholder);
        if (resource == null || StringUtils.isBlank(resource.getResourceName())) {
            return null;
        }
        String replacement = resource.getResourceName();
        // 如果资源类型为 DIG_EMPLOYEE，则在名称前添加 @ 符号
        if (AgentMetaEnum.DIG_EMPLOYEE.equals(resource.getResourceType())) {
            replacement = "@" + replacement;
        }
        return replacement;
    }

    private GatewayClient.SendResponse sendMessageWithWorkerRetry(String userCode,
                                                                  String sessionId,
                                                                  String content,
                                                                  AssistantChatDto chatDto,
                                                                  Map<String, Object> params,
                                                                  String answerMessageId,
                                                                  String traceId,
                                                                  String reqMetadata,
                                                                  String targetAgentType,
                                                                  Long agentId,
                                                                  ChatProcessContext ctx) {
        final int maxRetryAttemptsAfterWorkerReady = 1;
        int retryAttemptsAfterWorkerReady = 0;

        String currentUserName = CurrentUserHolder.getCurrentUserName();
        Map<String, Object> metadata = reqMetadata == null
          ? new HashMap<>()
          : JSON.parseObject(reqMetadata, Map.class);
        metadata.put("language", ChatUtils.getLanguage());
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo != null) {
            String beyondToken = jwtService.createJwt(loginInfo);
            metadata.put("Beyond-Token", beyondToken);
            Map<String, Object> requestHeaders = new HashMap<>();
            requestHeaders.put("Beyond-Token", beyondToken);
            metadata.put("request_headers", requestHeaders);
        }

        Map<String, String> channelExtension = chatDto.getChannelExtension();
        if (channelExtension != null && !channelExtension.isEmpty()) {
            metadata.put("channelExtension", channelExtension);
        }

        List<MessageFileDto> files = chatDto.getFiles();
        JSONArray contentObjects = new JSONArray();
        Object messageContent = content;
        if (CollectionUtils.isNotEmpty(files)) {
            JSONObject contentObject = new JSONObject();
            contentObject.put("text", content);
            contentObject.put("files", files);

            JSONObject userMessage = new JSONObject();
            userMessage.put("role", "user");
            userMessage.put("content", contentObject);
            contentObjects.add(userMessage);
            messageContent = contentObjects;
        }

        while (true) {
            GatewayClient.SendResponse response = gatewayClient.sendMessage(
                targetAgentType,
                sessionId,
                messageContent,
                userCode,
                currentUserName,
                chatDto.getActionType() == null ? ActionType.ASK_AGENT : chatDto.getActionType(),
                "-1",
                answerMessageId,
                traceId,
                params,
                metadata
            );

            if (response.isSuccess()) {
                return response;
            }

            log.error("Gateway SDK 消息发送失败, sessionId: {}, errorCode: {}, error: {}",
                    sessionId, response.getErrorCode(), response.getError());

            if (retryAttemptsAfterWorkerReady < maxRetryAttemptsAfterWorkerReady
                    && shouldRetryAfterSandboxReady(targetAgentType, userCode, response)) {
                retryAttemptsAfterWorkerReady++;
                log.info("Gateway SDK 消息发送失败，按远端沙箱退出处理并重拉后重试一次, sessionId: {}, userCode: {}, agentId: {}, targetAgentType: {}, errorCode: {}",
                        sessionId, userCode, agentId, targetAgentType, response.getErrorCode());
                restartSandboxWithProgress(ctx, userCode, agentId, targetAgentType);
                continue;
            }

            throw new BdpRuntimeException("Gateway SDK 消息发送失败: " + response.getError());
        }
    }

    private void restartSandboxWithProgress(ChatProcessContext ctx, String userCode, Long agentId,
        String targetAgentType) {
        sendSandboxProgressMessage(ctx, SseResponseEventEnum.reasoningLogStart,
            I18nUtil.get("sandbox.launch.progress.start"));

        SandboxLaunchData launchData;
        try {
            launchData = sandboxService.restartSandboxAfterRemoteExitWithoutWait(userCode, agentId, targetAgentType);
        }
        catch (Exception e) {
            String failureMessage = resolveSandboxLaunchFailureMessage(e);
            sendSandboxProgressMessage(ctx, SseResponseEventEnum.reasoningLogEnd, failureMessage);
            throw new BdpRuntimeException(failureMessage, e);
        }

        if (launchData == null) {
            sendSandboxProgressMessage(ctx, SseResponseEventEnum.reasoningLogEnd,
                I18nUtil.get("sandbox.launch.progress.failed"));
            throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.progress.failed"));
        }

        for (int round = 1; round <= SANDBOX_STARTUP_WAIT_ROUNDS; round++) {
            if (sandboxService.waitWorkerReadySync(targetAgentType, WORKER_READY_TIMEOUT_MS)) {
                return;
            }
            if (round < SANDBOX_STARTUP_WAIT_ROUNDS) {
                sendSandboxProgressMessage(ctx, SseResponseEventEnum.reasoningLogDelta,
                    I18nUtil.get("sandbox.launch.progress.waiting"));
            }
        }

        sendSandboxProgressMessage(ctx, SseResponseEventEnum.reasoningLogEnd,
            I18nUtil.get("sandbox.launch.progress.failed"));
        throw new BdpRuntimeException(I18nUtil.get("sandbox.launch.progress.failed"));
    }

    private String resolveSandboxLaunchFailureMessage(Throwable throwable) {
        String userFacingMessage = findUserFacingSandboxLaunchFailureMessage(throwable);
        return StringUtils.defaultIfBlank(userFacingMessage, I18nUtil.get("sandbox.launch.progress.failed"));
    }

    private String findUserFacingSandboxLaunchFailureMessage(Throwable throwable) {
        Throwable cursor = throwable;
        while (cursor != null) {
            if (cursor instanceof BdpRuntimeException && StringUtils.isNotBlank(cursor.getMessage())) {
                return cursor.getMessage();
            }
            cursor = cursor.getCause();
        }
        return null;
    }

    private void sendSandboxProgressMessage(ChatProcessContext ctx, String event, String message) {
        if (ctx == null || ctx.res == null || StringUtils.isBlank(message)) {
            return;
        }

        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setContentType(MessageContentTypeEnum.THINK_TEXT.getCode());
        answerDelta.setOrderId(String.valueOf(sequenceService.nextVal()));

        ChoiceDto choiceDto = new ChoiceDto();
        choiceDto.setDelta(new DeltaDto(message + "\n"));
        answerDelta.setChoices(Collections.singletonList(choiceDto));

        CompletionsUtils.responseWrite(ctx.res, event, JSON.toJSONString(answerDelta), ctx.sessionId);
    }

    private boolean shouldRetryAfterSandboxReady(String targetAgentType,
                                                 String userCode,
                                                 GatewayClient.SendResponse response) {
        return isUserSandboxAgentType(targetAgentType, userCode)
                && (ExecutionStatus.ERR_WORKER_NOT_ONLINE.equalsIgnoreCase(response.getErrorCode())
                || ExecutionStatus.ERR_AGENT_TYPE_UNAVAILABLE.equalsIgnoreCase(response.getErrorCode()));
    }

    private boolean isUserSandboxAgentType(String targetAgentType, String userCode) {
        return targetAgentResolver.isUserSandboxAgentType(targetAgentType, userCode);
    }

}
