package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.apache.commons.lang3.StringUtils;
import com.iwhaleai.byai.framework.common.Constants;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
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
import org.springframework.data.redis.stream.StreamMessageListenerContainer.ConsumerStreamReadRequest;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamMessageListenerContainerOptions;
import org.springframework.data.redis.stream.StreamMessageListenerContainer.StreamReadRequest;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;
import com.iwhalecloud.byai.state.domain.ws.handler.SessionStatusRedisMessageListener;

import jakarta.annotation.PostConstruct;

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

    static final long DEFAULT_POLL_TIMEOUT_MILLIS = 2000L;

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

    @Value("${byclaw.session-stream.max-length:10000}")
    private long sessionStreamMaxLength;

    /** 已终结 Session Stream 的保留时长（小时），到期后由 Redis 回收整个 key。 */
    @Value("${byclaw.session-stream.completed-retention-hours:24}")
    private long completedStreamRetentionHours;

    @Autowired
    private SessionStreamLeaseService sessionStreamLeaseService;

    @Autowired
    private ChatRuntimeInstance chatRuntimeInstance;

    @Autowired
    private StreamAckFailureRegistry streamAckFailureRegistry;

    @Autowired
    private SessionStreamMetrics sessionStreamMetrics;

    @Value("${byclaw.session-stream.poll-timeout-millis:" + DEFAULT_POLL_TIMEOUT_MILLIS + "}")
    private long pollTimeoutMillis;

    @Value("${spring.redis.read-timeout:5000}")
    private long redisReadTimeoutMillis;

    /** 单次 XREADGROUP 最多拉取的事件数，避免一次轮询载入过大批次。 */
    @Value("${byclaw.session-stream.read-batch-size:100}")
    private int streamReadBatchSize;

    /** Redis Stream 长轮询使用虚拟线程，阻塞等待不再为每个 session 长期占用平台线程。 */
    private final ExecutorService streamTaskExecutor = Executors.newVirtualThreadPerTaskExecutor();

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

    /** sessionId -> Redis 单活 listener lease */
    private final Map<String, SessionStreamLeaseService.Lease> streamLeases = new ConcurrentHashMap<>();

    /** sessionId -> Redis lease 续租任务 */
    private final Map<String, ScheduledFuture<?>> streamLeaseTasks = new ConcurrentHashMap<>();

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
     * Redis socket read timeout 必须覆盖 XREADGROUP BLOCK 时长并保留网络处理余量。
     * 显式配置不合理时只告警，不阻止应用启动，便于存量环境先完成配置修正。
     */
    @PostConstruct
    void validateTimeoutConfiguration() {
        if (redisReadTimeoutMillis <= pollTimeoutMillis) {
            sessionStreamMetrics.recordInvalidConfiguration();
            log.warn("Session Stream timeout 配置缺少余量, pollTimeoutMillis: {}, redisReadTimeoutMillis: {}",
                pollTimeoutMillis, redisReadTimeoutMillis);
        }
    }

    /**
     * 启动指定 session 的 Redis Stream 监听器。
     * <p>
     * 应在 gatewayClient.sendMessage() 调用成功之后调用。
     *
     * @param sessionId 会话 ID
     * @param ctx       对话上下文（用于通知 RedisStreamMessageListener 写入目标队列）
     */
    public boolean startSessionListener(String sessionId, ChatProcessContext ctx) {
        SessionStreamLeaseService.Lease lease = sessionStreamLeaseService.tryAcquire(sessionId).orElse(null);
        if (lease == null) {
            log.info("Session Stream listener 已由其他实例持有, sessionId: {}, instanceId: {}", sessionId,
                chatRuntimeInstance.getInstanceId());
            return false;
        }
        streamLeases.put(sessionId, lease);
        StreamMessageListenerContainer<String, MapRecord<String, String, String>> container = null;
        try {
            String streamKey = buildStreamKey(sessionId);
            String consumerName = buildConsumerName(sessionId);

            // 确保消费者组存在（Stream 不存在时通过 MKSTREAM 自动创建）
            createConsumerGroupIfAbsent(streamKey);

            // 构建容器配置
            StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> options =
                createContainerOptions();

            // 通过 ApplicationContext 获取 RedisStreamMessageListener prototype 新实例
            RedisStreamMessageListener listener = applicationContext.getBean(RedisStreamMessageListener.class);

            container = StreamMessageListenerContainer.create(redisConnectionFactory, options);

            container.register(createReadRequest(sessionId, streamKey, consumerName), listener);

            container.start();

            // 存入 map（先 stop 旧的可能存在的容器，避免重复启动）
            StreamMessageListenerContainer<String, MapRecord<String, String, String>> old =
                containers.put(sessionId, container);
            sessionStreamMetrics.updateActiveListeners(containers.size());

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
            startStreamLeaseRenewal(sessionId, lease);

            log.info("Session Stream 监听已启动, stream: {}, consumer: {}", streamKey, consumerName);
            return true;
        }
        catch (Exception e) {
            if (container != null) {
                containers.remove(sessionId, container);
                sessionStreamMetrics.updateActiveListeners(containers.size());
                try {
                    container.stop();
                }
                catch (Exception stopException) {
                    log.warn("启动 Session Stream listener 失败后停止容器异常, sessionId: {}", sessionId, stopException);
                }
            }
            cancelKeepAlive(sessionId);
            cancelStreamLease(sessionId);
            throw e;
        }
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
        sessionStreamMetrics.updateActiveListeners(containers.size());

        if (container != null) {
            try {
                container.stop();
                log.info("Session Stream 监听已停止, sessionId: {}", sessionId);
            } catch (Exception e) {
                log.warn("停止 session 监听容器时发生异常, sessionId: {}", sessionId, e);
            }
        }
        cancelKeepAlive(sessionId);
        cancelStreamLease(sessionId);
        scheduleSessionStatusListenerStop(sessionId);
        // listener 已停止，遗留的 ACK 失败登记不再有对应消费者，交回常规 idle 扫描兜底。
        streamAckFailureRegistry.clearAll(buildStreamKey(sessionId));

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
        sessionStreamMetrics.updateActiveListeners(0L);
        streamLeaseTasks.values().forEach(task -> task.cancel(false));
        streamLeaseTasks.clear();
        streamLeases.values().forEach(sessionStreamLeaseService::release);
        streamLeases.clear();
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
        streamTaskExecutor.shutdownNow();
        log.info("所有 Session Stream 监听器已清理完成");
    }

    /**
     * 构建 Session Stream 容器配置。读取批量设上限，长轮询任务使用虚拟线程承载阻塞等待。
     */
    StreamMessageListenerContainerOptions<String, MapRecord<String, String, String>> createContainerOptions() {
        if (streamReadBatchSize <= 0) {
            throw new IllegalStateException("byclaw.session-stream.read-batch-size must be greater than zero");
        }
        return StreamMessageListenerContainerOptions
            .builder()
            .pollTimeout(Duration.ofMillis(pollTimeoutMillis))
            .batchSize(streamReadBatchSize)
            .executor(streamTaskExecutor)
            .build();
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
        return CONSUMER_NAME_PREFIX + chatRuntimeInstance.getInstanceId() + ":" + sessionId;
    }

    public boolean isSessionListenerActive(String sessionId) {
        return sessionId != null && containers.containsKey(sessionId);
    }

    /**
     * 返回当前实例活跃 Session Stream listener 的只读快照，供低频聚合指标采样使用。
     */
    Set<String> activeSessionIdsSnapshot() {
        return Set.copyOf(containers.keySet());
    }

    /**
     * 构建手动 ACK 的 Consumer Group 读取请求。
     * <p>
     * Redis 读取或反序列化异常不会取消 subscription，poll task 会在错误处理后继续下一轮读取。
     */
    ConsumerStreamReadRequest<String> createReadRequest(String sessionId, String streamKey, String consumerName) {
        return StreamReadRequest.<String>builder(StreamOffset.create(streamKey, ReadOffset.lastConsumed()))
            .consumer(Consumer.from(CONSUMER_GROUP, consumerName))
            .autoAcknowledge(false)
            .errorHandler(error -> {
                sessionStreamMetrics.recordReadError(error);
                log.warn("Session Stream 读取异常，将继续轮询, sessionId: {}, stream: {}, consumer: {}, "
                        + "errorType: {}, errorMessage: {}",
                    sessionId, streamKey, consumerName, error.getClass().getSimpleName(), error.getMessage());
            })
            .cancelOnError(error -> false)
            .build();
    }

    /**
     * 仅在当前 session 没有 listener 且 Consumer Group 没有 pending 时按长度清理 Stream。
     * <p>
     * Spring Data Redis 当前版本只暴露 MAXLEN trim，因此宁可延后清理，也不在存在 PEL 时删除记录。
     */
    public void trimCompletedStream(String sessionId) {
        if (sessionId == null || isSessionListenerActive(sessionId)) {
            return;
        }
        String streamKey = buildStreamKey(sessionId);
        try {
            var pending = redisTemplate.opsForStream().pending(streamKey, CONSUMER_GROUP);
            if (pending != null && pending.getTotalPendingMessages() > 0) {
                return;
            }
            // 先按长度裁剪，兜住「会话结束后 worker 仍追加事件」的情况。
            redisTemplate.opsForStream().trim(streamKey, sessionStreamMaxLength, true);
            // 单个 session 的事件量通常远小于长度上限，MAXLEN 实际不会释放内存，
            // 因此对已终结且无 pending 的 Stream 设置过期时间，让 Redis 回收整个 key。
            // 用 expire 而非 DEL：保留一段窗口，容忍 worker 的迟到事件与 recovery 的二次查询。
            redisTemplate.expire(streamKey, completedStreamRetentionHours, TimeUnit.HOURS);
            log.info("已完成 Session Stream 清理, stream: {}, retentionHours: {}", streamKey,
                completedStreamRetentionHours);
        }
        catch (Exception e) {
            log.warn("清理已完成 Session Stream 失败, stream: {}", streamKey, e);
        }
    }

    private void startStreamLeaseRenewal(String sessionId, SessionStreamLeaseService.Lease lease) {
        ScheduledFuture<?> future = keepAliveExecutor.scheduleAtFixedRate(() -> {
            if (!sessionStreamLeaseService.renew(lease)) {
                log.warn("Session Stream listener lease 续租失败, sessionId: {}, instanceId: {}", sessionId,
                    chatRuntimeInstance.getInstanceId());
                // lease 已失效时立即停止本地 listener，避免与新 owner 并行消费同一 session。
                keepAliveExecutor.execute(() -> stopSessionListener(sessionId));
            }
        }, 30, 30, TimeUnit.SECONDS);
        streamLeaseTasks.put(sessionId, future);
    }

    private void cancelStreamLease(String sessionId) {
        ScheduledFuture<?> task = streamLeaseTasks.remove(sessionId);
        if (task != null) {
            task.cancel(false);
        }
        SessionStreamLeaseService.Lease lease = streamLeases.remove(sessionId);
        if (lease != null) {
            sessionStreamLeaseService.release(lease);
        }
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
