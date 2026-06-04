package com.iwhalecloud.byai.state.domain.chat.service;

import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;
import com.iwhalecloud.byai.state.infrastructure.common.constants.SseResponseEventEnum;
import com.iwhalecloud.byai.state.infrastructure.utils.CompletionsUtils;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

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

    /**
     * Redis Stream 统一入口。HTTP SSE 投递到请求线程队列，WebSocket 直接推送到已登记的 Channel。
     */
    public void dispatch(JSONObject dataJson) {
        String sessionId = dataJson == null ? null : dataJson.getString("session_id");
        if (StringUtils.isBlank(sessionId)) {
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
}
