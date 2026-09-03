package com.iwhalecloud.byai.state.domain.chat.service;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

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

    /** PEL 分页 claim 的最大页数，防止异常情况下无限循环。100 页 × 100 条 = 1 万条上限。 */
    private static final int MAX_CLAIM_PAGES = 100;

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

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        recoveryExecutor.execute(this::scanAndRecoverSafely);
        recoveryExecutor.scheduleWithFixedDelay(this::scanAndRecoverSafely, RECOVERY_SCAN_INTERVAL_SECONDS,
            RECOVERY_SCAN_INTERVAL_SECONDS, TimeUnit.SECONDS);
    }

    @PreDestroy
    public void shutdown() {
        recoveryExecutor.shutdownNow();
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
            return;
        }
        long now = System.currentTimeMillis();
        String localInstanceId = chatRuntimeInstance.getInstanceId();
        for (ChatRuntimeState state : states) {
            // 本地调试实例只恢复由自身创建的会话，避免连接共享 Redis 时接管其他 BE 的会话。
            if (chatRuntimeInstance.isDevelopment() && !localInstanceId.equals(state.getOwnerInstanceId())) {
                log.debug("本地调试实例跳过其他 BE 的 Session Stream, sessionId: {}, ownerInstanceId: {}",
                    state.getSessionId(), state.getOwnerInstanceId());
                continue;
            }
            if (ChatRuntimeState.STATUS_HANDOFF_REQUESTED.equals(state.getStatus())) {
                recoverState(state, true);
                continue;
            }
            Long heartbeat = state.getLastHeartbeatAt() == null ? state.getStartedAt() : state.getLastHeartbeatAt();
            // 本机正在恢复消费的 session：周期补捞 pending，不做超时收尾，会话结束由 worker 终止事件驱动。
            if (localInstanceId.equals(state.getOwnerInstanceId()) && manageLocalRecoveryCtx(state)) {
                continue;
            }
            if (heartbeat != null && now - heartbeat < STALE_HEARTBEAT_MILLIS) {
                continue;
            }
            recoverState(state, false);
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
        boolean liveListenerActive = !ctx.recoveryOnly && sessionStreamManager.isSessionListenerActive(sessionId);
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
                claimPendingMessages(sessionId, PENDING_MIN_IDLE_MILLIS);
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
        // 登记项在此处清除，避免 claim 反复处理同一批消息；若这批消息仍未 ACK 成功，
        // 它们会留在 PEL 中，由后续常规 idle 扫描兜底。这些消息的业务处理已完成，
        // 只差 ACK，因此 minIdle 传 0，不必再等待 idle 阈值累积。
        failedIds.forEach(id -> streamAckFailureRegistry.clear(streamKey, id));
        claimAndProcess(streamKey, consumerName, ids, 0L);
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
        if (!sessionStreamManager.startSessionListener(sessionId, listenerOwner)) {
            outputStreamManager.removeContext(sessionId, ctx);
            if (owner != null) outputStreamManager.removeContext(sessionId, owner);
            log.info("跳过接管 Session Stream，listener lease 仍由其他实例持有, sessionId: {}", sessionId);
            return;
        }
        runningOutputStreamRegistry.markRunning(listenerOwner);
        // 处理 PEL 中已投递未 ACK 的消息（走共享 processor + 水位线去重）；processor 的 session lock
        // 串行化 claim 与 listener callback，避免同一 session 并发 dispatch。
        claimPendingMessages(sessionId, gracefulHandoff ? 0L : PENDING_MIN_IDLE_MILLIS);
        log.info("已接管 Session Stream, sessionId: {}, traceId: {}, gracefulHandoff: {}", sessionId,
            state.getTraceId(), gracefulHandoff);
    }

    /**
     * 接管并补处理 Redis Stream PEL 中长时间未 ACK 的消息。
     * <p>
     * 这些消息通常已投递给旧消费者，但旧消费者在确认前异常退出。恢复实例只 claim idle 达标的消息，
     * 避免抢走仍可能被正常消费者处理中的消息。
     */
    private void claimPendingMessages(String sessionId) {
        claimPendingMessages(sessionId, PENDING_MIN_IDLE_MILLIS);
    }

    private void claimPendingMessages(String sessionId, long minIdleMillis) {
        String streamKey = sessionStreamManager.buildStreamKey(sessionId);
        String consumerName = sessionStreamManager.buildConsumerName(sessionId);
        String cursor = null;
        int page = 0;
        // 分页扫描整个 PEL，直到不足一页（无更多 pending）。避免只 claim 首批 100 条而漏掉其余。
        while (page++ < MAX_CLAIM_PAGES) {
            PendingMessages pendingMessages;
            try {
                Range<String> range = cursor == null
                    ? Range.unbounded()
                    : Range.from(Range.Bound.exclusive(cursor)).to(Range.Bound.unbounded());
                pendingMessages = redisTemplate.opsForStream()
                    .pending(streamKey, SessionStreamManager.CONSUMER_GROUP, range, PENDING_CLAIM_BATCH_SIZE);
            }
            catch (Exception e) {
                log.warn("查询 pending Session Stream 消息失败, stream: {}", streamKey, e);
                return;
            }
            if (pendingMessages == null || pendingMessages.isEmpty()) {
                return;
            }
            List<RecordId> ids = new ArrayList<>();
            String lastId = cursor;
            for (PendingMessage pendingMessage : pendingMessages) {
                lastId = pendingMessage.getId().getValue();
                // idle 未满阈值的暂不 claim，留待 recovery owner 活跃期下一轮周期 claim 补捞。
                if (pendingMessage.getElapsedTimeSinceLastDelivery().toMillis() >= minIdleMillis) {
                    ids.add(pendingMessage.getId());
                }
            }
            if (!ids.isEmpty()) {
                claimAndProcess(streamKey, consumerName, ids, minIdleMillis);
            }
            if (pendingMessages.size() < PENDING_CLAIM_BATCH_SIZE) {
                return;
            }
            cursor = lastId;
        }
        log.warn("claim pending 达到最大分页数 {}, 提前结束, stream: {}", MAX_CLAIM_PAGES, streamKey);
    }

    /**
     * @param minIdleMillis claim 的最小空闲时间。常规兜底扫描使用 {@link #PENDING_MIN_IDLE_MILLIS}
     *                      以免抢走正在处理中的消息；已知 ACK 失败或旧 Pod 已完成优雅交接时传 0，
     *                      不需要再等待 idle 累积。
     */
    private void claimAndProcess(String streamKey, String consumerName, List<RecordId> ids, long minIdleMillis) {
        List<MapRecord<String, Object, Object>> claimed = redisTemplate.opsForStream()
            .claim(streamKey, SessionStreamManager.CONSUMER_GROUP, consumerName,
                RedisStreamCommands.XClaimOptions.minIdle(Duration.ofMillis(minIdleMillis)).ids(ids));
        if (claimed == null) {
            return;
        }
        for (MapRecord<String, Object, Object> record : claimed) {
            processClaimedRecord(record);
        }
    }

    private void processClaimedRecord(MapRecord<String, Object, Object> record) {
        StreamDispatchResult result = streamRecordProcessor.process(record);
        if (result.shouldAcknowledge()) {
            if (acknowledge(record)) {
                streamRecordProcessor.afterAcknowledge(result);
            }
        }
    }

    private boolean acknowledge(MapRecord<String, Object, Object> record) {
        try {
            redisTemplate.opsForStream().acknowledge(record.getStream(), SessionStreamManager.CONSUMER_GROUP,
                record.getId());
            return true;
        }
        catch (Exception e) {
            log.warn("ack claimed Session Stream 消息失败, stream: {}, messageId: {}", record.getStream(),
                record.getId(), e);
            return false;
        }
    }
}
