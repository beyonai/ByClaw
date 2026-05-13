package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.connection.stream.Consumer;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.connection.stream.StreamOffset;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;

/**
 * Gateway 模式下按 session 动态管理 Redis Stream 监听器的服务。
 * <p>
 * 每次对话请求在 gatewayClient.sendMessage() 之后，通过此类启动一个专属的
 * StreamMessageListenerContainer，监听 "byai_gateway:session:{sessionId}:data_stream"。
 * 监听到 appStreamResponse 或 error 事件后，由 ScriptService 主动调用 stopSessionListener() 停止并清理。
 * <p>
 * 设计要点：
 * <ul>
 *   <li>每个 session 对应一个独立的 StreamMessageListenerContainer，互相隔离。</li>
 *   <li>每个容器使用独立的 RedisStreamMessageListener 实例（每次通过 ApplicationContext 获取 prototype 新实例），避免并发安全问题。</li>
 *   <li>消费者组复用全局 CONSUMER_GROUP（不同 Stream Key 之间无竞争），消费者名称以 sessionId 区分，保证多实例环境唯一性。</li>
 *   <li>应用关闭时通过 ApplicationListener&lt;ContextClosedEvent&gt; 清理所有容器，防止资源泄漏。</li>
 * </ul>
 */
@Service
public class SessionStreamManager implements ApplicationListener<ContextClosedEvent> {

    private static final Logger log = LoggerFactory.getLogger(SessionStreamManager.class);

    /** Gateway Session Stream Key 前缀 */
    private static final String STREAM_KEY_PREFIX = "byai_gateway:session:";

    /** Stream Key 后缀 */
    private static final String STREAM_KEY_SUFFIX = ":data_stream";

    /** 消费者组名称 */
    private static final String CONSUMER_GROUP = "byai_conversation_service_group";

    /** 消费者名称前缀（多实例时以 sessionId 区分） */
    private static final String CONSUMER_NAME_PREFIX = "byai_conversation_consumer:";

    @Autowired
    private RedisConnectionFactory redisConnectionFactory;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private ApplicationContext applicationContext;

    /** sessionId -> StreamMessageListenerContainer，按 session 管理监听容器 */
    private final Map<String, StreamMessageListenerContainer<String, MapRecord<String, String, String>>> containers =
        new ConcurrentHashMap<>();

    /**
     * 启动指定 session 的 Redis Stream 监听器。
     * <p>
     * 应在 gatewayClient.sendMessage() 调用成功之后调用。
     *
     * @param sessionId 会话 ID
     * @param ctx       对话上下文（用于通知 RedisStreamMessageListener 写入目标队列）
     */
    public void startSessionListener(String sessionId, ChatProcessContext ctx) {
        String streamKey = buildStreamKey(sessionId);
        String consumerName = CONSUMER_NAME_PREFIX + sessionId;

        // 确保消费者组存在（Stream 不存在时通过 MKSTREAM 自动创建）
        createConsumerGroupIfAbsent(streamKey);

        // 构建容器配置
        StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
            StreamMessageListenerContainerOptions
                .builder()
                .pollTimeout(Duration.ofSeconds(2))
                .build();

        // 通过 ApplicationContext 获取 RedisStreamMessageListener prototype 新实例
        RedisStreamMessageListener listener = applicationContext.getBean(RedisStreamMessageListener.class);

        StreamMessageListenerContainer<String, MapRecord<String, String, String>> container =
            StreamMessageListenerContainer.create(redisConnectionFactory, options);

        container.receive(
            Consumer.from(CONSUMER_GROUP, consumerName),
            StreamOffset.create(streamKey, ReadOffset.lastConsumed()),
            listener
        );

        container.start();

        // 存入 map（先 stop 旧的可能存在的容器，避免重复启动）
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> old =
            containers.put(sessionId, container);

        if (old != null) {
            try {
                old.stop();
            } catch (Exception e) {
                log.warn("停止旧的 session 监听容器时发生异常, sessionId: {}", sessionId, e);
            }
        }

        log.info("Session Stream 监听已启动, stream: {}, consumer: {}", streamKey, consumerName);
    }

    /**
     * 停止并清理指定 session 的监听器。
     * <p>
     * 应在收到 appStreamResponse 或 error 事件后由 ScriptService 调用。
     * 此方法同时负责从 OutputStreamManager 中移除对应的 ChatProcessContext。
     *
     * @param sessionId 会话 ID
     */
    public void stopSessionListener(String sessionId) {
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> container =
            containers.remove(sessionId);

        if (container != null) {
            try {
                container.stop();
                log.info("Session Stream 监听已停止, sessionId: {}", sessionId);
            } catch (Exception e) {
                log.warn("停止 session 监听容器时发生异常, sessionId: {}", sessionId, e);
            }
        }

        // 清理 OutputStreamManager 中的上下文（确保不残留）
        OutputStreamManager outputStreamManager = applicationContext.getBean(OutputStreamManager.class);
        outputStreamManager.removeContext(sessionId);
    }

    /**
     * 应用关闭时清理所有监听器。
     */
    @Override
    public void onApplicationEvent(ContextClosedEvent event) {
        log.info("应用关闭，开始清理所有 Session Stream 监听器...");
        for (Map.Entry<String, StreamMessageListenerContainer<String, MapRecord<String, String, String>>> entry :
            containers.entrySet()) {
            try {
                entry.getValue().stop();
                log.info("已停止 session 监听器, sessionId: {}", entry.getKey());
            } catch (Exception e) {
                log.warn("停止 session 监听容器时发生异常, sessionId: {}", entry.getKey(), e);
            }
        }
        containers.clear();
        log.info("所有 Session Stream 监听器已清理完成");
    }

    /**
     * 构建 Session Stream Key。
     *
     * @param sessionId 会话 ID
     * @return 完整的 Stream Key，格式：byai_gateway:session:{sessionId}:data_stream
     */
    public String buildStreamKey(String sessionId) {
        return STREAM_KEY_PREFIX + sessionId + STREAM_KEY_SUFFIX;
    }

    /**
     * 创建消费者组（若已存在则跳过）。
     * MKSTREAM 选项在 Stream 不存在时自动创建。
     *
     * @param streamKey Redis Stream Key
     */
    private void createConsumerGroupIfAbsent(String streamKey) {
        try {
            redisTemplate.opsForStream().createGroup(streamKey, ReadOffset.latest(), CONSUMER_GROUP);
            log.info("已创建 Redis Stream 消费者组: {}, stream: {}", CONSUMER_GROUP, streamKey);
        } catch (Exception e) {
            if (e.getMessage() != null && e.getMessage().contains("BUSYGROUP")) {
                log.debug("Redis Stream 消费者组已存在: {}, stream: {}", CONSUMER_GROUP, streamKey);
            } else {
                log.warn("创建 Redis Stream 消费者组时发生异常，将继续启动: {}, stream: {}",
                    e.getMessage(), streamKey);
            }
        }
    }
}
