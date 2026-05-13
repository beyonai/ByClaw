package com.iwhalecloud.byai.state.domain.ws.handler;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Scope;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.stream.StreamListener;
import org.springframework.stereotype.Component;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.chat.service.ChatProcessContext;
import com.iwhalecloud.byai.state.domain.chat.service.OutputStreamManager;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;

/**
 * Redis Stream 数据流消息监听器。
 * <p>
 * 每个 session 在 Gateway 模式下拥有独立的监听器实例（prototype scope），
 * 通过 ApplicationContext 每次获取新的实例，避免多 session 并发写入同一实例的线程安全问题。
 * 监听 "byai_gateway:session:{sessionId}:data_stream"，在 Gateway 模式下接收响应消息并投入事件队列。
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

    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private MultiDeviceBroadcastService multiDeviceBroadcastService;

    @Override
    public void onMessage(MapRecord<String, String, String> message) {
        String rawData = message.getValue().get("data");
        if (rawData == null) {
            logger.warn("Redis Stream 消息 data 字段为空, messageId: {}", message.getId());
            return;
        }

        JSONObject dataJson;
        try {
            dataJson = JSON.parseObject(rawData);
        } catch (Exception e) {
            logger.error("Redis Stream 消息 data 字段解析失败, raw: {}", rawData, e);
            return;
        }

        String sessionId = dataJson.getString("session_id");

        if (sessionId == null) {
            return;
        }

        ChatProcessContext ctx = outputStreamManager.getContext(sessionId);
        if (ctx == null || ctx.gatewayEventQueue == null) {
            return;
        }

        // 将事件投入队列，由请求线程消费并写入 OutputStream，保证 SSE 实时推流
        ctx.gatewayEventQueue.offer(dataJson);

        // 多端广播：将事件推送到同一用户的其他 WebSocket 设备
        try {
            multiDeviceBroadcastService.broadcastRawEvent(
                ctx.getUserId(),
                ctx.getSessionId(),
                dataJson,
                ctx.getSenderChannel()
            );
        } catch (Exception e) {
            logger.warn("多端广播异常, sessionId: {}", sessionId, e);
        }
    }
}
