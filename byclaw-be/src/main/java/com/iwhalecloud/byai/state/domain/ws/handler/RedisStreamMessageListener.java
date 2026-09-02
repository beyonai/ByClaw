package com.iwhalecloud.byai.state.domain.ws.handler;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Scope;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamMetrics;
import com.iwhalecloud.byai.state.domain.chat.service.SessionStreamManager;
import com.iwhalecloud.byai.state.domain.chat.service.StreamAckFailureRegistry;
import com.iwhalecloud.byai.state.domain.chat.service.StreamRecordProcessor;
import com.iwhalecloud.byai.state.domain.chat.service.StreamDispatchResult;

/**
 * Redis Stream 数据流消息监听器。
 * <p>
 * 每个 session 在 Gateway 模式下拥有独立的监听器实例（prototype scope），
 * 通过 ApplicationContext 每次获取新的实例，避免多 session 并发写入同一实例的线程安全问题。
 * 监听 Gateway SDK 当前 Key Schema 对应的 Session Stream，在 Gateway 模式下接收响应消息并投入事件队列。
 * <p>
 * 设计要点：本监听器只负责将 Redis Stream 事件投入 {@link ChatProcessContext#gatewayEventQueue}，
 * 所有 OutputStream 写操作均由请求线程（Tomcat http-nio-* 线程）在
 * ScriptService.handleGatewayMode() 中消费队列时执行，保证 SSE 实时推流。
 * <p>
 * 同时将事件广播到同一用户的其他 WebSocket 设备，实现多端消息同步。
 * <p>
 * 消息体约定（data 字段的 JSON 结构）：
 * <pre>
 * {
 *   "session_id": "123456",
 *   "event_type": "answerDelta",   // 对应 SseResponseEventEnum 中的常量
 *   "data":     "{...}",           // 事件 payload，与 Python SSE data 字段对齐
 *   "metadata": { "error": "..." } // 仅 error 事件携带
 * }
 * </pre>
 */
@Component
@Scope("prototype")
public class RedisStreamMessageListener implements StreamListener<String, MapRecord<String, String, String>> {

    private static final Logger logger = LoggerFactory.getLogger(RedisStreamMessageListener.class);
    private static final int ACK_RETRY_LIMIT = 3;
    private static final ScheduledExecutorService ACK_RETRY_EXECUTOR = Executors.newScheduledThreadPool(1, runnable -> {
        Thread thread = new Thread(runnable, "session-stream-ack-retry");
        thread.setDaemon(true);
        return thread;
    });

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private StreamRecordProcessor streamRecordProcessor;

    @Autowired
    private StreamAckFailureRegistry streamAckFailureRegistry;

    @Autowired
    private SessionStreamMetrics sessionStreamMetrics;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        sessionStreamMetrics.recordReceived();
        try {
            StreamDispatchResult result = streamRecordProcessor.process(message);
            if (result.shouldAcknowledge()) {
                if (acknowledge(message)) {
                    streamRecordProcessor.afterAcknowledge(result);
                }
                else {
                    scheduleAckRetry(message, result, 1);
                }
            }
            else {
                if (result == StreamDispatchResult.MISSING_CONTEXT) {
                    sessionStreamMetrics.recordMissingContext();
                }
                else {
                    sessionStreamMetrics.recordPending();
                }
                logger.warn("Redis Stream 消息暂不 ACK, result: {}, stream: {}, messageId: {}",
                    result, message.getStream(), message.getId());
            }
        }
        catch (Exception e) {
            sessionStreamMetrics.recordDispatchError();
            logger.error("处理 Redis Stream 消息失败，将保留 pending, stream: {}, messageId: {}",
                message.getStream(), message.getId(), e);
        }
    }

    private void scheduleAckRetry(MapRecord<String, String, String> message, StreamDispatchResult result,
        int attempt) {
        if (attempt > ACK_RETRY_LIMIT) {
            // 登记失败消息：活跃 listener 的心跳会持续刷新，该 session 永远不会被判定为 stale，
            // 只能由此处主动告知 recovery 仍有 pending 需要定向 claim。
            streamAckFailureRegistry.record(message.getStream(), message.getId().getValue());
            logger.warn("Redis Stream ACK 重试耗尽，等待 pending recovery, stream: {}, messageId: {}",
                message.getStream(), message.getId());
            return;
        }
        ACK_RETRY_EXECUTOR.schedule(() -> {
            if (acknowledge(message)) {
                streamRecordProcessor.afterAcknowledge(result);
            }
            else {
                scheduleAckRetry(message, result, attempt + 1);
            }
        }, 5, TimeUnit.SECONDS);
    }

    private boolean acknowledge(MapRecord<String, String, String> message) {
        try {
            redisTemplate.opsForStream()
                .acknowledge(message.getStream(), SessionStreamManager.CONSUMER_GROUP, message.getId());
            streamAckFailureRegistry.clear(message.getStream(), message.getId().getValue());
            sessionStreamMetrics.recordAckSuccess();
            return true;
        }
        catch (Exception e) {
            sessionStreamMetrics.recordAckFailure();
            logger.warn("ack Session Stream 消息失败, stream: {}, messageId: {}",
                message.getStream(), message.getId(), e);
            return false;
        }
    }
}
