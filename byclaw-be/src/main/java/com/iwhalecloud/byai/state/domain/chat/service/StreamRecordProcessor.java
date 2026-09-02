package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.connection.stream.MapRecord;
import org.springframework.stereotype.Service;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * 统一处理主 listener 与 pending recovery 取得的 Stream record。
 * <p>
 * terminal 事件在 ACK 前完成持久化；ACK 成功后才异步清理 session listener 和运行态，
 * 这样持久化失败时消息仍会留在 PEL 中等待恢复。
 */
@Slf4j
@Service
public class StreamRecordProcessor {

    private final ExecutorService cleanupExecutor = Executors.newSingleThreadExecutor(r -> {
        Thread thread = new Thread(r, "session-stream-cleanup");
        thread.setDaemon(true);
        return thread;
    });

    /** sessionId -> 处理锁。按 session 隔离，避免无关 session 因 hash 碰撞相互阻塞。 */
    private final Map<String, SessionLock> sessionLocks = new ConcurrentHashMap<>();

    @Autowired
    private SessionStreamEventRouter sessionStreamEventRouter;

    @Autowired
    private TerminalPersistMarkerService terminalPersistMarkerService;

    @Autowired
    private ScriptService scriptService;

    @Autowired
    private RunningChatSnapshotService runningChatSnapshotService;

    @Autowired
    private SessionStreamManager sessionStreamManager;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;

    public StreamDispatchResult process(MapRecord<?, ?, ?> record) {
        Timer.Sample timer = meterRegistry == null ? null : Timer.start(meterRegistry);
        try {
            return processInternal(record);
        }
        finally {
            if (timer != null) {
                timer.stop(Timer.builder("byclaw.session.stream.dispatch.duration")
                    .description("Session Stream dispatch duration")
                    .register(meterRegistry));
            }
        }
    }

    private StreamDispatchResult processInternal(MapRecord<?, ?, ?> record) {
        Object rawValue = record.getValue() == null ? null : record.getValue().get("data");
        if (rawValue == null) {
            log.warn("Redis Stream 消息 data 字段为空, stream: {}, messageId: {}", record.getStream(), record.getId());
            return StreamDispatchResult.INTENTIONALLY_IGNORED;
        }

        JSONObject dataJson;
        try {
            dataJson = JSON.parseObject(String.valueOf(rawValue));
        }
        catch (Exception e) {
            log.error("Redis Stream 消息 data 字段解析失败, stream: {}, messageId: {}, raw: {}",
                record.getStream(), record.getId(), rawValue, e);
            return StreamDispatchResult.INTENTIONALLY_IGNORED;
        }

        dataJson.put("stream_id", record.getId().getValue());
        String sessionId = dataJson.getString("session_id");
        if (sessionId == null || sessionId.isBlank()) {
            return sessionStreamEventRouter.dispatch(dataJson);
        }
        SessionLock lock = acquireSessionLock(sessionId);
        try {
            synchronized (lock) {
                StreamDispatchResult result = sessionStreamEventRouter.dispatch(dataJson);
                if (!result.isTerminal() || result.getContext() == null) {
                    return result;
                }
                ChatProcessContext ctx = result.getContext();

                // ACK 失败后重投的终止事件：落库已完成，跳过持久化直接进入 ACK 与收尾。
                if (result.isAlreadyPersisted()) {
                    return result;
                }

                if (!scriptService.persistAsyncGatewayContext(ctx)) {
                    log.warn("Redis Stream terminal 事件持久化失败，将保留 pending, stream: {}, messageId: {}",
                        record.getStream(), record.getId());
                    return StreamDispatchResult.ERROR;
                }
                // 标记必须在落库成功之后、ACK 之前写入：进程若在落库前崩溃，
                // 不能留下「已完成」的痕迹，否则重投会被误判并 ACK 掉。
                terminalPersistMarkerService.markPersisted(ctx.sessionId, record.getId().getValue());
                return result;
            }
        }
        finally {
            releaseSessionLock(sessionId, lock);
        }
    }

    /**
     * 按 sessionId 取得独占锁，保证同一 session 的事件串行处理，不同 session 互不阻塞。
     * <p>
     * 用引用计数管理生命周期：只有最后一个使用者离开时才从 map 移除，
     * 否则「先移除、后有新线程创建新锁」会让两个线程各持一把锁而同时进入临界区。
     */
    private SessionLock acquireSessionLock(String sessionId) {
        while (true) {
            SessionLock lock = sessionLocks.computeIfAbsent(sessionId, key -> new SessionLock());
            synchronized (lock.holders) {
                if (!lock.discarded) {
                    lock.holders[0]++;
                    return lock;
                }
            }
            // 该锁已被并发的 release 判定为可回收，重新取一把。
        }
    }

    private void releaseSessionLock(String sessionId, SessionLock lock) {
        synchronized (lock.holders) {
            if (--lock.holders[0] == 0) {
                lock.discarded = true;
                sessionLocks.remove(sessionId, lock);
            }
        }
    }

    /** 单个 session 的处理锁，holders 既是引用计数容器也是计数自身的同步对象。 */
    private static final class SessionLock {
        private final int[] holders = new int[1];
        private boolean discarded;
    }

    public void afterAcknowledge(StreamDispatchResult result) {
        if (result == null || !result.isTerminal() || result.getContext() == null) {
            return;
        }
        ChatProcessContext ctx = result.getContext();
        cleanupExecutor.execute(() -> {
            try {
                runningChatSnapshotService.delete(ctx);
                if (ctx.sessionId != null) {
                    String sessionId = String.valueOf(ctx.sessionId);
                    sessionStreamManager.stopSessionListener(sessionId);
                    sessionStreamManager.trimCompletedStream(sessionId);
                    // ACK 已成功且收尾完成，重投窗口关闭，标记不再需要。
                    terminalPersistMarkerService.clear(ctx.sessionId);
                }
            }
            catch (Exception e) {
                log.warn("Redis Stream terminal cleanup 失败, sessionId: {}, traceId: {}",
                    ctx.sessionId, ctx.traceId, e);
            }
        });
    }

    @PreDestroy
    public void shutdown() {
        cleanupExecutor.shutdownNow();
    }
}
