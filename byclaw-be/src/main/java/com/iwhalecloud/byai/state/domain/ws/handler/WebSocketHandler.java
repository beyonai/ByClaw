package com.iwhalecloud.byai.state.domain.ws.handler;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.util.RequestContextUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantContextService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContext;
import com.iwhalecloud.byai.manager.domain.tenant.TenantRequestContextHolder;
import com.iwhalecloud.byai.state.domain.chat.enums.MessageType;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.ws.constant.Constant;
import com.iwhalecloud.byai.state.domain.ws.model.ChatMessage;
import com.iwhalecloud.byai.state.domain.ws.service.ChatService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.ws.service.WebSocketI18nSupport;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketService;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatWebSocketService;
import com.iwhalecloud.byai.state.infrastructure.utils.CloseUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.NettyResponse;
import com.iwhalecloud.byai.state.infrastructure.utils.PushUtil;
import com.iwhalecloud.byai.state.infrastructure.utils.ResumeRoutingTraceLogger;
import cn.hutool.core.util.IdUtil;
import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.TextWebSocketFrame;
import io.netty.handler.timeout.IdleState;
import io.netty.handler.timeout.IdleStateEvent;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@ChannelHandler.Sharable
@Component
public class WebSocketHandler extends SimpleChannelInboundHandler<TextWebSocketFrame> {

    @Autowired
    private ChatService chatService;

    @Autowired
    private TaskPlanWebSocketService taskPlanWebSocketService;

