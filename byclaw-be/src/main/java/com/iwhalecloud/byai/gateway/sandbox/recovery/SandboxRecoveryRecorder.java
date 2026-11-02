package com.iwhalecloud.byai.gateway.sandbox.recovery;

import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import java.util.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Observations only: never claims or acknowledges a business task. */
@Component
public class SandboxRecoveryRecorder {
    private static final Logger LOG = LoggerFactory.getLogger(SandboxRecoveryRecorder.class);
    private final SandboxRecoveryStore store;
    private final WorkerRegistry workers;
    public SandboxRecoveryRecorder(SandboxRecoveryStore store, WorkerRegistry workers) {
        this.store = store; this.workers = workers;
    }

    public void lifecycle(SsSandboxRecord record, String outcome, String newSandboxId) {
        try {
            Map<String, String> event = new LinkedHashMap<>();
            event.put("operator", "system"); event.put("action", "AUTO_REBUILD");
            event.put("userCode", record.getUserCode());
            event.put("oldSandboxId", Objects.toString(record.getSandboxId(), ""));
            event.put("newSandboxId", Objects.toString(newSandboxId, ""));
            event.put("resourceId", Objects.toString(record.getResourceId(), ""));
            event.put("sandboxType", Objects.toString(record.getSandboxType(), ""));
            event.put("reason", "远端沙箱不存在或不可复用；准确停止时间及 OOM 原因需查容器/内核日志");
            emit(event, outcome);
            if ("DETECTED".equals(outcome) && record.getSandboxType() != null
                && record.getSandboxType().startsWith("byclaw-dsh")) snapshot(record, event);
        } catch (RuntimeException failure) {
            LOG.warn("记录自动恢复历史失败，不中断沙箱恢复", failure);
        }
    }

    private void snapshot(SsSandboxRecord record, Map<String, String> base) {
        String stream = Constants.QueueNames.ctrlStream("BYCLAW_DSH_" + record.getUserCode());
        for (var queue : store.queuesForStream(stream)) {
            String cursor = null;
            int pages = 0;
            do {
                var page = store.messages(stream, queue.group(), "PENDING", cursor);
                for (var message : page.items()) {
                    JSONObject payload = SandboxRecoveryService.parse(message.fields());
                    if (payload == null) continue;
                    JSONObject command = payload.getJSONObject("command_payload");
                    if (command == null) command = payload;
                    JSONObject header = command.getJSONObject("header");
                    if (header == null) header = payload;
                    String session = header.getString("session_id");
                    if (session == null) session = payload.getString("session_id");
                    String commandId = header.getString("message_id");
                    if (commandId == null) commandId = payload.getString("message_id");
                    if (session == null || commandId == null) continue;
                    Map<String, String> event = new LinkedHashMap<>(base);
                    event.put("stream", stream); event.put("group", queue.group());
                    event.put("messageId", message.id()); event.put("sessionId", session);
                    event.put("commandId", commandId); event.put("oldConsumer", Objects.toString(message.consumer(), ""));
                    event.put("startedAt", Long.toString(System.currentTimeMillis()));
                    event.put("action", "AUTO_TASK"); event.put("outcome", "AWAITING_RECLAIM");
                    JSONObject metadata = header.getJSONObject("metadata");
                    if (metadata != null) {
                        event.put("resourceName", Objects.toString(SandboxRecoveryService.safe(metadata.getString("resourceName"), 200), ""));
                    }
                    JSONObject body = command.getJSONObject("body");
                    if (body != null) event.put("content", Objects.toString(SandboxRecoveryService.safe(body.getString("content"), 2000), ""));
                    if (metadata != null) event.put("employeeId", Objects.toString(metadata.getString("resourceId"), ""));
                    String key = UUID.nameUUIDFromBytes((base.get("oldSandboxId") + stream + queue.group() + message.id())
                        .getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
                    store.trackRecovery(key, event);
                    emit(event, "AWAITING_RECLAIM");
                }
                cursor = page.nextCursor();
            } while (cursor != null && ++pages < 10);
            if (cursor != null) LOG.warn("自动恢复快照超过 500 条，未完整记录，stream={}", stream);
        }
    }

    @Scheduled(fixedDelay = 15000)
    public void observe() {
        String token = UUID.randomUUID().toString();
        try {
            if (!store.lock("history-observer", token)) return;
            try {
                for (var tracked : store.trackedRecoveries().entrySet()) {
                    try { observe(tracked.getKey(), tracked.getValue()); }
                    catch (RuntimeException failure) { LOG.warn("检查自动恢复任务状态失败，tracking={}", tracked.getKey(), failure); }
                }
            } finally { store.unlock("history-observer", token); }
        } catch (RuntimeException failure) { LOG.warn("自动恢复历史观察暂不可用", failure); }
    }

    private void observe(String key, Map<String, String> event) {
        Map<String, Object> execution = workers.getExecutionByMessageId(event.get("sessionId"), event.get("commandId"));
        String status = execution == null ? "" : Objects.toString(execution.get("status"), "").toLowerCase(Locale.ROOT);
        if (Set.of("completed", "success", "already_finished", "finished", "failed", "cancelled", "canceled").contains(status)) {
            event.put("executionStatus", status);
            emit(event, Set.of("failed", "cancelled", "canceled").contains(status) ? "TASK_FAILED" : "TASK_FINISHED");
            store.stopTracking(key); return;
        }
        try {
            var current = store.pending(event.get("stream"), event.get("group"), event.get("messageId"));
            if (!Objects.equals(current.consumer(), event.get("oldConsumer")) && !"RECLAIMED".equals(event.get("outcome"))) {
                event.put("consumer", Objects.toString(current.consumer(), ""));
                emit(event, "RECLAIMED"); store.trackRecovery(key, event);
            }
        } catch (IllegalArgumentException missing) {
            emit(event, "RESULT_UNKNOWN"); store.stopTracking(key); return;
        }
        if (System.currentTimeMillis() - Long.parseLong(event.get("startedAt")) > 3600000) {
            emit(event, "RESULT_UNKNOWN"); store.stopTracking(key);
        }
    }

    private void emit(Map<String, String> event, String outcome) {
        event.put("outcome", outcome); event.put("time", Long.toString(System.currentTimeMillis()));
        store.audit(event.getOrDefault("stream", "lifecycle"), event.getOrDefault("group", ""),
            event.getOrDefault("messageId", event.get("oldSandboxId")), event);
    }
}
