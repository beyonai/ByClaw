package com.iwhalecloud.byai.gateway.route;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.client.GatewayClient;
import com.iwhaleai.byai.framework.core.protocol.ActionType;
import com.iwhaleai.byai.framework.core.protocol.ExecutionStatus;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.feign.request.manager.AgentResourceChatInfoDto;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.PythonSseService;
import com.iwhalecloud.byai.state.domain.chat.service.ScriptService;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.TargetAgentTypeResolver;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.ChatUtils;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class RouteService {

    @Autowired
    private GatewayClient gatewayClient;

    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private SessionStreamManager sessionStreamManager;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private TargetAgentTypeResolver targetAgentTypeResolver;

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
        // if (isIntegrationTypeInterface(ctx)) {
        //     interfaceRouteService.route(ctx);
        //     return;
        // }
        // if (isIntegrationTypeA2A(ctx)) {
        //     a2aRouteService.route(ctx);
        //     return;
        // }

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

        targetAgentType = targetAgentTypeResolver.resolve(targetAgentType, agentId, chatDto.getSourceAgentType(),
                userCode);

        // 处理 content 中的资源占位符替换，如 {{DIG_EMPLOYEE_10812779}} 替换为 @xxxxx
        content = replaceResourcePlaceholders(content, resourceList);

        // 初始化事件队列，Redis 监听器投入，请求线程消费
        ctx.gatewayEventQueue = new LinkedBlockingQueue<>();

        // 缓存上下文，供 Redis 监听器查找
        outputStreamManager.putContext(sessionId, ctx);

        // 先启动监听器：使用 XREAD 轮询，从锚点（Stream 当前最新消息 ID）之后读取，避免消费旧消息
        sessionStreamManager.startSessionListener(sessionId, ctx);

        String userMessageId = String.valueOf(ctx.userMessageId);
        String answerMessageId = String.valueOf(ctx.modelAnswerMessageId);
        String traceId = userMessageId + "_" + answerMessageId;

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
                    agentId
            );
        } catch (Exception e) {
            sessionStreamManager.stopSessionListener(sessionId);
            throw e;
        }

        log.info("Gateway SDK 消息发送成功, messageId: {}, targetWorker: {}, sessionId: {}, content: {}",
                response.getMessageId(), response.getTargetWorkerId(), sessionId, content);

        // 历史批次上下文：key = 历史traceId, value = 该批次的 MessageContext
        Map<String, MessageContext> historyBatchMap = new HashMap<>();
        // 记录每个历史traceId对应的 userMessageId（从traceId拆分得到）
        Map<String, Long> historyUserMessageIdMap = new HashMap<>();

        try {
            // 请求线程循环消费事件队列，依次写入 OutputStream，保证逐包实时推流
            while (true) {
                JSONObject dataJson = ctx.gatewayEventQueue.poll(5, TimeUnit.MINUTES);
                if (dataJson == null) {
                    log.error("Gateway 响应超时, sessionId: {}", sessionId);
                    throw new BdpRuntimeException("Gateway 响应超时");
                }

                String eventType = dataJson.getString("event_type");

                JSONObject metadata = dataJson.getJSONObject("metadata");
                String receivedTraceId = dataJson.getString("trace_id");
                // 跳过不符合 traceId 格式（userMessageId_modelAnswerMessageId）的旧版消息
                if (receivedTraceId == null || !receivedTraceId.contains("_")) {
                    continue;
                }

                boolean isCurrentTrace = traceId.equals(receivedTraceId);

                // ========== 非当前 traceId：只积累数据，不推送客户端 ==========
                if (!isCurrentTrace) {
                    // 获取或创建该历史 traceId 的 MessageContext
                    if (!historyBatchMap.containsKey(receivedTraceId)) {
                        String[] parts = receivedTraceId.split("_", 2);
                        Long historyUserMessageId = Long.parseLong(parts[0]);
                        Long historyModelAnswerMessageId = Long.parseLong(parts[1]);
                        MessageContext historyMsgCtx = new MessageContext(
                                AgentTypeEnum.getNameCode(ctx.assistantChatDto.getAgentType()),
                                historyModelAnswerMessageId,
                                sequenceService.nextVal());
                        historyBatchMap.put(receivedTraceId, historyMsgCtx);
                        historyUserMessageIdMap.put(receivedTraceId, historyUserMessageId);
                        log.info("发现历史 traceId: {}, 创建历史批次上下文, sessionId: {}", receivedTraceId, sessionId);
                    }

                    MessageContext historyMsgCtx = historyBatchMap.get(receivedTraceId);

                    // 构造与 Python SSE 格式一致的 JSON 行，仅用于积累
                    String eventData = buildEventData(ctx, dataJson, metadata);
                    JSONObject lineJson = new JSONObject();
                    lineJson.put("event", eventType);
                    lineJson.put("data", eventData);
                    pythonSseService.accumulateEvent(lineJson.toJSONString(), historyMsgCtx);

                    // 遇到终止事件（error / appStreamResponse）：该历史批次入库，然后继续循环
                    if (SseResponseEventEnum.error.equals(eventType)
                            || SseResponseEventEnum.appStreamResponse.equals(eventType)) {
                        historyMsgCtx.setComplete(true);
                        Long historyUserMsgId = historyUserMessageIdMap.get(receivedTraceId);
                        try {
                            storeHistoryBatch(ctx, historyMsgCtx, historyUserMsgId);
                            log.info("历史批次入库完成, traceId: {}, sessionId: {}", receivedTraceId, sessionId);
                        } catch (Exception e) {
                            log.error("历史批次入库失败, traceId: {}, sessionId: {}", receivedTraceId, sessionId, e);
                        }
                        historyBatchMap.remove(receivedTraceId);
                        historyUserMessageIdMap.remove(receivedTraceId);
                    }
                    continue;
                }

                String sourceAgentType = dataJson.getString("source_agent_type");
                if (StringUtils.isNotBlank(sourceAgentType) && !sourceAgentType.equals(targetAgentType)) {
                    // targetAgentType 在内部 call agent 其他worker，这种情况下，其他worker发送的appStreamResponse事件 需要忽略
                    if (SseResponseEventEnum.appStreamResponse.equals(eventType)) {
                        continue;
                    }
                    if (SseResponseEventEnum.answerDelta.equals(eventType)) {
                        // 并且，其他worker发送的answerDelta事件，理应转为思考过程事件
                        eventType = SseResponseEventEnum.reasoningLogDelta;
                    }
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
                    sessionStreamManager.stopSessionListener(sessionId);
                    break;
                }

                // 其他事件（answerDelta / answerStart / answerEnd 等）：
                // 构造与 Python SSE 格式一致的 JSON 行，写入 OutputStream
                String eventData = buildEventData(ctx, dataJson, metadata);
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
                    sessionStreamManager.stopSessionListener(sessionId);
                    break;
                }
            }
        } finally {
            // 无论正常/超时/异常，通过 SessionStreamManager 停止监听并清理上下文
            // stopSessionListener 内部会同时清理 outputStreamManager 中的 ctx
            sessionStreamManager.stopSessionListener(sessionId);
        }
    }

    /**
     * 替换内容中的资源占位符
     * 将 {{resourceType_resourceId}} 格式替换为对应的资源名称
     * 如果资源类型为 DIG_EMPLOYEE，则在名称前添加 @ 符号
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
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("\\{\\{([^}]+)\\}\\}");
        java.util.regex.Matcher matcher = pattern.matcher(content);

        // 构建资源ID到资源信息的映射，resourceId的格式为：resourceType_resourceId
        Map<String, ResourceVo> resourceMap = new HashMap<>();
        for (ResourceVo resource : resourceList) {
            if (resource.getResourceType() != null && StringUtils.isNotBlank(resource.getResourceId())) {
                // 构建ID格式：resourceType_resourceId，如 DIG_EMPLOYEE_10812779
                String resourceKey = resource.getResourceType().getCode() + "_" + resource.getResourceId();
                resourceMap.put(resourceKey, resource);
            }
        }

        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String placeholder = matcher.group(1); // 获取占位符内部的内容，如 DIG_EMPLOYEE_10812779
            ResourceVo resource = resourceMap.get(placeholder);

            if (resource != null && StringUtils.isNotBlank(resource.getResourceName())) {
                String replacement = resource.getResourceName();
                // 如果资源类型为 DIG_EMPLOYEE，则在名称前添加 @ 符号
                if (AgentMetaEnum.DIG_EMPLOYEE.equals(resource.getResourceType())) {
                    replacement = "@" + replacement;
                }
                // 转义特殊字符以用于替换
                matcher.appendReplacement(result, java.util.regex.Matcher.quoteReplacement(replacement));
            }
            // 如果找不到对应的资源，保留原占位符
        }
        matcher.appendTail(result);

        return result.toString();
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
                                                                  Long agentId) {
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
                sandboxService.restartSandboxAfterRemoteExit(userCode, agentId, targetAgentType);
                continue;
            }

            throw new BdpRuntimeException("Gateway SDK 消息发送失败: " + response.getError());
        }
    }

    private boolean shouldRetryAfterSandboxReady(String targetAgentType,
                                                 String userCode,
                                                 GatewayClient.SendResponse response) {
        return isUserSandboxAgentType(targetAgentType, userCode)
                && (ExecutionStatus.ERR_WORKER_NOT_ONLINE.equalsIgnoreCase(response.getErrorCode())
                || ExecutionStatus.ERR_AGENT_TYPE_UNAVAILABLE.equalsIgnoreCase(response.getErrorCode()));
    }

    private boolean isUserSandboxAgentType(String targetAgentType, String userCode) {
        return targetAgentTypeResolver.isUserSandboxAgentType(targetAgentType, userCode);
    }

    /**
     * 将 Redis 事件的 data 字段统一构造为包含 sessionId 和 metadata 的 JSON 字符串。
     * 抽取自 while 循环中的 eventData 构建逻辑，供当前 traceId 和历史 traceId 路径共用。
     */
    private String buildEventData(ChatProcessContext ctx, JSONObject dataJson, JSONObject metadata) {
        String eventData = dataJson.getString("data");
        String sourceAgentType = dataJson.getString("source_agent_type");
        String sessionId = String.valueOf(ctx.sessionId);
        String userMessageId = String.valueOf(ctx.userMessageId);
        if (eventData == null) {
            JSONObject eventPayload = new JSONObject(dataJson);
            eventPayload.remove("event_type");
            eventPayload.remove("session_id");
            eventPayload.put("sessionId", sessionId);
            if (metadata != null && !metadata.isEmpty()) {
                eventPayload.put("metadata", metadata.toJSONString());
            }
            return eventPayload.toJSONString();
        }
        try {
            JSONObject dataObj = JSON.parseObject(eventData);
            if (dataObj != null) {
                dataObj.put("sourceAgentType", sourceAgentType);
                dataObj.put("sessionId", sessionId);
                if (metadata != null && !metadata.isEmpty()) {
                    dataObj.put("metadata", metadata.toJSONString());
                }
                // orderId & parentOrderId，这两个字段用于给前端构建消息树。当parentOrderId=用户消息id时，表示是第一层级的消息，改为-1更好理解。
                if (StringUtils.isNotBlank(dataObj.getString("parentOrderId")) && dataObj.getString("parentOrderId").equals(userMessageId)) {
                    dataObj.put("parentOrderId", "-1");
                }
                return dataObj.toJSONString();
            }
            return eventData;
        } catch (Exception e) {
            return eventData;
        }
    }

    /**
     * 将历史批次的消息通过 resolveMemory 入库。
     * 构造独立的 ChatProcessContext 和 AssistantChatDto，避免污染当前请求上下文。
     */
    private void storeHistoryBatch(ChatProcessContext currentCtx, MessageContext historyMsgCtx,
                                   Long historyUserMessageId) {
        AssistantChatDto historyDto = new AssistantChatDto();
        BeanUtils.copyProperties(currentCtx.assistantChatDto, historyDto);
        historyDto.setTaskOperateType(null);

        ChatProcessContext tempCtx = new ChatProcessContext(null, historyDto);
        tempCtx.sessionId = currentCtx.sessionId;
        tempCtx.userMessageId = historyUserMessageId;
        tempCtx.taskId = historyMsgCtx.getTaskId();

        ByaiMessageHotDtoDto tempResMsg = new ByaiMessageHotDtoDto();
        ScriptService scriptService = ApplicationContextUtil.getBean(ScriptService.class);
        scriptService.resolveMemory(tempCtx, historyDto, currentCtx.sessionId, historyMsgCtx, tempResMsg);
    }
}
