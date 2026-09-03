package com.iwhalecloud.byai.state.domain.chat.service;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.state.common.dto.AnswerDelta;
import com.iwhalecloud.byai.state.common.dto.ChoiceDto;
import com.iwhalecloud.byai.state.common.dto.DeltaDto;
import com.iwhalecloud.byai.state.common.enums.AgentTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.SessionRuntimeState;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatUseageEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageContext;
import com.iwhalecloud.byai.state.domain.message.dto.ByaiMessageHotDtoDto;
import com.iwhalecloud.byai.state.domain.message.service.MemoryMessageService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import java.util.List;
import java.util.UUID;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class SessionStreamEventRouter {
    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private PythonSseService pythonSseService;

    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;

    @Autowired
    private RunningChatSnapshotWriteBehind runningChatSnapshotWriteBehind;

    @Autowired
    private GatewayStreamEventProcessor gatewayStreamEventProcessor;

    @Autowired
    private SessionService sessionService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private MemoryMessageService memoryMessageService;

    @Autowired
    private CronService cronService;

    @Autowired
    private ChatContextRecoveryService chatContextRecoveryService;

    @Autowired
    private TerminalPersistMarkerService terminalPersistMarkerService;

    @Autowired
    private ScopedSessionEventService scopedSessionEventService;

    @Autowired
    private SessionRuntimeStateService sessionRuntimeStateService;

    /**
     * Redis Stream 统一入口。HTTP SSE 投递到请求线程队列，WebSocket 直接推送到已登记的 Channel。
     */
    public StreamDispatchResult dispatch(JSONObject dataJson) {
        String sessionId = dataJson == null ? null : dataJson.getString("session_id");
        if (StringUtils.isBlank(sessionId)) {
            return StreamDispatchResult.INTENTIONALLY_IGNORED;
        }
        if (sessionRuntimeStateService != null && sessionRuntimeStateService.isRuntimeEvent(dataJson)) {
            SessionRuntimeState runtime = sessionRuntimeStateService.applyEvent(parseLong(sessionId), dataJson);
            if (runtime != null) {
                broadcastSessionRuntimeStatus(runtime);
            }
            return StreamDispatchResult.HANDLED;
        }
        try {
            if (scopedSessionEventService != null
                && scopedSessionEventService.handleIfNecessary(parseLong(sessionId), dataJson)) {
                return StreamDispatchResult.HANDLED;
            }
        }
        catch (Exception e) {
            log.warn("处理外部子会话事件失败, sessionId: {}, dataJson: {}", sessionId, dataJson, e);
            return StreamDispatchResult.ERROR;
        }
        if (isBackgroundAnswerMessageEvent(dataJson.getString("event_type"))) {
            try {
                dispatchBackgroundAnswerMessage(dataJson);
            }
            catch (Exception e) {
                log.warn("处理后台会话 answer 事件失败, sessionId: {}, dataJson: {}", sessionId, dataJson, e);
                return StreamDispatchResult.ERROR;
            }
            return StreamDispatchResult.HANDLED;
        }

        ChatProcessContext ctx = outputStreamManager.getContext(sessionId, dataJson.getString("trace_id"));
        if (ctx == null) {
            ctx = chatContextRecoveryService.recoverIfNecessary(dataJson);
        }
        // Truly historical traces still use the existing history accumulator.
        if (ctx == null) ctx = outputStreamManager.getContext(sessionId);
        if (ctx == null) {
            return StreamDispatchResult.MISSING_CONTEXT;
        }
        ctx.currentStreamId = dataJson.getString("stream_id");

        if (!ChatTransport.WEBSOCKET.equals(ctx.transport)) {
            if (ctx.gatewayEventQueue != null) {
                try {
                    // 有界队列已满时阻塞 Redis listener，背压传递到 Redis Stream，
                    // 避免 JVM 内存无界增长，也不能在未入队时返回 HANDLED 后误 ACK。
                    ctx.gatewayEventQueue.put(dataJson);
                }
                catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    log.warn("等待 HTTP SSE 事件队列容量时被中断，消息保留 pending, sessionId: {}", sessionId);
                    return StreamDispatchResult.ERROR;
                }
            }
            broadcastToOtherDevices(ctx, dataJson);
            return StreamDispatchResult.HANDLED;
        }

        WebSocketRouteResult routeResult = routeWebSocketEvent(ctx, dataJson);
        if (routeResult.shouldBroadcast) {
            broadcastToOtherDevices(ctx, dataJson);
        }
        return routeResult.dispatchResult;
    }

    private WebSocketRouteResult routeWebSocketEvent(ChatProcessContext ctx, JSONObject dataJson) {
        if (gatewayStreamEventProcessor.handleHistoryEventIfNecessary(ctx, dataJson)) {
            return WebSocketRouteResult.ignored();
        }

        String eventType = gatewayStreamEventProcessor.normalizeEventType(ctx, dataJson);
        if (gatewayStreamEventProcessor.shouldIgnoreEvent(ctx, eventType, dataJson)) {
            return WebSocketRouteResult.ignored();
        }
        if (StreamIdUtil.isProcessedByWatermark(ctx.currentStreamId, ctx.hydratedStreamId)) {
            return handleWatermarkedReplay(ctx, eventType);
        }
        JSONObject metadata = dataJson.getJSONObject("metadata");
        if (metadata == null) {
            metadata = new JSONObject();
        }

        if (SseResponseEventEnum.error.equals(eventType)) {
            boolean terminal = handleWebSocketError(ctx, dataJson, metadata);
            if (terminal) {
                ctx.terminalStreamId = ctx.currentStreamId;
            }
            return terminal ? WebSocketRouteResult.terminal(ctx) : WebSocketRouteResult.broadcasting();
        }

        String eventData = gatewayStreamEventProcessor.buildEventData(ctx, dataJson, metadata);
        JSONObject lineJson = new JSONObject();
        lineJson.put("event", eventType);
        lineJson.put("data", eventData);

        String receivedTraceId = dataJson.getString("trace_id");
        MessageContext messageContext = ctx.resolveMessageContext(receivedTraceId);
        if (ctx.recoveryOnly) {
            boolean alreadyHydrated = StreamIdUtil.isProcessedByWatermark(ctx.currentStreamId, ctx.hydratedStreamId);
            if (!alreadyHydrated) {
                pythonSseService.accumulateEvent(lineJson.toJSONString(), ctx.messageContext);
            }
            else {
                log.info("恢复事件已计入快照，跳过续聚合, sessionId: {}, traceId: {}, streamId: {}", ctx.sessionId,
                    ctx.traceId, ctx.currentStreamId);
            }
        }
        else {
            pythonSseService.getContentFromPythonStreamV3(lineJson.toJSONString(), ctx.res,
                messageContext, ctx.getAgentIds(), ctx);
        }
        boolean terminalResponse = SseResponseEventEnum.appStreamResponse.equals(eventType);
        if (terminalResponse && messageContext != null) {
            // 快照是断线重连的对账依据，必须先写入 complete，再保存终态快照。
            messageContext.setComplete(true);
        }
        // 推进内存水位线，保证 live 和 recovery 重投递都不会重复推送或重复聚合。
        ctx.hydratedStreamId = StreamIdUtil.max(ctx.hydratedStreamId, ctx.currentStreamId, ctx.hydratedStreamId);
        String snapshotKey = runningSnapshotKey(ctx, receivedTraceId, messageContext);
        if (terminalResponse) {
            runningChatSnapshotWriteBehind.flushNow(snapshotKey, ctx, receivedTraceId, messageContext);
        }
        else {
            runningChatSnapshotWriteBehind.enqueue(snapshotKey, ctx, receivedTraceId, messageContext);
        }

        if (terminalResponse) {
            if (ctx.markTraceComplete(receivedTraceId)) {
                if (ctx.messageContext != null) {
                    ctx.messageContext.setComplete(true);
                }
                ctx.terminalStreamId = ctx.currentStreamId;
                return WebSocketRouteResult.terminal(ctx);
            }
        }
        return WebSocketRouteResult.broadcasting();
    }

    private String runningSnapshotKey(ChatProcessContext ctx, String traceId, MessageContext messageContext) {
        Long messageId = messageContext == null ? null : messageContext.getMessageId();
        return String.valueOf(ctx == null ? null : ctx.sessionId) + ":"
            + StringUtils.defaultString(traceId) + ":" + String.valueOf(messageId);
    }

    /**
     * 处理已被水位线覆盖的重投事件：内容不再推送，但仍要判断是否需要重新收尾。
     * <p>
     * 水位线会随快照恢复，而 {@code terminalStreamId} 是内存字段，进程重启后为 null。
     * 因此不能只依赖内存字段判断 terminal，否则重启后重投的终止事件会被当作普通重复事件
     * ACK 掉，落库再也不会发生。这里按事件类型重新判定，并用持久标记区分
     * 「已落库」与「落库尚未完成」两种情况。
     */
    private WebSocketRouteResult handleWatermarkedReplay(ChatProcessContext ctx, String eventType) {
        boolean terminalEventType = SseResponseEventEnum.appStreamResponse.equals(eventType)
            || SseResponseEventEnum.error.equals(eventType);
        if (!terminalEventType) {
            log.debug("Stream 增量事件已处理，跳过重复推送, sessionId: {}, traceId: {}, streamId: {}", ctx.sessionId,
                ctx.traceId, ctx.currentStreamId);
            return WebSocketRouteResult.ignored();
        }

        boolean persistedInThisProcess = ctx.currentStreamId != null
            && ctx.currentStreamId.equals(ctx.terminalStreamId);
        if (persistedInThisProcess || terminalPersistMarkerService.isPersisted(ctx.sessionId, ctx.currentStreamId)) {
            // 落库已完成，仅需重新走一次 ACK 与收尾；processor 会跳过重复落库。
            log.info("Stream 终止事件已落库，跳过重复落库并重新收尾, sessionId: {}, traceId: {}, streamId: {}",
                ctx.sessionId, ctx.traceId, ctx.currentStreamId);
            return WebSocketRouteResult.terminalPersisted(ctx);
        }

        // 水位线覆盖但落库未完成：上次在「保存快照」与「落库成功」之间中断，必须重新落库。
        log.warn("Stream 终止事件已计入快照但未完成落库，重新执行收尾, sessionId: {}, traceId: {}, streamId: {}",
            ctx.sessionId, ctx.traceId, ctx.currentStreamId);
        ctx.terminalStreamId = ctx.currentStreamId;
        return WebSocketRouteResult.terminal(ctx);
    }

    private boolean handleWebSocketError(ChatProcessContext ctx, JSONObject dataJson, JSONObject metadata) {
        String errorMsg = metadata != null ? metadata.getString("error") : "unknown gateway error";
        if (ctx.recoveryOnly) {
            ctx.gatewayError = true;
            return true;
        }
        JSONObject errorPayload = new JSONObject();
        errorPayload.put("message", errorMsg);
        errorPayload.put("traceback", errorMsg);
        errorPayload.put("sessionId", String.valueOf(ctx.sessionId));
        gatewayStreamEventProcessor.enrichLaneMetadata(ctx, dataJson, metadata, errorPayload);
        CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.error, errorPayload.toJSONString(),
            ctx.sessionId);
        ctx.gatewayError = !ctx.isMultiAgentRequest() || ctx.getMultiAgentTraceIds().size() == 1;
        return ctx.markTraceComplete(dataJson == null ? null : dataJson.getString("trace_id"));
    }

    private static final class WebSocketRouteResult {
        private final StreamDispatchResult dispatchResult;
        private final boolean shouldBroadcast;

        private WebSocketRouteResult(StreamDispatchResult dispatchResult, boolean shouldBroadcast) {
            this.dispatchResult = dispatchResult;
            this.shouldBroadcast = shouldBroadcast;
        }

        private static WebSocketRouteResult ignored() {
            return new WebSocketRouteResult(StreamDispatchResult.HANDLED, false);
        }

        private static WebSocketRouteResult broadcasting() {
            return new WebSocketRouteResult(StreamDispatchResult.HANDLED, true);
        }

        private static WebSocketRouteResult terminal(ChatProcessContext context) {
            return new WebSocketRouteResult(StreamDispatchResult.terminalHandled(context), true);
        }

        /** 已落库的终止事件重投：需要 ACK 和收尾，但不重复落库，也不再次广播。 */
        private static WebSocketRouteResult terminalPersisted(ChatProcessContext context) {
            return new WebSocketRouteResult(StreamDispatchResult.terminalAlreadyPersisted(context), false);
        }
    }

    private void broadcastToOtherDevices(ChatProcessContext ctx, JSONObject dataJson) {
        try {
            JSONObject broadcastEvent = buildBroadcastEvent(ctx, dataJson);
            multiDeviceBroadcastService.broadcastRawEvent(ctx.getUserId(), ctx.getSessionId(),
                broadcastEvent, ctx.getSenderChannel(), resolveBroadcastClientRequestId(ctx, broadcastEvent));
        }
        catch (Exception e) {
            log.warn("多端广播异常, sessionId: {}", ctx.sessionId, e);
        }
    }

    private JSONObject buildBroadcastEvent(ChatProcessContext ctx, JSONObject dataJson) {
        if (dataJson == null) {
            return null;
        }
        JSONObject broadcastJson = new JSONObject(dataJson);
        JSONObject metadata = dataJson.getJSONObject("metadata");
        if (metadata == null) {
            metadata = new JSONObject();
        }
        // 多端广播必须与当前 WebSocket 路由使用同一套事件类型归一化规则。
        // 否则非目标 agent 的 answerDelta 会在入库时按 reasoningLogDelta 处理，
        // 但其他设备仍收到原始 answerDelta，导致不同 WebSocket 客户端表现不一致。
        broadcastJson.put("event_type", gatewayStreamEventProcessor.normalizeEventType(ctx, dataJson));
        broadcastJson.put("data", gatewayStreamEventProcessor.buildEventData(ctx, dataJson, metadata));
        return broadcastJson;
    }

    private String resolveBroadcastClientRequestId(ChatProcessContext ctx, JSONObject broadcastJson) {
        if (broadcastJson == null) {
            return ctx == null ? null : ctx.getClientRequestId();
        }
        try {
            JSONObject payload = JSON.parseObject(broadcastJson.getString("data"));
            String clientRequestId = payload == null ? null : payload.getString("clientRequestId");
            return StringUtils.defaultIfBlank(clientRequestId, ctx == null ? null : ctx.getClientRequestId());
        }
        catch (Exception e) {
            return ctx == null ? null : ctx.getClientRequestId();
        }
    }

    public boolean isBackgroundAnswerMessageEvent(String eventType) {
        return cronService.isCronChangedEvent(eventType);
    }

    public void dispatchBackgroundAnswerMessage(JSONObject dataJson) {
        String sessionIdValue = dataJson == null ? null : dataJson.getString("session_id");
        String eventType = dataJson.getString("event_type");
        if (StringUtils.isNotEmpty(sessionIdValue)) {
            try {
                Long sessionId = parseLong(sessionIdValue);
                ByaiMessageHotDtoDto message = buildBackgroundAnswerMessage(sessionId, dataJson);
                broadcastBackgroundAnswerMessage(sessionId, message);
            } catch (Exception e) {
                log.warn("后台会话 answer 消息已入库，但 WebSocket 推送失败", e);
            }
        }
        if (cronService.isCronChangedEvent(eventType)) {
            cronService.dispatchCronNotice(dataJson);
        }
    }

    private ByaiMessageHotDtoDto buildBackgroundAnswerMessage(Long sessionId, JSONObject dataJson) {
        JSONObject payload = parseBackgroundAnswerPayload(dataJson);

        MessageContext messageContext = new MessageContext(AgentTypeEnum.AGENT, sequenceService.nextVal(),
            resolveBackgroundTaskId(payload));
        JSONObject metadata = dataJson.getJSONObject("metadata");
        ChatProcessContext backgroundCtx = new ChatProcessContext(null, null);
        backgroundCtx.sessionId = sessionId;
        backgroundCtx.userMessageId = 0L;
        String eventData = gatewayStreamEventProcessor.buildEventData(backgroundCtx,
            buildBackgroundAnswerStreamEvent(dataJson, payload), metadata);
        eventData = ensureBackgroundAnswerDelta(eventData);
        JSONObject lineJson = new JSONObject();
        lineJson.put("event", SseResponseEventEnum.answerDelta);
        lineJson.put("data", eventData);
        pythonSseService.accumulateEvent(lineJson.toJSONString(), messageContext);

        AssistantChatDto assistantChatDto = new AssistantChatDto();
        assistantChatDto.setAccessTerminal(StringUtils.defaultIfBlank(payload.getString("accessTerminal"), "Web"));
        assistantChatDto.setMetadata(resolveBackgroundMetadata(dataJson, payload));

        LoginInfo previousLoginInfo = CurrentUserHolder.getLoginInfo();
        try {
            CurrentUserHolder.setLoginInfo(buildBackgroundLoginInfo(sessionId, payload));

            // 同步更新会话的updateTime
            sessionService.touchUpdateTime(sessionId);

            return memoryMessageService.save(sessionId, ChatUseageEnum.SYSTEM_RESPONSE.getCode(), messageContext,
                assistantChatDto);
        }
        finally {
            if (previousLoginInfo != null) {
                CurrentUserHolder.setLoginInfo(previousLoginInfo);
            }
            else {
                CurrentUserHolder.clearLoginInfo();
            }
        }
    }

    private JSONObject parseBackgroundAnswerPayload(JSONObject dataJson) {
        String data = dataJson.getString("data");
        if (StringUtils.isBlank(data)) {
            return new JSONObject();
        }
        try {
            return JSON.parseObject(data);
        }
        catch (Exception e) {
            JSONObject payload = new JSONObject();
            payload.put("content", data);
            return payload;
        }
    }

    private String resolveBackgroundMetadata(JSONObject dataJson, JSONObject payload) {
        String metadata = payload.getString("metadata");
        if (StringUtils.isNotBlank(metadata)) {
            return metadata;
        }
        JSONObject metadataObj = dataJson.getJSONObject("metadata");
        return metadataObj == null ? null : metadataObj.toJSONString();
    }

    private JSONObject buildBackgroundAnswerStreamEvent(JSONObject dataJson, JSONObject payload) {
        JSONObject backgroundEvent = new JSONObject(dataJson);
        backgroundEvent.put("event_type", SseResponseEventEnum.answerDelta);
        backgroundEvent.put("data", payload.toJSONString());
        return backgroundEvent;
    }

    private String ensureBackgroundAnswerDelta(String eventData) {
        try {
            AnswerDelta answerDelta = JSON.parseObject(eventData, AnswerDelta.class);
            if (answerDelta != null && answerDelta.getChoices() != null && !answerDelta.getChoices().isEmpty()) {
                return eventData;
            }
        }
        catch (Exception ignored) {
            // 不是标准 AnswerDelta 时，按纯文本内容做一次最小适配。
        }

        JSONObject payload = JSON.parseObject(eventData);
        String content = StringUtils.defaultIfBlank(payload.getString("content"), payload.getString("text"));
        AnswerDelta answerDelta = new AnswerDelta();
        answerDelta.setContentType(StringUtils.defaultIfBlank(payload.getString("contentType"), "1002"));
        answerDelta.setCreated(System.currentTimeMillis() / 1000);
        answerDelta.setId(StringUtils.defaultIfBlank(payload.getString("id"), UUID.randomUUID().toString().replace("-", "")));
        answerDelta.setTraceId(payload.getString("traceId"));
        answerDelta.setOrderId(payload.getString("orderId"));
        answerDelta.setParentOrderId(payload.getString("parentOrderId"));
        answerDelta.setSourceAgentType(payload.getString("sourceAgentType"));

        ChoiceDto choice = new ChoiceDto();
        choice.setIndex("0");
        choice.setFinish_reason("");
        choice.setDelta(new DeltaDto(content));
        answerDelta.setChoices(List.of(choice));
        return JSON.toJSONString(answerDelta);
    }

    private Long getLong(JSONObject jsonObject, String key) {
        try {
            return jsonObject == null ? null : jsonObject.getLong(key);
        }
        catch (Exception e) {
            return null;
        }
    }

    private Long parseLong(String value) {
        try {
            return StringUtils.isBlank(value) ? null : Long.valueOf(value);
        }
        catch (Exception e) {
            return null;
        }
    }

    private Long resolveBackgroundTaskId(JSONObject payload) {
        Long taskId = getLong(payload, "taskId");
        return taskId == null ? sequenceService.nextVal() : taskId;
    }

    private LoginInfo buildBackgroundLoginInfo(Long sessionId, JSONObject payload) {
        LoginInfo loginInfo = new LoginInfo();
        if (StringUtils.isNotBlank(payload.getString("userId"))) {
            loginInfo.setUserId(parseLong(payload.getString("userId")));
        }
        else {
            ByaiSession session = sessionService.findById(sessionId);
            if (session != null) {
                loginInfo.setUserId(session.getCreatorId());
            }
        }
        loginInfo.setUserName(payload.getString("creatorName"));
        return loginInfo;
    }

    private void broadcastBackgroundAnswerMessage(Long sessionId, ByaiMessageHotDtoDto message) {
        ByaiSession session = sessionService.findById(sessionId);
        Long userId = session == null ? message.getCreatorId() : session.getCreatorId();
        if (userId == null) {
            return;
        }
        JSONObject wsMessage = new JSONObject();
        wsMessage.put("type", "NEW_MESSAGE");
        wsMessage.put("sessionId", String.valueOf(sessionId));
        wsMessage.put("data", JSON.toJSON(message));
        // 后台事件，发送给所有的活跃通道
        multiDeviceBroadcastService.broadcastRawToUser(userId, wsMessage, null);
    }

    public void broadcastSessionStatus(String sessionIdValue, String statusValue) {
        Long sessionId = parseLong(sessionIdValue);
        if (sessionId == null || StringUtils.isBlank(statusValue)) {
            return;
        }
        ByaiSession session = sessionService.findById(sessionId);
        Long userId = session == null ? null : session.getCreatorId();
        if (userId == null) {
            return;
        }

        JSONObject wsMessage = new JSONObject();
        wsMessage.put("type", "SESSION_STATUS");
        wsMessage.put("sessionId", String.valueOf(sessionId));
        wsMessage.put("data", parseSessionStatusPayload(statusValue));
        multiDeviceBroadcastService.broadcastRawToUser(userId, wsMessage, null);
    }

    private void broadcastSessionRuntimeStatus(SessionRuntimeState runtime) {
        if (runtime == null || runtime.getSessionId() == null) {
            return;
        }
        ByaiSession session = sessionService.findById(runtime.getSessionId());
        Long userId = session == null ? null : session.getCreatorId();
        if (userId == null) {
            return;
        }
        JSONObject wsMessage = new JSONObject();
        wsMessage.put("type", "SESSION_RUNTIME_STATUS");
        wsMessage.put("sessionId", String.valueOf(runtime.getSessionId()));
        wsMessage.put("traceId", runtime.getTraceId());
        wsMessage.put("data", JSON.toJSON(runtime));
        multiDeviceBroadcastService.broadcastRawToUser(userId, wsMessage, null);
    }

    private Object parseSessionStatusPayload(String statusValue) {
        try {
            return JSON.parse(statusValue);
        }
        catch (Exception e) {
            return statusValue;
        }
    }
}
