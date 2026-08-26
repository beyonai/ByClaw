package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.concurrent.LinkedBlockingQueue;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;
import com.iwhalecloud.byai.state.domain.chat.enums.ChatTransport;

import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class ChatStreamRuntimeCoordinator {

    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private SessionStreamManager sessionStreamManager;

    @Autowired
    private RunningOutputStreamRegistry runningOutputStreamRegistry;

    /**
     * 准备当前 session 的 Redis Stream 运行态。
     *
     * @return true 表示本次请求新建了 listener/running 标记；false 表示复用已有运行态，只需发送 Gateway 消息。
     */
    public boolean startIfNecessary(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null) {
            return false;
        }
        String sessionId = String.valueOf(ctx.sessionId);

        if (ctx.sendByFrameworkMsgOnly || isSessionAlreadyRunning(ctx.sessionId)) {
            ctx.sendByFrameworkMsgOnly = true;
            log.info("会话已有运行态，本次只发送 Gateway 消息, sessionId: {}, traceId: {}", sessionId, ctx.traceId);
            return false;
        }

        // HTTP SSE 保留请求线程消费队列；WebSocket 由统一事件路由服务异步推送。
        if (!ChatTransport.WEBSOCKET.equals(ctx.transport)) {
            ctx.gatewayEventQueue = new LinkedBlockingQueue<>();
        }

        // 缓存上下文，供 Redis 监听器查找。
        outputStreamManager.putContext(sessionId, ctx);

        // 启动监听器：使用 XREAD 轮询，从锚点之后读取，避免消费旧消息。
        if (!sessionStreamManager.startSessionListener(sessionId, ctx)) {
            ctx.sendByFrameworkMsgOnly = true;
            log.info("会话 listener 已由其他实例持有，本次只发送 Gateway 消息, sessionId: {}, traceId: {}",
                sessionId, ctx.traceId);
            outputStreamManager.removeContext(sessionId);
            return false;
        }

        // 记录运行态，用于重开页面恢复、停止和避免重复监听。
        runningOutputStreamRegistry.markRunning(ctx);
        return true;
    }

    public void stopIfStarted(String sessionId, boolean startedByCurrentRequest) {
        if (!startedByCurrentRequest || sessionId == null) {
            return;
        }
        sessionStreamManager.stopSessionListener(sessionId);
    }

    private boolean isSessionAlreadyRunning(Long sessionId) {
        RunningChatInfo runningInfo = runningOutputStreamRegistry.getRunning(sessionId);
        return Boolean.TRUE.equals(runningInfo.getRunning());
    }
}
