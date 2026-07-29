package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.apache.commons.lang3.StringUtils;
import com.iwhaleai.byai.framework.common.Constants;
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
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;
import com.iwhalecloud.byai.state.domain.ws.handler.SessionStatusRedisMessageListener;

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


    /** Session 状态 Key 前缀 */
    public static final String SESSION_STATUS_KEY_PREFIX = "byai:session:";

    /** Session 状态 Key 后缀 */
    public static final String SESSION_STATUS_KEY_SUFFIX = ":status";

    /** Session 状态 Hash 默认 field */
    public static final String DEFAULT_SESSION_STATUS_FIELD = "main";

    /** 消费者组名称 */
    public static final String CONSUMER_GROUP = "byai_conversation_service_group";

    /** 消费者名称前缀（多实例时以 sessionId 区分） */
    private static final String CONSUMER_NAME_PREFIX = "byai_conversation_consumer:";

    private static final String INIT_EVENT = "{\"event_type\":\"_init\"}";

    private static final long SESSION_STATUS_POLL_INTERVAL_MILLIS = 1000L;

    /** 会话结束后 Session 状态监听保留时长（毫秒），期间内同一 session 重新开始可复用监听 */
    private static final long SESSION_STATUS_LISTENER_LINGER_MILLIS = 30_000L;

    @Autowired
    private RedisConnectionFactory redisConnectionFactory;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private RedisMessageListenerContainer redisMessageListenerContainer;

    @Autowired
    private ApplicationContext applicationContext;

    /** sessionId -> StreamMessageListenerContainer，按 session 管理监听容器 */
    private final Map<String, StreamMessageListenerContainer<String, MapRecord<String, String, String>>> containers =
        new ConcurrentHashMap<>();

    /** sessionId -> Session 状态 Keyspace 监听 topic */
    private final Map<String, PatternTopic> sessionStatusTopics = new ConcurrentHashMap<>();

    /** sessionId -> Session 状态轮询任务 */
    private final Map<String, ScheduledFuture<?>> sessionStatusPollTasks = new ConcurrentHashMap<>();

    /** sessionId -> 当前监听的 Session 状态 Hash field */
    private final Map<String, String> sessionStatusFields = new ConcurrentHashMap<>();

    /** sessionId -> 最近一次已推送的 Session 状态值 */
    private final Map<String, String> sessionStatusLastValues = new ConcurrentHashMap<>();

    /** sessionId -> Session 状态监听延迟停止任务（会话结束后 linger 期间的待执行停止） */
    private final Map<String, ScheduledFuture<?>> sessionStatusStopTasks = new ConcurrentHashMap<>();

    /** 串行化 Session 状态监听的 start / stop / 延迟调度 / 取消，消除 linger 边界处的竞争 */
    private final Object sessionStatusLifecycleLock = new Object();

    /** sessionId -> running 标记续租任务 */
    private final Map<String, ScheduledFuture<?>> keepAliveTasks = new ConcurrentHashMap<>();

    private final ScheduledExecutorService keepAliveExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "chat-running-lease-keepalive");
        thread.setDaemon(true);
        return thread;
    });

    private final ScheduledExecutorService sessionStatusExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "session-status-listener-fallback");
        thread.setDaemon(true);
        return thread;
    });

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
        cancelKeepAlive(sessionId);
        startSessionStatusListener(sessionId, resolveAgentId(ctx));
        startKeepAlive(sessionId, ctx);

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
        cancelKeepAlive(sessionId);
        scheduleSessionStatusListenerStop(sessionId);

        // 清理 OutputStreamManager 中的上下文（确保不残留）
        OutputStreamManager outputStreamManager = applicationContext.getBean(OutputStreamManager.class);
        ChatProcessContext ctx = outputStreamManager.removeContext(sessionId);
        RunningOutputStreamRegistry runningOutputStreamRegistry =
            applicationContext.getBean(RunningOutputStreamRegistry.class);
        runningOutputStreamRegistry.releaseIfOwner(ctx);
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
        sessionStatusTopics.keySet().forEach(this::stopSessionStatusListener);
        sessionStatusTopics.clear();
        sessionStatusPollTasks.values().forEach(task -> task.cancel(false));
        sessionStatusPollTasks.clear();
        sessionStatusStopTasks.values().forEach(task -> task.cancel(false));
        sessionStatusStopTasks.clear();
        sessionStatusFields.clear();
        sessionStatusLastValues.clear();
        keepAliveTasks.values().forEach(task -> task.cancel(false));
        keepAliveTasks.clear();
        keepAliveExecutor.shutdownNow();
        sessionStatusExecutor.shutdownNow();
        log.info("所有 Session Stream 监听器已清理完成");
    }

    private void startKeepAlive(String sessionId, ChatProcessContext ctx) {
        if (ctx == null) {
            return;
        }
        RunningOutputStreamRegistry runningOutputStreamRegistry =
            applicationContext.getBean(RunningOutputStreamRegistry.class);
        RunningChatSnapshotService runningChatSnapshotService =
            applicationContext.getBean(RunningChatSnapshotService.class);
        ScheduledFuture<?> future = keepAliveExecutor.scheduleAtFixedRate(() -> {
            try {
                runningOutputStreamRegistry.touchRunning(ctx);
                runningChatSnapshotService.touch(ctx);
            }
            catch (Exception e) {
                log.warn("刷新 running 标记续租失败, sessionId: {}", sessionId, e);
            }
        }, 60, 60, TimeUnit.SECONDS);
        keepAliveTasks.put(sessionId, future);
    }

    private void cancelKeepAlive(String sessionId) {
        ScheduledFuture<?> future = keepAliveTasks.remove(sessionId);
        if (future != null) {
            future.cancel(false);
        }
    }

    /**
     * 构建 Session Stream Key。
     *
     * @param sessionId 会话 ID
     * @return 完整的 Stream Key，格式：byai_gateway:session:{sessionId}:data_stream
     */
    public String buildStreamKey(String sessionId) {
        return Constants.QueueNames.sessionDataStream(sessionId);
    }

    public String buildConsumerName(String sessionId) {
        return CONSUMER_NAME_PREFIX + sessionId;
    }

    /**
     * 构建 Session 状态 Key。
     *
     * @param sessionId 会话 ID
     * @return 完整状态 Key，格式：byai:session:{sessionId}:status
     */
    public String buildSessionStatusKey(String sessionId) {
        return SESSION_STATUS_KEY_PREFIX + sessionId + SESSION_STATUS_KEY_SUFFIX;
    }

    public void dispatchSessionStatusChange(String sessionId) {
        String currentValue = readSessionStatusValue(sessionId);
        if (currentValue == null) {
            sessionStatusLastValues.remove(sessionId);
            return;
        }
        dispatchSessionStatusChange(sessionId, currentValue);
    }

    public void dispatchSessionStatusChange(String sessionId, String statusValue) {
        if (StringUtils.isBlank(sessionId) || StringUtils.isBlank(statusValue)) {
            return;
        }
        String previous = sessionStatusLastValues.put(sessionId, statusValue);
        if (StringUtils.equals(previous, statusValue)) {
            return;
        }
        applicationContext.getBean(SessionStreamEventRouter.class).broadcastSessionStatus(sessionId, statusValue);
    }

    private void startSessionStatusListener(String sessionId, Long agentId) {
        synchronized (sessionStatusLifecycleLock) {
            // 取消可能挂起的延迟停止任务，linger 期间重新开始则复用监听
            cancelSessionStatusListenerStop(sessionId);

            String statusField = resolveSessionStatusField(agentId);
            String oldField = sessionStatusFields.put(sessionId, statusField);
            if (!StringUtils.equals(oldField, statusField)) {
                sessionStatusLastValues.remove(sessionId);
            }

            PatternTopic topic = new PatternTopic("__keyspace@*__:" + buildSessionStatusKey(sessionId));
            PatternTopic old = sessionStatusTopics.put(sessionId, topic);
            SessionStatusRedisMessageListener listener =
                applicationContext.getBean(SessionStatusRedisMessageListener.class);
            if (old != null) {
                redisMessageListenerContainer.removeMessageListener(listener, old);
            }
            redisMessageListenerContainer.addMessageListener(listener, topic);
            log.info("Session 状态 Key 监听已启动, key: {}, field: {}", buildSessionStatusKey(sessionId), statusField);
            startSessionStatusPolling(sessionId);
        }
    }

    /**
     * 安排 Session 状态监听在 linger 时长后停止。
     * <p>
     * 会话结束后不立即停止，保留 {@link #SESSION_STATUS_LISTENER_LINGER_MILLIS} 毫秒，
     * 期间同一 sessionId 重新开始监听则复用并取消本任务。
     */
    private void scheduleSessionStatusListenerStop(String sessionId) {
        synchronized (sessionStatusLifecycleLock) {
            if (!sessionStatusTopics.containsKey(sessionId)) {
                return;
            }
            cancelSessionStatusListenerStop(sessionId);
            ScheduledFuture<?>[] holder = new ScheduledFuture<?>[1];
            ScheduledFuture<?> future = sessionStatusExecutor.schedule(() -> {
                synchronized (sessionStatusLifecycleLock) {
                    // 仅当自己仍是当前挂起任务时才执行停止（避免被重启取消后又误停）
                    if (sessionStatusStopTasks.get(sessionId) != holder[0]) {
                        return;
                    }
                    sessionStatusStopTasks.remove(sessionId);
                    stopSessionStatusListener(sessionId);
                }
            }, SESSION_STATUS_LISTENER_LINGER_MILLIS, TimeUnit.MILLISECONDS);
            holder[0] = future;
            sessionStatusStopTasks.put(sessionId, future);
            log.info("Session 状态 Key 监听将于 {}ms 后停止, sessionId: {}",
                SESSION_STATUS_LISTENER_LINGER_MILLIS, sessionId);
        }
    }

    private void cancelSessionStatusListenerStop(String sessionId) {
        ScheduledFuture<?> task = sessionStatusStopTasks.remove(sessionId);
        if (task != null) {
            task.cancel(false);
        }
    }

    private void stopSessionStatusListener(String sessionId) {
        synchronized (sessionStatusLifecycleLock) {
            cancelSessionStatusListenerStop(sessionId);
            PatternTopic topic = sessionStatusTopics.remove(sessionId);
            if (topic != null) {
                try {
                    SessionStatusRedisMessageListener listener =
                        applicationContext.getBean(SessionStatusRedisMessageListener.class);
                    redisMessageListenerContainer.removeMessageListener(listener, topic);
                    log.info("Session 状态 Key 监听已停止, sessionId: {}", sessionId);
                }
                catch (Exception e) {
                    log.warn("停止 Session 状态 Key 监听时发生异常, sessionId: {}", sessionId, e);
                }
            }
            ScheduledFuture<?> pollTask = sessionStatusPollTasks.remove(sessionId);
            if (pollTask != null) {
                pollTask.cancel(false);
            }
            sessionStatusFields.remove(sessionId);
            sessionStatusLastValues.remove(sessionId);
        }
    }

    private void startSessionStatusPolling(String sessionId) {
        ScheduledFuture<?> oldTask = sessionStatusPollTasks.remove(sessionId);
        if (oldTask != null) {
            oldTask.cancel(false);
        }

        // 重新监听时，以当前 Redis 值为基线，忽略历史/未消费的数据，仅广播之后的变化
        String currentValue = readSessionStatusValue(sessionId);
        if (currentValue == null) {
            sessionStatusLastValues.remove(sessionId);
        }
        else {
            sessionStatusLastValues.put(sessionId, currentValue);
        }

        ScheduledFuture<?> pollTask = sessionStatusExecutor.scheduleWithFixedDelay(() -> {
            try {
                pollSessionStatus(sessionId);
            }
            catch (Exception e) {
                log.warn("轮询 Session 状态 Key 失败, key: {}", buildSessionStatusKey(sessionId), e);
            }
        }, SESSION_STATUS_POLL_INTERVAL_MILLIS, SESSION_STATUS_POLL_INTERVAL_MILLIS, TimeUnit.MILLISECONDS);
        sessionStatusPollTasks.put(sessionId, pollTask);
    }

    private void pollSessionStatus(String sessionId) {
        dispatchSessionStatusChange(sessionId);
    }

    private String readSessionStatusValue(String sessionId) {
        Object value = redisTemplate.opsForHash()
            .get(buildSessionStatusKey(sessionId), resolveSessionStatusField(sessionId));
        return value == null ? null : String.valueOf(value);
    }

    private Long resolveAgentId(ChatProcessContext ctx) {
        return ctx == null || ctx.assistantChatDto == null ? null : ctx.assistantChatDto.getAgentId();
    }

    private String resolveSessionStatusField(Long agentId) {
        return agentId == null ? DEFAULT_SESSION_STATUS_FIELD : String.valueOf(agentId);
    }

    private String resolveSessionStatusField(String sessionId) {
        return StringUtils.defaultIfBlank(sessionStatusFields.get(sessionId), DEFAULT_SESSION_STATUS_FIELD);
    }

    /**
     * 创建消费者组（若已存在则跳过）。
     * MKSTREAM 选项在 Stream 不存在时自动创建。
     *
     * @param streamKey Redis Stream Key
     */
    private void createConsumerGroupIfAbsent(String streamKey) {
        try {
            ensureStreamExists(streamKey);
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

    private void ensureStreamExists(String streamKey) {
        if (Boolean.TRUE.equals(redisTemplate.hasKey(streamKey))) {
            return;
        }
        redisTemplate.opsForStream().add(streamKey, Map.of("data", INIT_EVENT));
        log.info("Session Stream 不存在，已初始化创建, stream: {}", streamKey);
    }
}
