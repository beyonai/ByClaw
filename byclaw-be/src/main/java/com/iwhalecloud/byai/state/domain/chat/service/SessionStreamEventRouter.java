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
    private ScriptService scriptService;

    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;

    @Autowired
    private RunningChatSnapshotService runningChatSnapshotService;

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

    /**
     * Redis Stream 统一入口。HTTP SSE 投递到请求线程队列，WebSocket 直接推送到已登记的 Channel。
     */
    public void dispatch(JSONObject dataJson) {
        String sessionId = dataJson == null ? null : dataJson.getString("session_id");
        if (StringUtils.isBlank(sessionId)) {
            return;
        }
        if (isBackgroundAnswerMessageEvent(dataJson.getString("event_type"))) {
            try {
                dispatchBackgroundAnswerMessage(dataJson);
            }
            catch (Exception e) {
                log.warn("处理后台会话 answer 事件失败, sessionId: {}, dataJson: {}", sessionId, dataJson, e);
            }
            return;
        }

        ChatProcessContext ctx = outputStreamManager.getContext(sessionId);
        if (ctx == null) {
            return;
        }
        ctx.currentStreamId = dataJson.getString("stream_id");

        if (!ChatTransport.WEBSOCKET.equals(ctx.transport)) {
            broadcastToOtherDevices(ctx, dataJson);
            if (ctx.gatewayEventQueue != null) {
                ctx.gatewayEventQueue.offer(dataJson);
            }
            return;
        }

        if (routeWebSocketEvent(ctx, dataJson)) {
            broadcastToOtherDevices(ctx, dataJson);
        }
    }

    private boolean routeWebSocketEvent(ChatProcessContext ctx, JSONObject dataJson) {
        if (gatewayStreamEventProcessor.handleHistoryEventIfNecessary(ctx, dataJson)) {
            return false;
        }

        String eventType = gatewayStreamEventProcessor.normalizeEventType(ctx, dataJson);
        if (gatewayStreamEventProcessor.shouldIgnoreEvent(ctx, eventType, dataJson)) {
            return false;
        }
        JSONObject metadata = dataJson.getJSONObject("metadata");
        if (metadata == null) {
            metadata = new JSONObject();
        }

        if (SseResponseEventEnum.error.equals(eventType)) {
            handleWebSocketError(ctx, metadata);
            return true;
        }

        String eventData = gatewayStreamEventProcessor.buildEventData(ctx, dataJson, metadata);
        JSONObject lineJson = new JSONObject();
        lineJson.put("event", eventType);
        lineJson.put("data", eventData);

        pythonSseService.getContentFromPythonStreamV3(lineJson.toJSONString(), ctx.res,
            ctx.messageContext, ctx.getAgentIds(), ctx);
        runningChatSnapshotService.save(ctx);

        if (SseResponseEventEnum.appStreamResponse.equals(eventType)) {
            if (ctx.messageContext != null) {
                ctx.messageContext.setComplete(true);
            }
            scriptService.completeAsyncGatewayContext(ctx);
            runningChatSnapshotService.delete(ctx);
        }
        return true;
    }

    private void handleWebSocketError(ChatProcessContext ctx, JSONObject metadata) {
        String errorMsg = metadata != null ? metadata.getString("error") : "unknown gateway error";
        JSONObject errorPayload = new JSONObject();
        errorPayload.put("message", errorMsg);
        errorPayload.put("traceback", errorMsg);
        errorPayload.put("sessionId", String.valueOf(ctx.sessionId));
        CompletionsUtils.responseWrite(ctx.res, SseResponseEventEnum.error, errorPayload.toJSONString(),
            ctx.sessionId);
        ctx.gatewayError = true;
        scriptService.completeAsyncGatewayContext(ctx);
        runningChatSnapshotService.delete(ctx);
    }

    private void broadcastToOtherDevices(ChatProcessContext ctx, JSONObject dataJson) {
        try {
            multiDeviceBroadcastService.broadcastRawEvent(ctx.getUserId(), ctx.getSessionId(), dataJson,
                ctx.getSenderChannel(), ctx.getClientRequestId());
        }
        catch (Exception e) {
            log.warn("多端广播异常, sessionId: {}", ctx.sessionId, e);
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

    private Object parseSessionStatusPayload(String statusValue) {
        try {
            return JSON.parse(statusValue);
        }
        catch (Exception e) {
            return statusValue;
        }
    }
}
