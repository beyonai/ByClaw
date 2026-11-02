package com.iwhalecloud.byai.gateway.sandbox.recovery;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhaleai.byai.framework.common.Constants;
import com.iwhaleai.byai.framework.core.WorkerRegistry;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxLaunchRouting;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import java.util.*;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Service
public class SandboxRecoveryService {
    private static final Logger LOG = LoggerFactory.getLogger(SandboxRecoveryService.class);
    private final SandboxRecoveryStore store;
    private final WorkerRegistry workers;
    private final SandboxService sandboxes;
    private final SandboxUserContextRunner users;
    private final SsSandboxRecordMapper records;

    public SandboxRecoveryService(SandboxRecoveryStore store, WorkerRegistry workers, SandboxService sandboxes,
        SandboxUserContextRunner users, SsSandboxRecordMapper records) {
        this.store = store; this.workers = workers; this.sandboxes = sandboxes; this.users = users; this.records = records;
    }

    public record Selection(String stream, String group, String id) {}
    public record Action(String stream, String group, String id, String action, String reason) {}
    public record Page(List<Map<String, Object>> items, String nextCursor) {}

    public Page messages(String stream, String group, String state, String cursor) {
        var page = store.messages(stream, group, state, cursor);
        return new Page(page.items().stream().map(m -> view(stream, group, m)).toList(), page.nextCursor());
    }

    Map<String, Object> view(String stream, String group, SandboxRecoveryStore.Message message) {
        String kind = SandboxRecoveryStore.kind(stream);
        JSONObject payload = parse(message.fields());
        JSONObject command = object(payload, "command_payload");
        if (command.isEmpty()) command = payload;
        JSONObject header = object(command, "header");
        JSONObject metadata = object(header, "metadata");
        JSONObject body = object(command, "body");
        String target = first(payload.getString("target_agent_type"), header.getString("target_agent_type"));
        String user = first(payload.getString("user_code"), header.getString("user_code"));
        if (user == null && target != null && target.matches("BYCLAW_(DSH|EXE|CODE)_.+"))
            user = target.replaceFirst("^BYCLAW_(DSH|EXE|CODE)_", "");
        String session = first(payload.getString("session_id"), header.getString("session_id"));
        String commandId = first(payload.getString("message_id"), header.getString("message_id"));
        boolean validTarget = target != null && user != null && user.matches("[A-Za-z0-9_.@-]{1,100}")
            && List.of("BYCLAW_DSH_" + user, "BYCLAW_EXE_" + user, "BYCLAW_CODE_" + user).contains(target);
        boolean online = false;
        if (validTarget) {
            var status = workers.hasOnlineAgentType(target, true);
            online = status != null && status.exists;
        }
        boolean consumerOnline = "COMMAND".equals(kind) && store.workerOnline(message.consumer());
        Map<String, Object> execution = session == null || commandId == null ? null
            : workers.getExecutionByMessageId(session, commandId);
        String executionStatus = execution == null ? null : Objects.toString(execution.get("status"), null);
        boolean terminal = executionStatus != null && Set.of("completed", "failed", "cancelled", "canceled", "finished", "success", "already_finished")
            .contains(executionStatus.toLowerCase(Locale.ROOT));
        boolean pending = "PENDING".equals(message.state());
        boolean wakeup = "WAKEUP".equals(kind);
        boolean supportedCommand = "ASK_AGENT".equals(command.getString("action_type"));
        boolean supportedWakeup = Set.of("WAKE_AND_WAIT", "WAKE_AND_QUEUE").contains(
            Objects.toString(payload.getString("policy"), ""));
        boolean actionable = pending && validTarget && !message.fields().isEmpty() && message.idleMs() >= 60000
            && !consumerOnline && !online && (wakeup ? supportedWakeup : supportedCommand);
        // Worker-addressed messages are visible, but waking a new worker cannot reclaim their old queue.
        boolean sharedQueue = target != null && stream.equals(Constants.QueueNames.ctrlStream(target));
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("id", message.id()); view.put("kind", kind); view.put("state", message.state());
        view.put("userCode", user); view.put("userName", safe(header.getString("user_name"), 200));
        view.put("resourceId", first(metadata.getString("resourceId"), metadata.getString("agentId")));
        view.put("resourceName", safe(metadata.getString("resourceName"), 200));
        view.put("sessionId", session); view.put("commandId", commandId); view.put("targetAgentType", target);
        view.put("consumer", message.consumer()); view.put("workerOnline", online); view.put("consumerOnline", consumerOnline);
        view.put("executionStatus", executionStatus); view.put("deliveries", message.deliveries());
        view.put("idleMs", pending ? message.idleMs() : null);
        view.put("queuedAt", Long.parseLong(message.id().split("-")[0]));
        view.put("lastDeliveredAt", pending ? System.currentTimeMillis() - message.idleMs() : null);
        view.put("stoppedAt", null); // Redis PEL idle is not an OOM/death timestamp.
        view.put("content", safe(body.getString("content"), 12000));
        view.put("error", safe(first(payload.getString("error"), payload.getString("reason")), 2000));
        view.put("payloadMissing", message.fields().isEmpty());
        view.put("canWake", actionable && !terminal && (wakeup || sharedQueue));
        view.put("canDismiss", actionable && "COMMAND".equals(kind));
        view.put("canConfirmWake", pending && wakeup && validTarget && supportedWakeup && online
            && message.idleMs() >= 60000);
        view.put("actionHint", message.fields().isEmpty() ? "原消息已被裁剪，不能确定归属，禁止操作"
            : !pending ? "仅已领取的待确认消息支持处理；投递记录不代表仍待恢复"
            : online || consumerOnline ? "Worker 在线，可能正在执行或恢复；禁止重复处理"
            : message.idleMs() < 60000 ? "领取不足一分钟，请稍后刷新"
            : !validTarget ? "无法确定用户与沙箱目标，禁止操作"
            : terminal ? "执行记录已结束；可核对结果后移出待确认"
            : !wakeup && !sharedQueue ? "旧 Worker 专属队列不能由新 Worker 自动接回，请人工核对"
            : "可唤醒沙箱，等待原 Worker 恢复机制接回任务");
        view.put("lastOperation", store.audit(stream, group, message.id()));
        if (validTarget) {
            String owner = user;
            String sandboxPrefix = target.startsWith("BYCLAW_DSH_") ? "byclaw-dsh"
                : target.startsWith("BYCLAW_CODE_") ? "byclaw-code" : "openclaw";
            var matches = records.selectRunningByUser(owner);
            if (matches != null) matches.stream().filter(r -> r.getSandboxType() != null
                && r.getSandboxType().startsWith(sandboxPrefix)).findFirst().ifPresent(r -> {
                    view.put("sandboxId", r.getSandboxId()); view.put("sandboxStatus", r.getStatus());
                });
        }
        return view;
    }

