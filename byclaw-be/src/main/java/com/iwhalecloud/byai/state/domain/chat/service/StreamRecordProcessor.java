package com.iwhalecloud.byai.state.domain.chat.service;

import java.util.Map;
import java.util.List;
import java.util.ArrayList;
import java.util.Objects;
import java.util.concurrent.locks.ReentrantLock;
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

    /** Coalesce adjacent child deltas without crossing session/run boundaries or reordering other events. */
    public List<StreamDispatchResult> processBatch(List<MapRecord<String, String, String>> records) {
        List<StreamDispatchResult> results = new ArrayList<>(records.size());
        int index = 0;
        while (index < records.size()) {
            JSONObject first = childEvent(records.get(index));
            if (first == null) {
                StreamDispatchResult result;
                try { result = process(records.get(index)); }
                catch (Exception e) {
                    log.warn("处理 Stream 批次消息失败，保留失败后缀等待重试, messageId: {}", records.get(index).getId(), e);
                    result = StreamDispatchResult.ERROR;
                }
                index++;
                results.add(result);
                if (!result.shouldAcknowledge()) {
                    while (results.size() < records.size()) results.add(StreamDispatchResult.ERROR);
                    return results;
                }
                continue;
            }
            List<JSONObject> events = new ArrayList<>();
            events.add(first);
            int end = index + 1;
            while (end < records.size()) {
                JSONObject next = childEvent(records.get(end));
                if (next == null || !sameChildRun(first, next)) break;
                events.add(next);
                end++;
            }
            String sessionId = first.getString("session_id");
            SessionLock lock = acquireSessionLock(sessionId);
            lock.processing.lock();
            try {
                StreamDispatchResult result;
                try { result = sessionStreamEventRouter.dispatchChildBatch(Long.valueOf(sessionId), events); }
                catch (Exception e) {
                    log.warn("处理子会话批次失败, sessionId: {}", sessionId, e);
                    result = StreamDispatchResult.ERROR;
                }
                for (int i = index; i < end; i++) results.add(result);
                if (!result.shouldAcknowledge()) {
                    while (results.size() < records.size()) results.add(StreamDispatchResult.ERROR);
                    return results;
                }
            }
            finally {
                lock.processing.unlock();
                releaseSessionLock(sessionId, lock);
            }
            index = end;
        }
        return results;
    }

    private JSONObject childEvent(MapRecord<String, String, String> record) {
        try {
            JSONObject event = JSON.parseObject(record.getValue().get("data"));
            JSONObject metadata = event == null ? null : event.getJSONObject("metadata");
            if (metadata == null || !"child".equals(metadata.getString("session_scope"))
                    || event.getLong("session_id") == null) return null;
            event.put("stream_id", record.getId().getValue());
            return event;
        }
        catch (Exception e) { return null; }
    }

    private boolean sameChildRun(JSONObject first, JSONObject next) {
        if (!Objects.equals(first.getString("session_id"), next.getString("session_id"))) return false;
        JSONObject left = first.getJSONObject("metadata");
        JSONObject right = next.getJSONObject("metadata");
        for (String field : List.of("external_session_id", "external_root_session_id", "event_source",
                "child_run_id", "child_turn")) {
            if (!Objects.equals(left.getString(field), right.getString(field))) return false;
        }
        return true;
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

        if (dataJson == null) return StreamDispatchResult.INTENTIONALLY_IGNORED;
        dataJson.put("stream_id", record.getId().getValue());
        String sessionId = dataJson.getString("session_id");
        if (sessionId == null || sessionId.isBlank()) {
            return sessionStreamEventRouter.dispatch(dataJson);
        }
        SessionLock lock = acquireSessionLock(sessionId);
        lock.processing.lock();
        try {
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
        finally {
            lock.processing.unlock();
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
        private final ReentrantLock processing = new ReentrantLock();
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
                    if (sessionStreamManager.completeSessionTurn(ctx)) {
                        sessionStreamManager.trimCompletedStream(sessionId);
                        // All traces have settled; no other terminal ACK can still need these markers.
                        terminalPersistMarkerService.clear(ctx.sessionId);
                    }
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
