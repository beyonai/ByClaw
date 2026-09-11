package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationContext;
import org.springframework.context.ApplicationListener;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.data.redis.connection.stream.ReadOffset;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.stereotype.Service;

import com.iwhaleai.byai.framework.common.Constants;
import com.iwhalecloud.byai.state.domain.ws.handler.RedisStreamMessageListener;
import com.iwhalecloud.byai.state.domain.ws.handler.SessionStatusRedisMessageListener;

/**
 * Gateway 模式下按 session 动态管理 Redis Stream 监听器的服务。
 * <p>
 * 每次对话请求在 gatewayClient.sendMessage() 之后，通过此类注册对应的 Session Stream。
 * 监听到 appStreamResponse 或 error 事件后，由 ScriptService 主动调用 stopSessionListener() 停止并清理。
 * <p>
 * 设计要点：
 * <ul>
 *   <li>沿用 SDK v1/v2 key，通过 Lettuce/Netty 共享连接执行非阻塞单 key 读取，兼容单机与集群。</li>
 *   <li>每个 session 使用独立的 RedisStreamMessageListener prototype 实例，保持处理与 ACK 隔离。</li>
 *   <li>消费者组复用全局 CONSUMER_GROUP；Redis lease 保证每个 session 同一时刻只由一个 BE 实例读取。</li>
 *   <li>应用关闭时通过 ApplicationListener&lt;ContextClosedEvent&gt; 清理所有订阅，防止资源泄漏。</li>
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
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private RedisMessageListenerContainer redisMessageListenerContainer;

    @Autowired
    private ApplicationContext applicationContext;

    @Value("${byclaw.session-stream.max-length:10000}")
    private long sessionStreamMaxLength;

    /** 已终结 Session Stream 的保留时长（小时），到期后由 Redis 回收整个 key。 */
    /**
     * 会话终结后 Stream Key 的保留时长，与 {@link #activeStreamTtlSeconds} 一致地对齐 session 生命周期。
     * <p>
     * 事件的写入方是沙箱内的 gateway SDK，它在每条事件的 pipeline 里把 TTL 续期到 session 生命周期。
     * 这里如果取更短的值，等于 BE 单方面缩短了写入方声明的保留期：历史会话在写入方认为仍然有效的窗口内
     * 就被回收，前端回看不到内容，跨实例 recovery 也失去可重放的数据。
     */
    @Value("${byclaw.session-stream.completed-retention-hours:168}")
    private long completedStreamRetentionHours;

    /**
     * 活跃会话 Stream Key 的过期时间，需与 gateway SDK 的 {@code RegistryKeys.DEFAULT_SESSION_TTL} 保持一致。
     * <p>
     * 只用于在监听启动时撑开上一轮终结时留下的 TTL，真正的续期由 SDK 在每条事件上完成。
     * 取值必须远大于沙箱冷启动到首条事件的耗时，否则这段空窗内 key 仍可能被回收。
     */
    @Value("${byclaw.session-stream.active-ttl-seconds:604800}")
    private long activeStreamTtlSeconds;

    @Autowired
    private SessionStreamLeaseService sessionStreamLeaseService;

    @Autowired
    private ChatRuntimeInstance chatRuntimeInstance;

    @Autowired
    private StreamAckFailureRegistry streamAckFailureRegistry;

    @Autowired
    private SessionStreamMetrics sessionStreamMetrics;

    @Autowired
    private ReactiveSessionStreamReceiver reactiveSessionStreamReceiver;

    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;

    private volatile boolean shuttingDown;
    private final Map<String, RedisStreamMessageListener> listeners = new ConcurrentHashMap<>();

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

    /** sessionId -> running 标记续租任务 */
    private final Map<String, ScheduledFuture<?>> keepAliveTasks = new ConcurrentHashMap<>();

    /** sessionId -> Redis 单活 listener lease */
    private final Map<String, SessionStreamLeaseService.Lease> streamLeases = new ConcurrentHashMap<>();

    /** sessionId -> Redis lease 续租任务 */
    private final Map<String, ScheduledFuture<?>> streamLeaseTasks = new ConcurrentHashMap<>();

    private final ScheduledExecutorService keepAliveExecutor = Executors.newScheduledThreadPool(4, r -> {
        Thread thread = new Thread(r, "chat-running-lease-keepalive");
        thread.setDaemon(true);
        return thread;
    });

    private final ScheduledExecutorService streamLeaseExecutor = Executors.newScheduledThreadPool(4, r -> {
        Thread thread = new Thread(r, "session-stream-lease-renewal");
        thread.setDaemon(true);
        return thread;
    });

    private final ScheduledExecutorService sessionStatusExecutor = Executors.newScheduledThreadPool(4, r -> {
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
    public boolean startSessionListener(String sessionId, ChatProcessContext ctx) {
        return outputStreamManager.withSessionLock(sessionId, () -> startSessionListenerLocked(sessionId, ctx, false));
    }

    public boolean startSessionListenerForRecovery(String sessionId, ChatProcessContext ctx) {
        return outputStreamManager.withSessionLock(sessionId, () -> startSessionListenerLocked(sessionId, ctx, true));
    }

    public boolean isSessionListenerPaused(String sessionId) {
        return sessionId != null && reactiveSessionStreamReceiver.isPaused(sessionId);
    }

    /** Enable unread polling only after the owner has checkpointed the older pending records. */
    public boolean resumeRecoveredSessionListener(String sessionId) {
        return outputStreamManager.withSessionLock(sessionId, () -> {
            if (shuttingDown) throw new RejectedExecutionException("Session Stream manager is shutting down");
            return reactiveSessionStreamReceiver.resume(sessionId);
        });
    }

    private boolean startSessionListenerLocked(String sessionId, ChatProcessContext ctx, boolean paused) {
        if (shuttingDown) {
            throw new RejectedExecutionException("Session Stream manager is shutting down");
        }
        if (listeners.containsKey(sessionId)) {
            return true;
        }
        RedisStreamMessageListener listener = null;
        boolean reactiveRegistered = false;
        try {
            SessionStreamLeaseService.Lease lease = sessionStreamLeaseService.tryAcquire(sessionId).orElse(null);
            if (lease == null) {
                log.info("Session Stream listener 已由其他实例持有, sessionId: {}, instanceId: {}", sessionId,
                    chatRuntimeInstance.getInstanceId());
                return false;
            }
            streamLeases.put(sessionId, lease);
            if (shuttingDown) {
                throw new RejectedExecutionException("Session Stream manager is shutting down");
            }
            String streamKey = buildStreamKey(sessionId);
            String consumerName = buildConsumerName(sessionId);
            createConsumerGroupIfAbsent(streamKey);
            listener = applicationContext.getBean(RedisStreamMessageListener.class);
            listeners.put(sessionId, listener);
            reactiveRegistered = true;
            reactiveSessionStreamReceiver.register(sessionId, streamKey, consumerName, listener, paused);
            sessionStreamMetrics.updateActiveListeners(listeners.size());
            startSessionStatusListener(sessionId, resolveAgentId(ctx));
            startKeepAlive(sessionId, ctx);
            startStreamLeaseRenewal(sessionId, lease);
            // A start already waiting on Redis when shutdown began must clean up its eventual resources too.
            if (shuttingDown) {
                throw new RejectedExecutionException("Session Stream manager is shutting down");
            }
            log.info("Session Stream 监听已启动, stream: {}, consumer: {}", streamKey, consumerName);
            return true;
        }
        catch (RuntimeException | Error error) {
            if (reactiveRegistered) reactiveSessionStreamReceiver.unregister(sessionId);
            if (listener != null) {
                listeners.remove(sessionId, listener);
                listener.close();
            }
            cancelKeepAlive(sessionId);
            cancelStreamLease(sessionId);
            stopSessionStatusListener(sessionId);
            throw error;
        }
    }

    /**
     * 完成一轮消息的清理；同会话其他轮次仍在运行时继续共享监听。
     * @return 当前实例已完成最后一轮并停止监听时返回 true。
     */
    public boolean completeSessionTurn(ChatProcessContext completed) {
        if (completed == null || completed.sessionId == null) return false;
        String sessionId = String.valueOf(completed.sessionId);
        return outputStreamManager.withSessionLock(sessionId, () -> {
            // Only the listener owner may promote another turn or stop shared consumption.
            if (!isSessionListenerActive(sessionId)) {
                outputStreamManager.removeContext(sessionId, completed);
                chatRuntimeStateService.delete(completed);
                applicationContext.getBean(RunningOutputStreamRegistry.class).releaseIfOwner(completed);
                return false;
            }
            ChatProcessContext owner = outputStreamManager.getContext(sessionId);
            // A delayed cleanup belongs only to the completed trace, not a subsequent user request.
            outputStreamManager.removeContext(sessionId, completed);
            chatRuntimeStateService.delete(completed);
            for (var state : chatRuntimeStateService.getSessionTurns(completed.sessionId)) {
                if (outputStreamManager.getContext(sessionId, state.getTraceId()) == null) {
                    applicationContext.getBean(ChatContextRecoveryService.class).recover(state);
                }
            }
            ChatProcessContext remaining = outputStreamManager.getContext(sessionId);
            if (remaining != null) {
                if (remaining != owner) {
                    applicationContext.getBean(RunningOutputStreamRegistry.class).markRunning(remaining);
                }
                return false;
            }
            stopSessionListener(sessionId);
            applicationContext.getBean(RunningOutputStreamRegistry.class).releaseIfOwner(completed);
            return true;
        });
    }

    public void stopSessionListener(String sessionId) {
        outputStreamManager.withSessionLock(sessionId, () -> {
            stopSessionListenerLocked(sessionId);
            return null;
        });
    }

    private void stopSessionListenerLocked(String sessionId) {
        stopPolling(sessionId);
        cancelKeepAlive(sessionId);
        cancelStreamLease(sessionId);
        scheduleSessionStatusListenerStop(sessionId);
        streamAckFailureRegistry.clearAll(buildStreamKey(sessionId));
        ChatProcessContext ctx = outputStreamManager.removeContext(sessionId);
        applicationContext.getBean(RunningOutputStreamRegistry.class).releaseIfOwner(ctx);
    }

    private void stopPolling(String sessionId) {
        reactiveSessionStreamReceiver.unregister(sessionId);
        RedisStreamMessageListener listener = listeners.remove(sessionId);
        if (listener != null) {
            // close() wakes queue backpressure and discards unacknowledged work without joining its worker.
            // A terminal event may call this on the active batch worker itself.
            listener.close();
        }
        sessionStreamMetrics.updateActiveListeners(listeners.size());
        log.info("Session Stream 监听已停止, sessionId: {}", sessionId);
    }

    /**
     * 应用关闭时清理所有监听器。
     */
    @Override
    public void onApplicationEvent(ContextClosedEvent event) {
        shuttingDown = true;
        log.info("应用关闭，开始清理所有 Session Stream 监听器...");
        Set<String> activeSessionIds = new HashSet<>(listeners.keySet());
        activeSessionIds.addAll(streamLeases.keySet());
        for (String sessionId : activeSessionIds) {
            outputStreamManager.withSessionLock(sessionId, () -> {
                cancelKeepAlive(sessionId);
                stopPolling(sessionId);
                try {
                    for (ChatProcessContext ctx : outputStreamManager.getContexts(sessionId)) {
                        if (chatRuntimeStateService.requestHandoff(ctx)) {
                            log.info("已将聊天运行态标记为可接管, sessionId: {}, traceId: {}", sessionId, ctx.traceId);
                        }
                    }
                }
                catch (Exception error) {
                    log.warn("标记聊天运行态为可接管失败, sessionId: {}", sessionId, error);
                }
                finally {
                    cancelStreamLease(sessionId);
                    stopSessionStatusListener(sessionId);
                }
                return null;
            });
        }
        sessionStreamMetrics.updateActiveListeners(0L);
        sessionStatusTopics.keySet().forEach(this::stopSessionStatusListener);
        keepAliveExecutor.shutdownNow();
        streamLeaseExecutor.shutdownNow();
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
                for (ChatProcessContext current : outputStreamManager.getContexts(sessionId)) {
                    if (current.concurrentGatewayTurn) {
                        if (!chatRuntimeStateService.isRegistered(current)) {
                            // A remote sender may have failed after this listener recovered its registration.
                            completeSessionTurn(current);
                            continue;
                        }
                        chatRuntimeStateService.touch(current);
                    }
                    runningOutputStreamRegistry.touchRunning(current);
                    runningChatSnapshotService.touch(current);
                }
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
     * @return 与 REDIS_KEY_SCHEMA_VERSION 对应的完整 Stream Key
     */
    public String buildStreamKey(String sessionId) {
        return Constants.QueueNames.sessionDataStream(sessionId);
    }

    public String buildConsumerName(String sessionId) {
        return CONSUMER_NAME_PREFIX + chatRuntimeInstance.getInstanceId() + ":" + sessionId;
    }

    public boolean isSessionListenerActive(String sessionId) {
        return sessionId != null && listeners.containsKey(sessionId);
    }

    /**
     * 返回当前实例活跃 Session Stream listener 的只读快照，供低频聚合指标采样使用。
     */
    Set<String> activeSessionIdsSnapshot() {
        return Set.copyOf(listeners.keySet());
    }

    /**
     * 仅在当前 session 没有 listener 且 Consumer Group 没有 pending 时按长度清理 Stream。
     * <p>
     * Spring Data Redis 当前版本只暴露 MAXLEN trim，因此宁可延后清理，也不在存在 PEL 时删除记录。
     */
    public void trimCompletedStream(String sessionId) {
        if (sessionId == null) {
            return;
        }
        // 在 session 锁内判定并设置过期，使其与 startSessionListenerLocked 的 persist 互斥。
        // 否则「判定无 listener」与「设置过期」之间新一轮对话若启动成功，其 persist 会被这里的 expire 覆盖，
        // 活跃会话的 Stream 又重新带上 TTL。
        outputStreamManager.withSessionLock(sessionId, () -> {
            trimCompletedStreamLocked(sessionId);
            return null;
        });
    }

    private void trimCompletedStreamLocked(String sessionId) {
        if (isSessionListenerActive(sessionId)) {
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
        ScheduledFuture<?> future = streamLeaseExecutor.scheduleAtFixedRate(() -> {
            if (streamLeases.get(sessionId) != lease) {
                return;
            }
            try {
                if (sessionStreamLeaseService.renew(lease)) {
                    return;
                }
                log.warn("Session Stream listener lease 续租失败, sessionId: {}", sessionId);
            }
            catch (Exception error) {
                // An unchecked exception must not silently terminate the periodic renewal while consumption lives on.
                log.warn("Session Stream listener lease 续租异常，停止所有权不确定的本地监听, sessionId: {}", sessionId, error);
            }
            outputStreamManager.withSessionLock(sessionId, () -> {
                // A delayed failure of an old renewal must never stop a replacement listener.
                if (streamLeases.get(sessionId) == lease) {
                    stopSessionListenerLocked(sessionId);
                }
                return null;
            });
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
            try {
                sessionStreamLeaseService.release(lease);
            }
            catch (Exception error) {
                // Consumption is already stopped; an unavailable Redis server will reclaim the lease by its TTL.
                log.warn("释放 Session Stream listener lease 失败, sessionId: {}", sessionId, error);
            }
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
        outputStreamManager.withSessionLock(sessionId, () -> {
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
            return null;
        });
    }

    /** Keep the status subscription briefly after completion; a same-session restart cancels the delayed stop. */
    private void scheduleSessionStatusListenerStop(String sessionId) {
        outputStreamManager.withSessionLock(sessionId, () -> {
            if (!sessionStatusTopics.containsKey(sessionId)) {
                return null;
            }
            cancelSessionStatusListenerStop(sessionId);
            ScheduledFuture<?>[] holder = new ScheduledFuture<?>[1];
            ScheduledFuture<?> future = sessionStatusExecutor.schedule(() ->
                outputStreamManager.withSessionLock(sessionId, () -> {
                    if (sessionStatusStopTasks.get(sessionId) != holder[0]) {
                        return null;
                    }
                    sessionStatusStopTasks.remove(sessionId);
                    stopSessionStatusListener(sessionId);
                    return null;
                }), SESSION_STATUS_LISTENER_LINGER_MILLIS, TimeUnit.MILLISECONDS);
            holder[0] = future;
            sessionStatusStopTasks.put(sessionId, future);
            log.info("Session 状态 Key 监听将于 {}ms 后停止, sessionId: {}",
                SESSION_STATUS_LISTENER_LINGER_MILLIS, sessionId);
            return null;
        });
    }

    private void cancelSessionStatusListenerStop(String sessionId) {
        ScheduledFuture<?> task = sessionStatusStopTasks.remove(sessionId);
        if (task != null) {
            task.cancel(false);
        }
    }

    private void stopSessionStatusListener(String sessionId) {
        outputStreamManager.withSessionLock(sessionId, () -> {
            cancelSessionStatusListenerStop(sessionId);
            PatternTopic topic = sessionStatusTopics.remove(sessionId);
            if (topic != null) {
                try {
                    SessionStatusRedisMessageListener listener =
                        applicationContext.getBean(SessionStatusRedisMessageListener.class);
                    redisMessageListenerContainer.removeMessageListener(listener, topic);
                    log.info("Session 状态 Key 监听已停止, sessionId: {}", sessionId);
                }
                catch (Exception error) {
                    log.warn("停止 Session 状态 Key 监听时发生异常, sessionId: {}", sessionId, error);
                }
            }
            ScheduledFuture<?> pollTask = sessionStatusPollTasks.remove(sessionId);
            if (pollTask != null) {
                pollTask.cancel(false);
            }
            sessionStatusFields.remove(sessionId);
            sessionStatusLastValues.remove(sessionId);
            return null;
        });
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
            refreshActiveStreamTtl(streamKey);
            return;
        }
        redisTemplate.opsForStream().add(streamKey, Map.of("data", INIT_EVENT));
        log.info("Session Stream 不存在，已初始化创建, stream: {}", streamKey);
        // XADD 创建新 key 时不带过期时间。事件写入方会在首条事件上补齐 TTL，但在它到达之前这个 key 是永不过期的；
        // 若本轮始终没有事件写入，它就会永久驻留，因此创建时即给出与 session 生命周期一致的上界。
        refreshActiveStreamTtl(streamKey);
    }

    /**
     * 把上一轮终结时留下的剩余 TTL 重新撑开到完整的 session 生命周期。
     * <p>
     * 同一个 session 可以在保留窗口内被重新使用。此时 Stream Key 仍然存在，Consumer Group 与 PEL 也都完好，
     * 但 key 上那个为「已终结」设置的 TTL 仍在倒计时。事件写入方（沙箱内的 gateway SDK）只在实际写事件时续期，
     * 因此从监听启动到首条事件之间存在一段空窗；若剩余 TTL 短于沙箱冷启动耗时，Redis 会在这段空窗里回收整个 key。
     * 随后消费者在 XREADGROUP 上收到 NOGROUP，而写入方的下一条事件又会把 key 重建成没有 Consumer Group 的新流，
     * 消费侧将持续报错且再也读不到任何事件。
     * <p>
     * 这里刷新 TTL 而不是清除：清除虽然同样能覆盖空窗，但一旦本轮既没有事件写入、又没能走到终结逻辑
     * （例如进程被杀），key 就会永久驻留。刷新则在任何异常路径下都保留一个上界。
     */
    private void refreshActiveStreamTtl(String streamKey) {
        try {
            if (Boolean.TRUE.equals(redisTemplate.expire(streamKey, activeStreamTtlSeconds, TimeUnit.SECONDS))) {
                log.info("已刷新 Session Stream 过期时间，避免活跃会话被回收, stream: {}, ttlSeconds: {}",
                    streamKey, activeStreamTtlSeconds);
            }
        }
        catch (Exception e) {
            // 刷新失败不阻断监听启动：TTL 到期前的事件仍可正常消费，recovery 会接管其余部分。
            log.warn("刷新 Session Stream 过期时间失败, stream: {}", streamKey, e);
        }
    }

}
