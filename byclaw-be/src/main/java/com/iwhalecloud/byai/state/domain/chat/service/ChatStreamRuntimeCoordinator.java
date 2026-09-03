package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.concurrent.ArrayBlockingQueue;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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

    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;

    /** 单个 HTTP SSE 会话允许在 JVM 中暂存的最大 Redis Stream 事件数。 */
    @Value("${byclaw.session-stream.http-queue-capacity:1024}")
    private int gatewayEventQueueCapacity;

    /**
     * 准备当前 session 的 Redis Stream 运行态。
     *
     * @return true 表示本次请求登记了独立轮次；false 表示继续已有轮次，只需发送 Gateway 消息。
     */
    public boolean startIfNecessary(ChatProcessContext ctx) {
        synchronized (outputStreamManager) {
            return registerTurn(ctx);
        }
    }

    private boolean registerTurn(ChatProcessContext ctx) {
        if (ctx == null || ctx.sessionId == null) {
            return false;
        }
        String sessionId = String.valueOf(ctx.sessionId);

        boolean alreadyRunning = isSessionAlreadyRunning(ctx.sessionId);
        if (ctx.sendByFrameworkMsgOnly || (alreadyRunning && !ctx.concurrentGatewayTurn)) {
            ctx.sendByFrameworkMsgOnly = true;
            log.info("会话已有运行态，本次只发送 Gateway 消息, sessionId: {}, traceId: {}", sessionId, ctx.traceId);
            return false;
        }

        // HTTP SSE 保留请求线程消费队列；WebSocket 由统一事件路由服务异步推送。
        if (!ChatTransport.WEBSOCKET.equals(ctx.transport)) {
            ctx.gatewayEventQueue = new ArrayBlockingQueue<>(gatewayEventQueueCapacity);
        }

        if (alreadyRunning && ctx.concurrentGatewayTurn) {
            boolean localListener = sessionStreamManager.isSessionListenerActive(sessionId);
            if (!localListener && !ChatTransport.WEBSOCKET.equals(ctx.transport)) {
                throw new com.iwhalecloud.byai.state.common.exception.BdpRuntimeException(
                    "当前连接无法接收此会话的新回复，请重新连接后再试");
            }
            // Persist before sending: the listener may be owned by another backend instance.
            chatRuntimeStateService.saveConcurrent(ctx);
            if (localListener) outputStreamManager.putContext(sessionId, ctx);
            return true;
        }

        // 缓存上下文，供 Redis 监听器查找。
        outputStreamManager.putContext(sessionId, ctx);

        // 启动监听器：使用 XREAD 轮询，从锚点之后读取，避免消费旧消息。
        if (!sessionStreamManager.startSessionListener(sessionId, ctx)) {
            ctx.sendByFrameworkMsgOnly = true;
            log.info("会话 listener 已由其他实例持有，本次只发送 Gateway 消息, sessionId: {}, traceId: {}",
                sessionId, ctx.traceId);
            outputStreamManager.removeContext(sessionId, ctx);
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

    public void stopIfStarted(ChatProcessContext ctx, boolean registeredByCurrentRequest) {
        if (registeredByCurrentRequest && ctx != null) sessionStreamManager.completeSessionTurn(ctx);
    }

    private boolean isSessionAlreadyRunning(Long sessionId) {
        RunningChatInfo runningInfo = runningOutputStreamRegistry.getRunning(sessionId);
        return Boolean.TRUE.equals(runningInfo.getRunning());
    }
}