    public Map<String, Object> act(Action request) {
        if (!Set.of("WAKE", "DISMISS", "CONFIRM_WAKE").contains(Objects.toString(request.action(), "")))
            throw new IllegalArgumentException("不支持的恢复操作");
        if (request.reason() == null || request.reason().isBlank() || request.reason().length() > 500)
            throw new IllegalArgumentException("请填写处理原因（1–500 字）");
        var before = store.pending(request.stream(), request.group(), request.id());
        var initial = view(request.stream(), request.group(), before);
        String identity = Objects.toString(initial.get("targetAgentType"), "unknown");
        String token = UUID.randomUUID().toString();
        if (!store.lock(identity, token)) throw new IllegalArgumentException("该沙箱已有管理员操作，请稍后刷新");
        String operator = CurrentUserHolder.getCurrentUserCode();
        Map<String, String> audit = new LinkedHashMap<>();
        audit.put("operator", operator); audit.put("action", request.action());
        audit.put("reason", safe(request.reason(), 500)); audit.put("time", Long.toString(System.currentTimeMillis()));
        audit.put("userCode", Objects.toString(initial.get("userCode"), ""));
        audit.put("sessionId", Objects.toString(initial.get("sessionId"), ""));
        audit.put("outcome", "STARTED");
        boolean recorded = false;
        try {
            var current = store.pending(request.stream(), request.group(), request.id());
            var info = view(request.stream(), request.group(), current);
            String permission = "WAKE".equals(request.action()) ? "canWake"
                : "CONFIRM_WAKE".equals(request.action()) ? "canConfirmWake" : "canDismiss";
            if (!Boolean.TRUE.equals(info.get(permission))) throw new IllegalArgumentException(
                Objects.toString(info.get("actionHint"), "当前消息不能执行此操作"));
            store.audit(request.stream(), request.group(), request.id(), audit);
            recorded = true;
            if (!"WAKE".equals(request.action())) {
                if (!store.acknowledge(request.stream(), request.group(), current))
                    throw new IllegalArgumentException("消息已被重新领取或处理，本次未清理，请刷新");
                audit.put("outcome", "CONFIRM_WAKE".equals(request.action()) ? "WAKE_CONFIRMED" : "DISMISSED");
                return Map.of("message", "已移出该消费组的待确认列表；原消息保留。此操作不等于取消任务，也不会修复旧会话页面。");
            }
            String user = (String) info.get("userCode");
            String target = (String) info.get("targetAgentType");
            Long resource = target.startsWith("BYCLAW_CODE_") ? SandboxLaunchRouting.DEFAULT_CODE_AGENT_RESOURCE_ID
                : SandboxLaunchRouting.DEFAULT_RESOURCE_ID;
            users.runAsUser(user, () -> sandboxes.restartSandboxForTargetWithoutWait(user, resource, target));
            // Keep the original message pending: neither sandbox creation nor an online worker proves completion.
            audit.put("outcome", "WAKE_REQUESTED");
            return Map.of("message", "已请求唤醒沙箱，原消息继续保留。请刷新确认 Worker 上线、任务接回和最终完成。");
        } catch (RuntimeException failure) {
            audit.put("outcome", "FAILED");
            // Exceptions can contain connection strings; keep the API and audit free of credentials.
            audit.put("error", failure instanceof IllegalArgumentException ? safe(failure.getMessage(), 500)
                : "操作失败，请通过服务日志排查（" + failure.getClass().getSimpleName() + "）");
            throw failure;
        } finally {
            if (recorded) {
                try { store.audit(request.stream(), request.group(), request.id(), audit); }
                catch (RuntimeException failure) { LOG.error("Recovery audit result write failed, id={}, action={}", request.id(), request.action()); }
                LOG.info("Sandbox recovery admin operation: operator={}, id={}, action={}, outcome={}",
                    operator, request.id(), request.action(), audit.get("outcome"));
            }
            try { store.unlock(identity, token); }
            catch (RuntimeException failure) { LOG.warn("Recovery lock release failed; lock will expire, id={}", request.id()); }
        }
    }

