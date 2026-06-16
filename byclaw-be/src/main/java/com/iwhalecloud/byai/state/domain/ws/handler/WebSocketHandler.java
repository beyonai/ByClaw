package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.Collections;
import java.util.Map;
import cn.hutool.core.util.IdUtil;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.application.service.ecosystem.EcosystemCollectionApplicationService;
import com.iwhalecloud.byai.manager.dto.ecosystem.EcosystemAgentHeartbeatRequest;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import com.iwhalecloud.byai.state.domain.ws.service.ChatService;
import com.iwhalecloud.byai.state.infrastructure.utils.CloseUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.NettyResponse;
import com.iwhalecloud.byai.state.infrastructure.utils.PushUtil;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.timeout.IdleState;
import io.netty.handler.timeout.IdleStateEvent;
import lombok.extern.slf4j.Slf4j;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

@Slf4j
@ChannelHandler.Sharable
@Component
public class WebSocketHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {

    @Autowired
    private ChatService chatService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private EcosystemCollectionApplicationService ecosystemCollectionApplicationService;

    public WebSocketHandler() {
        super(true);
    }

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        log.info("New connection established: {}", ctx.channel().remoteAddress());
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        log.info("Connection closed: {}", ctx.channel().remoteAddress());
        CloseUtil.close(ctx);
    }

    @Override
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) {
        if (evt instanceof IdleStateEvent event && event.state() == IdleState.READER_IDLE) {
            log.info("No data received for 60 seconds, closing connection");
            CloseUtil.close(ctx);
        }
    }

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, TextWebSocketFrame frame) {
        String message = frame.text();

        // 生成并设置 REQUEST_ID（WebSocket 消息入口）
        Long requestId = IdUtil.getSnowflakeNextId();
        RequestContextUtil.setRequestId(requestId);
        log.debug("WebSocket 消息处理开始，REQUEST_ID: {}", requestId);

        try {
            LoginInfo userInfo = ctx.channel().attr(Constant.ATT_USER_INFO).get();
            LoginInfo previousLoginInfo = CurrentUserHolder.getLoginInfo();
            if (userInfo != null) {
                CurrentUserHolder.setLoginInfo(userInfo);
            }
            try {
                ChatMessage chatMessage = JSON.parseObject(message, ChatMessage.class);
                chatMessage.setSenderId(userInfo.getUserId());
                chatMessage.setSenderName(userInfo.getUserName());
                log.debug("websocket user message :{}", chatMessage);
                switch (chatMessage.getType()) {
                    case HEARTBEAT -> handleHeartbeat(ctx);
                    case LLM_MESSAGE -> chatService.llmChat(ctx, chatMessage);
                    case SSE_STREAM -> chatService.sseStream(ctx, chatMessage);
                    case NOTIFICATION -> notificationService.getRealTimeNotification(ctx, message);
                    case ECOSYSTEM_BRIDGE -> handleEcosystemBridge(ctx, chatMessage, userInfo);
                    case STOP_CHAT -> chatService.stopChat(ctx, chatMessage);
                default -> throw new RuntimeException(I18nUtil.get("ws.handler.unsupported.message.type", chatMessage.getType()));
                }
            }
            finally {
                if (previousLoginInfo == null) {
                    CurrentUserHolder.clearLoginInfo();
                }
                else {
                    CurrentUserHolder.setLoginInfo(previousLoginInfo);
                }
            }
        }
        catch (Exception e) {
            log.error("Error processing message: {}", message, e);
            NettyResponse.sendErrorResponse(ctx, e.getMessage());
        }
        finally {
            // 消息处理完成后清理上下文，防止线程池复用时数据污染
            RequestContextUtil.clear();
            log.debug("WebSocket 消息处理结束，清理上下文");
        }
    }

    private void handleHeartbeat(ChannelHandlerContext ctx) {
        LoginInfo userInfo = ctx.channel().attr(Constant.ATT_USER_INFO).get();
        if (userInfo != null) {
            try {
                sandboxService.heartbeat(userInfo.getUserCode(), -1L);
            }
            catch (Exception e) {
                log.error("ws 沙箱活跃时间更新异常", e);
            }
        }
        ChatMessage heartbeatResponse = new ChatMessage();
        heartbeatResponse.setType(MessageType.HEARTBEAT);
        PushUtil.sendMessageToChannel(ctx.channel(), new TextWebSocketFrame(JSON.toJSONString(heartbeatResponse)));
        log.debug("Heartbeat response sent to: {}", ctx.channel().remoteAddress());
    }

    private void handleEcosystemBridge(ChannelHandlerContext ctx, ChatMessage chatMessage, LoginInfo userInfo) {
        Map<String, Object> params = chatMessage.getExtParams() == null
            ? Collections.emptyMap()
            : chatMessage.getExtParams();
        String action = text(params, "action", "HEARTBEAT").toUpperCase();
        switch (action) {
            case "BIND", "HEARTBEAT" -> {
                ctx.channel().attr(Constant.ATT_ECOSYSTEM_BRIDGE).set(Boolean.TRUE);
                EcosystemAgentHeartbeatRequest request = buildBridgeHeartbeatRequest(params, userInfo);
                Map<String, Object> data = new JSONObject();
                data.put("agentStatus", ecosystemCollectionApplicationService.heartbeat(request));
                data.put("pendingTasks", ecosystemCollectionApplicationService.listPendingBrowserBridgeTasks(
                    userInfo.getUserId(), text(params, "bridgeClientId", "")));
                sendBridgeResponse(ctx, "BIND".equals(action) ? "BOUND" : "HEARTBEAT_ACK", data);
            }
            case "PULL_TASKS" -> sendBridgeResponse(ctx, "TASK_LIST",
                Map.of("tasks", ecosystemCollectionApplicationService.listPendingBrowserBridgeTasks(
                    userInfo.getUserId(), text(params, "bridgeClientId", ""))));
            case "CLAIM_TASK" -> sendBridgeResponse(ctx, "CLAIM_ACCEPTED",
                ecosystemCollectionApplicationService.claimBrowserBridgeTask(params, userInfo.getUserId()));
            case "RENEW_LEASE" -> sendBridgeResponse(ctx, "LEASE_RENEWED",
                ecosystemCollectionApplicationService.renewBrowserBridgeLease(params, userInfo.getUserId()));
            case "TASK_RESULT" -> sendBridgeResponse(ctx, "RESULT_ACCEPTED",
                Map.of("run", ecosystemCollectionApplicationService.completeBrowserBridgeRun(params, userInfo.getUserId())));
            case "TASK_FAILED" -> sendBridgeResponse(ctx, "RESULT_ACCEPTED",
                Map.of("run", ecosystemCollectionApplicationService.failBrowserBridgeRun(params, userInfo.getUserId())));
            case "TASK_CANCELLED", "TASK_CANCELED" -> sendBridgeResponse(ctx, "CANCEL_ACCEPTED",
                Map.of("run", ecosystemCollectionApplicationService.cancelBrowserBridgeRun(params, userInfo.getUserId())));
            case "TASK_PROGRESS" -> sendBridgeResponse(ctx, "PROGRESS_ACCEPTED",
                Map.of("run", ecosystemCollectionApplicationService.updateBrowserBridgeProgress(params, userInfo.getUserId())));
            default -> throw new IllegalArgumentException(I18nUtil.get("ecosystem.bridge.unsupported.action", action));
        }
    }

    private EcosystemAgentHeartbeatRequest buildBridgeHeartbeatRequest(Map<String, Object> params, LoginInfo userInfo) {
        EcosystemAgentHeartbeatRequest request = new EcosystemAgentHeartbeatRequest();
        request.setAgentName(text(params, "agentName", userInfo.getUserName() + "-Browser Bridge"));
        request.setRuntimeName(text(params, "runtimeName", "ByClaw Browser Bridge"));
        request.setRuntimeVersion(text(params, "runtimeVersion", "-"));
        request.setBrowserBridgeStatus(text(params, "browserBridgeStatus", "CONNECTED"));
        request.setChromeProfile(text(params, "chromeProfile", "user-browser"));
        request.setStatus(text(params, "status", "ONLINE"));
        Object siteSessions = params.get("siteSessions");
        if (siteSessions != null) {
            request.setSiteSessions(JSON.parseArray(JSON.toJSONString(siteSessions),
                EcosystemAgentHeartbeatRequest.SiteSessionRequest.class));
        }
        return request;
    }

    private void sendBridgeResponse(ChannelHandlerContext ctx, String event, Object data) {
        JSONObject response = new JSONObject();
        response.put("type", MessageType.ECOSYSTEM_BRIDGE.name());
        response.put("event", event);
        response.put("data", data);
        PushUtil.sendMessageToChannel(ctx.channel(), new TextWebSocketFrame(response.toJSONString()));
    }

    private String text(Map<String, Object> params, String key, String defaultValue) {
        Object value = params.get(key);
        return value == null || String.valueOf(value).isBlank() ? defaultValue : String.valueOf(value);
    }

    private void sendError(ChannelHandlerContext ctx, String errorMessage) {
        ChatMessage error = new ChatMessage();
        error.setType(MessageType.ERROR);
        error.setChatContent(errorMessage);
        PushUtil.sendMessageToChannel(ctx.channel(), new TextWebSocketFrame(JSON.toJSONString(error)));
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        log.error("WebSocket error", cause);
        CloseUtil.close(ctx);
    }
}
