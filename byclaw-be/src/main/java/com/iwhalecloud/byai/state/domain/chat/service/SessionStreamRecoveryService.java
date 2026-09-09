package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.data.domain.Range;
import org.springframework.data.redis.connection.RedisStreamCommands;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.data.redis.connection.stream.PendingMessage;
import org.springframework.data.redis.connection.stream.PendingMessages;
import org.springframework.data.redis.connection.stream.RecordId;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.state.domain.chat.dto.ChatRuntimeState;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Service
public class SessionStreamRecoveryService implements ApplicationListener<ApplicationReadyEvent> {

    private static final long RECOVERY_SCAN_INTERVAL_SECONDS = 30L;

    private static final long STALE_HEARTBEAT_MILLIS = 180_000L;

    private static final long PENDING_MIN_IDLE_MILLIS = 180_000L;

    private static final int PENDING_CLAIM_BATCH_SIZE = 100;

    private static final int RECOVERY_WORKERS = 4;

    private static final int MAX_QUEUED_RECOVERY_SESSIONS = 100;

    @Autowired
    private ChatRuntimeStateService chatRuntimeStateService;

    @Autowired
    private ChatContextRecoveryService chatContextRecoveryService;

    @Autowired
    private SessionStreamManager sessionStreamManager;

    @Autowired
    private RedisTemplate<String, Object> redisTemplate;

    @Autowired
    private StreamRecordProcessor streamRecordProcessor;

    @Autowired
    private RunningOutputStreamRegistry runningOutputStreamRegistry;

    @Autowired
    private OutputStreamManager outputStreamManager;

    @Autowired
    private ChatRuntimeInstance chatRuntimeInstance;

    @Autowired
    private StreamAckFailureRegistry streamAckFailureRegistry;