    static JSONObject parse(Map<String, String> fields) {
        try {
            for (String name : List.of("data", "payload", "message")) {
                if (fields.containsKey(name)) { JSONObject parsed = JSON.parseObject(fields.get(name)); return parsed == null ? new JSONObject() : parsed; }
            }
            JSONObject result = new JSONObject();
            fields.forEach((k, v) -> {
                try { result.put(k, v != null && v.startsWith("{") ? JSON.parseObject(v) : v); }
                catch (RuntimeException ignored) { result.put(k, v); }
            });
            return result;
        } catch (RuntimeException ignored) { return new JSONObject(); }
    }
    private static JSONObject object(JSONObject parent, String key) {
        Object value = parent == null ? null : parent.get(key);
        return value instanceof JSONObject obj ? obj : new JSONObject();
    }
    private static String first(String... values) {
        return Arrays.stream(values).filter(v -> v != null && !v.isBlank()).findFirst().orElse(null);
    }
    static String safe(String value, int limit) {
        if (value == null) return null;
        String redacted = value.replaceAll("eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+", "[已隐藏凭证]")
            .replaceAll("(?i)(bearer\\s+)[A-Za-z0-9._~+/-]+", "$1[已隐藏]")
            .replaceAll("(?i)((?:[\\w-]*(?:token|password|secret|api[_-]?key)|authorization)\\s*[\"']?\\s*[:=]\\s*[\"']?)[^\\s\"'&,}]+", "$1[已隐藏]");
        return redacted.length() > limit ? redacted.substring(0, limit) + "…（已截断）" : redacted;
    }
}