    @Autowired
    private GroupChatWebSocketService groupChatWebSocketService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private TenantContextService tenantContextService;

    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;

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
        ChatMessage chatMessage = null;
        boolean tenantChatFrame = false;

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
                WebSocketI18nSupport.applyLocale(userInfo);
                chatMessage = JSON.parseObject(message, ChatMessage.class);
                ResumeRoutingTraceLogger.logWebSocketIngress(chatMessage);
                WebSocketI18nSupport.applyLocale(chatMessage.getLanguage(), userInfo);
                chatMessage.setSenderId(userInfo.getUserId());
                chatMessage.setSenderName(userInfo.getUserName());
                log.debug("websocket user message :{}", chatMessage);
                if (chatMessage.getType() == MessageType.SWITCH_TENANT) {
                    handleTenantSwitch(ctx, chatMessage);
                    return;
                }
                if (!validateFrameTenant(ctx, chatMessage)) {
                    return;
                }
                switch (chatMessage.getType()) {
                    case HEARTBEAT -> handleHeartbeat(ctx, chatMessage);
                    case LLM_MESSAGE -> {
                        tenantChatFrame = TenantRequestContextHolder.get() != null;
                        chatService.llmChat(ctx, chatMessage);
                    }
                    case SSE_STREAM -> chatService.sseStream(ctx, chatMessage);
                    case NOTIFICATION -> notificationService.getRealTimeNotification(ctx, message);
                    case STOP_CHAT -> {
                        tenantChatFrame = TenantRequestContextHolder.get() != null;
                        chatService.stopChat(ctx, chatMessage);
                    }
                    case TASK_PLAN_GET -> {
                        // The tenant Node does not persist task plans; keep this optional lookup
                        // from failing the active chat with the same clientRequestId.
                        if (TenantRequestContextHolder.get() == null) {
                            taskPlanWebSocketService.get(ctx, chatMessage);
                        }
                    }
                    case GROUP_CHAT_SEND -> {
                        tenantChatFrame = TenantRequestContextHolder.get() != null;
                        groupChatWebSocketService.send(ctx, chatMessage);
                    }
                    default -> throw new RuntimeException(
                        I18nUtil.get("ws.handler.unsupported.message.type", chatMessage.getType()));
                }
            }
            finally {
                if (previousLoginInfo == null) {
                    CurrentUserHolder.clearLoginInfo();
                }
                else {
                    CurrentUserHolder.setLoginInfo(previousLoginInfo);
                }
                TenantRequestContextHolder.clear();
            }
        }
        catch (Exception e) {
            log.error("Error processing WebSocket message type={}, clientRequestId={}",
                chatMessage == null ? null : chatMessage.getType(),
                chatMessage == null ? null : chatMessage.getClientRequestId(), e);
            if (tenantChatFrame) {
                String detail = e instanceof ResponseStatusException status
                    && status.getReason() != null
                    && status.getReason().contains("TENANT_GROUP_AGENT_NOT_READY")
                        ? "租户工作组暂不支持 @数字员工"
                        : "租户聊天失败，请稍后重试";
                sendTenantError(ctx, chatMessage, detail);
            }
            else {
                NettyResponse.sendErrorResponse(ctx, e.getMessage());
            }
        }
        finally {
            // 消息处理完成后清理上下文，防止线程池复用时数据污染
            LocaleContextHolder.resetLocaleContext();
            RequestContextUtil.clear();
            log.debug("WebSocket 消息处理结束，清理上下文");
        }
    }

    private void handleTenantSwitch(ChannelHandlerContext ctx, ChatMessage chatMessage) {
        String enterpriseId = chatMessage.getEnterpriseId();
        if (enterpriseId != null && !enterpriseId.isBlank()) {
            try {
                tenantContextService.validate(enterpriseId);
            }
            catch (Exception e) {
                sendTenantError(ctx, chatMessage, "tenant membership unavailable");
                return;
            }
        }
        else {
            enterpriseId = null;
        }

        ctx.channel().attr(Constant.ATT_ENTERPRISE_ID).set(enterpriseId);
        ctx.channel().attr(Constant.ATT_SCOPED_SESSION_ID).set(null);
        multiDeviceBroadcastService.clearChannelSubscription(ctx.channel());

        ChatMessage response = new ChatMessage();
        response.setType(MessageType.SWITCH_TENANT_ACK);
        response.setClientRequestId(chatMessage.getClientRequestId());
        response.setEnterpriseId(enterpriseId);
        PushUtil.sendMessageToChannel(ctx.channel(), new TextWebSocketFrame(JSON.toJSONString(response)));
    }

    private boolean validateFrameTenant(ChannelHandlerContext ctx, ChatMessage chatMessage) {
        String selected = ctx.channel().attr(Constant.ATT_ENTERPRISE_ID).get();
        if (selected == null) {
            if (chatMessage.getEnterpriseId() != null && !chatMessage.getEnterpriseId().isBlank()) {
                sendTenantError(ctx, chatMessage, "switch tenant before sending messages");
                return false;
            }
            return true;
        }
        if (!selected.equals(chatMessage.getEnterpriseId())) {
            sendTenantError(ctx, chatMessage, "enterprise ID does not match selected tenant");
            return false;
        }
        TenantRequestContext tenant;
        try {
            tenant = tenantContextService.validate(selected);
        }
        catch (Exception e) {
            sendTenantError(ctx, chatMessage, "tenant membership unavailable");
            return false;
        }
        if (chatMessage.getType() != MessageType.HEARTBEAT
            && chatMessage.getType() != MessageType.LLM_MESSAGE
            && chatMessage.getType() != MessageType.STOP_CHAT
            && chatMessage.getType() != MessageType.TASK_PLAN_GET
            && chatMessage.getType() != MessageType.GROUP_CHAT_SEND) {
            sendTenantError(ctx, chatMessage, "tenant WebSocket operation is not ready");
            return false;
        }
        if (chatMessage.getScopedSessionId() != null && !chatMessage.getScopedSessionId().isBlank()) {
            sendTenantError(ctx, chatMessage, "personal session cannot be selected in a tenant");
            return false;
        }
        TenantRequestContextHolder.set(tenant);
        return true;
    }

    private void sendTenantError(ChannelHandlerContext ctx, ChatMessage request, String detail) {
        JSONObject response = new JSONObject();
        response.put("type", MessageType.ERROR.name());
        response.put("clientRequestId", request.getClientRequestId());
        response.put("enterpriseId", request.getEnterpriseId());
        response.put("chatContent", detail);
        response.put("message", detail);
        PushUtil.sendMessageToChannel(ctx.channel(), new TextWebSocketFrame(response.toJSONString()));
    }

    private void handleHeartbeat(ChannelHandlerContext ctx, ChatMessage chatMessage) {
        if (chatMessage.getScopedSessionId() != null) {
            String scopedSessionId = chatMessage.getScopedSessionId().trim();
            ctx.channel().attr(Constant.ATT_SCOPED_SESSION_ID).set(scopedSessionId.isEmpty() ? null : scopedSessionId);
        }
        LoginInfo userInfo = ctx.channel().attr(Constant.ATT_USER_INFO).get();
        if (userInfo != null && ctx.channel().attr(Constant.ATT_ENTERPRISE_ID).get() == null) {
            try {
                sandboxService.heartbeat(userInfo.getUserCode(), -1L);
            }
            catch (Exception e) {
                log.error("ws 沙箱活跃时间更新异常", e);
            }
        }
        ChatMessage heartbeatResponse = new ChatMessage();
        heartbeatResponse.setType(MessageType.HEARTBEAT);
        heartbeatResponse.setEnterpriseId(ctx.channel().attr(Constant.ATT_ENTERPRISE_ID).get());
        PushUtil.sendMessageToChannel(ctx.channel(), new TextWebSocketFrame(JSON.toJSONString(heartbeatResponse)));
        log.debug("Heartbeat response sent to: {}", ctx.channel().remoteAddress());
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        log.error("WebSocket error", cause);
        CloseUtil.close(ctx);
    }
}