    private final ScheduledExecutorService recoveryExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread thread = new Thread(r, "session-stream-recovery");
        thread.setDaemon(true);
        return thread;
    });

    private final ExecutorService recoveryWorkers = new ThreadPoolExecutor(RECOVERY_WORKERS, RECOVERY_WORKERS,
        0L, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(MAX_QUEUED_RECOVERY_SESSIONS), runnable -> {
            Thread thread = new Thread(runnable, "session-stream-recovery-worker");
            thread.setDaemon(true);
            return thread;
        }, new ThreadPoolExecutor.AbortPolicy());

    private final Set<Long> recoveringSessions = ConcurrentHashMap.newKeySet();

    private final Map<String, String> pendingScanCursors = new ConcurrentHashMap<>();

    private final Map<String, Long> pausedClaimMinIdleMillis = new ConcurrentHashMap<>();

    private final Set<Long> scheduledPausedRecovery = ConcurrentHashMap.newKeySet();

    private final AtomicInteger recoveryScanOffset = new AtomicInteger();

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        recoveryExecutor.execute(this::scanAndRecoverSafely);
        recoveryExecutor.scheduleWithFixedDelay(this::scanAndRecoverSafely, RECOVERY_SCAN_INTERVAL_SECONDS,
            RECOVERY_SCAN_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        recoveryExecutor.shutdownNow();
        recoveryWorkers.shutdownNow();
    }

    private void scanAndRecoverSafely() {
        try {
            scanAndRecover();
        }
        catch (Exception e) {
            log.warn("扫描恢复 Session Stream 失败", e);
        }
    }

    private void scanAndRecover() {
        List<ChatRuntimeState> states = chatRuntimeStateService.listRunningStates();
        if (CollectionUtils.isEmpty(states)) {
            pendingScanCursors.keySet().removeIf(sessionId ->
                !recoveringSessions.contains(Long.valueOf(sessionId)));
            return;
        }
        Map<Long, ChatRuntimeState> candidatesBySession = new LinkedHashMap<>();
        for (ChatRuntimeState state : states) {
            if (state == null || state.getSessionId() == null) {
                continue;
            }
            candidatesBySession.merge(state.getSessionId(), state, this::preferHandoff);
        }
        Set<String> activeSessionIds = candidatesBySession.keySet().stream().map(String::valueOf)
            .collect(java.util.stream.Collectors.toSet());
        pendingScanCursors.keySet().removeIf(sessionId -> !activeSessionIds.contains(sessionId)
            && !recoveringSessions.contains(Long.valueOf(sessionId)));
        List<ChatRuntimeState> candidates = new ArrayList<>(candidatesBySession.values());
        int size = candidates.size();
        if (size == 0) {
            return;
        }
        int start = Math.floorMod(recoveryScanOffset.getAndAdd(MAX_QUEUED_RECOVERY_SESSIONS), size);
        long now = System.currentTimeMillis();
        String localInstanceId = chatRuntimeInstance.getInstanceId();
        for (int i = 0; i < size; i++) {
            ChatRuntimeState state = candidates.get((start + i) % size);
            // 本地调试实例只恢复由自身创建的会话，避免连接共享 Redis 时接管其他 BE 的会话。
            if (chatRuntimeInstance.isDevelopment() && !localInstanceId.equals(state.getOwnerInstanceId())) {
                log.debug("本地调试实例跳过其他 BE 的 Session Stream, sessionId: {}, ownerInstanceId: {}",
                    state.getSessionId(), state.getOwnerInstanceId());
                continue;
            }
            if (!needsRecoveryPass(state, now, localInstanceId) || !recoveringSessions.add(state.getSessionId())) {
                continue;
            }
            try {
                recoveryWorkers.execute(() -> recoverSessionSafely(state, localInstanceId));
            }
            catch (RejectedExecutionException e) {
                recoveringSessions.remove(state.getSessionId());
                // The bounded queue is full. Rotate the next pass so later sessions are not starved.
                break;
            }
        }
    }

    private ChatRuntimeState preferHandoff(ChatRuntimeState current, ChatRuntimeState candidate) {
        return ChatRuntimeState.STATUS_HANDOFF_REQUESTED.equals(candidate.getStatus()) ? candidate : current;
    }

    private boolean needsRecoveryPass(ChatRuntimeState state, long now, String localInstanceId) {
        if (ChatRuntimeState.STATUS_HANDOFF_REQUESTED.equals(state.getStatus())
                || localInstanceId.equals(state.getOwnerInstanceId())) {
            return true;
        }
        Long heartbeat = state.getLastHeartbeatAt() == null ? state.getStartedAt() : state.getLastHeartbeatAt();
        return heartbeat == null || now - heartbeat >= STALE_HEARTBEAT_MILLIS;
    }

    private void recoverSessionSafely(ChatRuntimeState state, String localInstanceId) {
        try {
            if (sessionStreamManager.isSessionListenerPaused(String.valueOf(state.getSessionId()))) {
                manageLocalRecoveryCtx(state);
                return;
            }
            if (ChatRuntimeState.STATUS_HANDOFF_REQUESTED.equals(state.getStatus())) {
                recoverState(state, true);
                return;
            }
            // 本机正在恢复消费的 session：周期补捞 pending，不做超时收尾，会话结束由 worker 终止事件驱动。
            if (localInstanceId.equals(state.getOwnerInstanceId()) && manageLocalRecoveryCtx(state)) {
                return;
            }
            Long heartbeat = state.getLastHeartbeatAt() == null ? state.getStartedAt() : state.getLastHeartbeatAt();
            if (heartbeat != null && System.currentTimeMillis() - heartbeat < STALE_HEARTBEAT_MILLIS) {
                return;
            }
            recoverState(state, false);
        }
        catch (Exception e) {
            log.warn("恢复 Session Stream 失败, sessionId: {}", state.getSessionId(), e);
        }
        finally {
            recoveringSessions.remove(state.getSessionId());
            schedulePausedRecovery(state);
        }
    }

    /** Yield between PEL pages, then rejoin the same bounded worker queue instead of waiting for a full scan. */
    private void schedulePausedRecovery(ChatRuntimeState state) {
        Long sessionId = state.getSessionId();
        if (recoveryExecutor.isShutdown() || !sessionStreamManager.isSessionListenerPaused(String.valueOf(sessionId))) {
            pausedClaimMinIdleMillis.remove(String.valueOf(sessionId));
            return;
        }
        if (!scheduledPausedRecovery.add(sessionId)) return;
        try {
            recoveryExecutor.schedule(() -> {
                scheduledPausedRecovery.remove(sessionId);
                if (!sessionStreamManager.isSessionListenerPaused(String.valueOf(sessionId))) {
                    pausedClaimMinIdleMillis.remove(String.valueOf(sessionId));
                    return;
                }
                if (!recoveringSessions.add(sessionId)) {
                    schedulePausedRecovery(state);
                    return;
                }
                try {
                    recoveryWorkers.execute(() -> {
                        try {
                            manageLocalRecoveryCtx(state);
                        }
                        catch (Exception error) {
                            log.warn("继续恢复 Session Stream pending 失败, sessionId: {}", sessionId, error);
                        }
                        finally {
                            recoveringSessions.remove(sessionId);
                            schedulePausedRecovery(state);
                        }
                    });
                }
                catch (RejectedExecutionException error) {
                    recoveringSessions.remove(sessionId);
                    schedulePausedRecovery(state);
                }
            }, 1, TimeUnit.SECONDS);
        }
        catch (RejectedExecutionException error) {
            scheduledPausedRecovery.remove(sessionId);
        }
    }

    /**
     * 本机已接管、正在恢复消费的 session：周期性 claim PEL，补捞接管瞬间 idle 未满、
     * 或超过单批上限的遗留 pending。会话何时结束由 worker 推送的终止事件驱动，此处不做超时判断，
     * 以免把仍在进行的慢工具 / 慢模型回答误判为停止而提前截断落库。
     *
     * @return true 表示本机已持有该 recovery ctx 并已补捞，调用方不应再走 stale 抢占逻辑。
     */
    private boolean manageLocalRecoveryCtx(ChatRuntimeState state) {
        String sessionId = String.valueOf(state.getSessionId());
        ChatProcessContext ctx = outputStreamManager.getContext(sessionId);
        if (ctx == null) {
            return false;
        }
        String streamKey = sessionStreamManager.buildStreamKey(sessionId);
        boolean paused = sessionStreamManager.isSessionListenerPaused(sessionId);
        // Once the recovery barrier opens, even a recoveryOnly context has a live batching listener.
        boolean liveListenerActive = !paused && sessionStreamManager.isSessionListenerActive(sessionId);
        if (liveListenerActive && !streamAckFailureRegistry.hasFailures(streamKey)) {
            // 活跃 live listener 自身的 ACK retry 尚未耗尽，避免 recovery 线程与其并发 claim 同一条消息。
            return true;
        }
        try {
            if (liveListenerActive) {
                // ACK 重试已耗尽：listener 的心跳会一直续租，靠 stale 判定永远等不到接管，
                // 只对明确失败的消息做定向 claim，不影响该 listener 正在处理的其他消息。
                claimAckFailedMessages(sessionId, streamKey);
            }
            else {
                boolean drained = claimPendingMessages(sessionId,
                    pausedClaimMinIdleMillis.getOrDefault(sessionId, PENDING_MIN_IDLE_MILLIS));
                if (paused && drained) {
                    sessionStreamManager.resumeRecoveredSessionListener(sessionId);
                    pausedClaimMinIdleMillis.remove(sessionId);
                }
            }
        }
        catch (Exception e) {
            log.warn("周期 claim pending 失败, sessionId: {}", sessionId, e);
        }
        return true;
    }

    /**
     * 对活跃 live listener 上 ACK 重试耗尽的消息执行定向 claim。
     * <p>
     * 这些消息已经完成业务处理，只是 ACK 未成功，重投后会被 Stream ID 幂等逻辑识别；
     * 此处依赖 {@link StreamRecordProcessor} 的 session 锁与 listener callback 串行化。
     */
    private void claimAckFailedMessages(String sessionId, String streamKey) {
        Set<String> failedIds = streamAckFailureRegistry.snapshot(streamKey);
        if (failedIds.isEmpty()) {
            return;
        }
        String consumerName = sessionStreamManager.buildConsumerName(sessionId);
        List<RecordId> ids = failedIds.stream().map(RecordId::of).toList();
        log.info("对 ACK 失败消息执行定向 claim, sessionId: {}, count: {}", sessionId, ids.size());
        // 先取走本批登记项；claim 或 ACK 再次失败时重新登记，供下一轮定向恢复重试。
        // 这些消息的业务处理已完成，只差 ACK，因此 minIdle 传 0，无需等待 idle 阈值。
        failedIds.forEach(id -> streamAckFailureRegistry.clear(streamKey, id));
        try {
            if (!claimAndProcess(streamKey, consumerName, ids, 0L, false)) {
                failedIds.forEach(id -> streamAckFailureRegistry.record(streamKey, id));
            }
        }
        catch (RuntimeException error) {
            failedIds.forEach(id -> streamAckFailureRegistry.record(streamKey, id));
            throw error;
        }
    }

    private void recoverState(ChatRuntimeState state, boolean gracefulHandoff) {
        if (state == null || state.getSessionId() == null || !chatRuntimeStateService.tryAcquireRecoveryLock(state.getSessionId())) {
            return;
        }
        // Recover the original owner first even when the scan encountered a foreground trace first.
        ChatRuntimeState primary = chatRuntimeStateService.get(state.getSessionId());
        ChatProcessContext owner = primary == null ? null : chatContextRecoveryService.recover(primary);
        ChatProcessContext ctx = chatContextRecoveryService.recover(state);
        if (ctx == null) {
            log.warn("恢复 Session Stream 上下文失败, sessionId: {}, traceId: {}", state.getSessionId(), state.getTraceId());
            return;
        }
        String sessionId = String.valueOf(state.getSessionId());
        if (sessionStreamManager.isSessionListenerActive(sessionId)) return;
        ChatProcessContext listenerOwner = owner == null ? ctx : owner;
        boolean started;
        try {
            started = sessionStreamManager.startSessionListenerForRecovery(sessionId, listenerOwner);
        }
        catch (RuntimeException | Error error) {
            outputStreamManager.removeContext(sessionId, ctx);
            if (owner != null && owner != ctx) outputStreamManager.removeContext(sessionId, owner);
            throw error;
        }
        if (!started) {
            outputStreamManager.removeContext(sessionId, ctx);
            if (owner != null) outputStreamManager.removeContext(sessionId, owner);
            log.info("跳过接管 Session Stream，listener lease 仍由其他实例持有, sessionId: {}", sessionId);
            return;
        }
        if (!sessionStreamManager.isSessionListenerPaused(sessionId)) return;
        long minIdleMillis = gracefulHandoff ? 0L : PENDING_MIN_IDLE_MILLIS;
        pausedClaimMinIdleMillis.put(sessionId, minIdleMillis);
        try {
            runningOutputStreamRegistry.markRunning(listenerOwner);
        }
        catch (RuntimeException | Error error) {
            pausedClaimMinIdleMillis.remove(sessionId);
            try {
                sessionStreamManager.stopSessionListener(sessionId);
            }
            catch (RuntimeException | Error cleanupError) {
                error.addSuppressed(cleanupError);
            }
            throw error;
        }
        if (claimPendingMessages(sessionId, minIdleMillis)) {
            sessionStreamManager.resumeRecoveredSessionListener(sessionId);
            pausedClaimMinIdleMillis.remove(sessionId);
        }
        schedulePausedRecovery(state);
        log.info("已接管 Session Stream, sessionId: {}, traceId: {}, gracefulHandoff: {}", sessionId,
            state.getTraceId(), gracefulHandoff);
    }

    /**
     * 接管并补处理 Redis Stream PEL 中长时间未 ACK 的消息。
     * <p>
     * 这些消息通常已投递给旧消费者，但旧消费者在确认前异常退出。恢复实例只 claim idle 达标的消息，
     * 避免抢走仍可能被正常消费者处理中的消息。
     */
    private boolean claimPendingMessages(String sessionId) {
        return claimPendingMessages(sessionId, PENDING_MIN_IDLE_MILLIS);
    }

    private boolean claimPendingMessages(String sessionId, long minIdleMillis) {
        String streamKey = sessionStreamManager.buildStreamKey(sessionId);
        String consumerName = sessionStreamManager.buildConsumerName(sessionId);
        String cursor = pendingScanCursors.get(sessionId);
        Range<String> range = cursor == null
            ? Range.unbounded()
            : Range.from(Range.Bound.exclusive(cursor)).to(Range.Bound.unbounded());
        PendingMessages pendingMessages;
        try {
            pendingMessages = redisTemplate.opsForStream().pending(streamKey, SessionStreamManager.CONSUMER_GROUP,
                range, PENDING_CLAIM_BATCH_SIZE);
        }
        catch (Exception e) {
            log.warn("查询 pending Session Stream 消息失败, stream: {}", streamKey, e);
            return false;
        }
        if (pendingMessages == null || pendingMessages.isEmpty()) {
            pendingScanCursors.remove(sessionId);
            return true;
        }
        List<RecordId> ids = new ArrayList<>();
        String lastId = cursor;
        boolean partialPage = false;
        long claimMinIdleMillis = minIdleMillis;
        for (PendingMessage pendingMessage : pendingMessages) {
            long requiredIdle = consumerName.equals(pendingMessage.getConsumerName()) ? 0L : minIdleMillis;
            if (!ids.isEmpty() && requiredIdle != claimMinIdleMillis) {
                // Each ordered prefix uses one claim idle threshold; the next fair pass handles the suffix.
                partialPage = true;
                break;
            }
            claimMinIdleMillis = requiredIdle;
            // A newer eligible record must not overtake an older record still owned by a recent delivery.
            if (pendingMessage.getElapsedTimeSinceLastDelivery().toMillis() < requiredIdle) {
                partialPage = true;
                break;
            }
            lastId = pendingMessage.getId().getValue();
            ids.add(pendingMessage.getId());
        }
        if (!ids.isEmpty() && !claimAndProcess(streamKey, consumerName, ids, claimMinIdleMillis, true)) {
            // Keep the cursor before the failed page. Successfully ACKed prefix records disappear naturally.
            return false;
        }
        if (!partialPage && pendingMessages.size() < PENDING_CLAIM_BATCH_SIZE) {
            pendingScanCursors.remove(sessionId);
            return true;
        }
        if (lastId != null) {
            pendingScanCursors.put(sessionId, lastId);
        }
        return false;
    }

    /**
     * @param minIdleMillis claim 的最小空闲时间。常规兜底扫描使用 {@link #PENDING_MIN_IDLE_MILLIS}
     *                      以免抢走正在处理中的消息；已知 ACK 失败或旧 Pod 已完成优雅交接时传 0，
     *                      不需要再等待 idle 累积。
     */
    private boolean claimAndProcess(String streamKey, String consumerName, List<RecordId> ids, long minIdleMillis,
            boolean requireOrderedCheckpoint) {
        List<MapRecord<String, Object, Object>> claimed = redisTemplate.opsForStream()
            .claim(streamKey, SessionStreamManager.CONSUMER_GROUP, consumerName,
                RedisStreamCommands.XClaimOptions.minIdle(Duration.ofMillis(minIdleMillis)).ids(ids));
        if (claimed == null) {
            return false;
        }
        Map<String, MapRecord<String, Object, Object>> claimedById = new LinkedHashMap<>();
        for (MapRecord<String, Object, Object> record : claimed) claimedById.put(record.getId().getValue(), record);
        for (RecordId requested : ids) {
            MapRecord<String, Object, Object> record = claimedById.get(requested.getValue());
            // A concurrent claim can change eligibility. Recheck PEL next pass before advancing past a missing ID.
            if (record == null) {
                if (requireOrderedCheckpoint) return false;
                continue;
            }
            if (!processClaimedRecord(record)) return false;
        }
        return true;
    }

    private boolean processClaimedRecord(MapRecord<String, Object, Object> record) {
        StreamDispatchResult result = streamRecordProcessor.process(record);
        if (result.shouldAcknowledge()) {
            if (acknowledge(record)) {
                streamRecordProcessor.afterAcknowledge(result);
            }
            return true;
        }
        return false;
    }

    private boolean acknowledge(MapRecord<String, Object, Object> record) {
        try {
            redisTemplate.opsForStream().acknowledge(record.getStream(), SessionStreamManager.CONSUMER_GROUP,
                record.getId());
            streamAckFailureRegistry.clear(record.getStream(), record.getId().getValue());
            return true;
        }
        catch (Exception e) {
            // Business processing already succeeded; a resumed listener uses this targeted ACK-only recovery path.
            streamAckFailureRegistry.record(record.getStream(), record.getId().getValue());
            log.warn("ack claimed Session Stream 消息失败, stream: {}, messageId: {}", record.getStream(),
                record.getId(), e);
            return false;
        }
    }
}
