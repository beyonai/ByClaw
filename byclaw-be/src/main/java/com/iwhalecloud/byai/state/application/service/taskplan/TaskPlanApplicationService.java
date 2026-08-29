package com.iwhalecloud.byai.state.application.service.taskplan;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

import org.apache.commons.lang3.StringUtils;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskPlan;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskPlanMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;
import com.iwhalecloud.byai.state.domain.taskplan.exception.TaskPlanCommandException;

/** Agent 任务计划的单表权威写入、查询和取消服务。 */
@Service
public class TaskPlanApplicationService {

    private static final Set<String> TERMINAL_TASK_STATUSES = Set.of(
        "COMPLETED", "FAILED", "SKIPPED", "CANCELLED");

    private static final Set<String> ACTIVE_PLAN_STATUSES = Set.of("ACTIVE", "CANCELLING");

    private static final int MAX_TASKS = 100;

    private final ByaiAgentTaskPlanMapper planMapper;

    private final SessionService sessionService;

    public TaskPlanApplicationService(ByaiAgentTaskPlanMapper planMapper, SessionService sessionService) {
        this.planMapper = planMapper;
        this.sessionService = sessionService;
    }

    /** CREATE 首次定义任务；其余动作按可信 Runtime 执行归属推进权威当前任务。 */
    @Transactional
    public TaskPlanSnapshot update(TaskPlanUpdateRequest request) {
        return executeCommand(request).snapshot();
    }

    /** Controller 使用 changed 判断是否需要广播，幂等重放不重复发送事件。 */
    @Transactional
    public TaskPlanWriteResult executeCommand(TaskPlanUpdateRequest request) {
        requireCommandRequest(request);
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLongCommand(request.getSessionId(), "sessionId");
        String messageId = requiredTextCommand(request.getMessageId(), "messageId", 128);
        String sourceRuntime = normalizeRuntimeCommand(request.getSourceRuntime());
        String sourceRunId = requiredTextCommand(request.getSourceRunId(), "sourceRunId", 128);
        requireOwnedSessionCommand(sessionId, userId);
        String action = requiredTextCommand(request.getAction(), "action", 16).toUpperCase(Locale.ROOT);
        return switch (action) {
            case "CREATE" -> create(request, userId, sessionId, messageId, sourceRuntime, sourceRunId);
            case "COMPLETE_CURRENT", "FAIL_CURRENT", "SKIP_CURRENT" ->
                advanceCurrent(request, userId, sessionId, messageId, sourceRuntime, sourceRunId, action);
            default -> throw commandError("INVALID_REQUEST", "unsupported action: " + request.getAction(), null);
        };
    }

    /** CREATE 唯一键并发冲突后，在新事务中恢复首次结果或返回已有计划。 */
    public TaskPlanWriteResult recoverCreateConflict(TaskPlanUpdateRequest request) {
        requireCommandRequest(request);
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLongCommand(request.getSessionId(), "sessionId");
        String messageId = requiredTextCommand(request.getMessageId(), "messageId", 128);
        String sourceRuntime = normalizeRuntimeCommand(request.getSourceRuntime());
        String sourceRunId = requiredTextCommand(request.getSourceRunId(), "sourceRunId", 128);
        ByaiAgentTaskPlan existing = findLatestActiveForSession(userId, sessionId, true);
        if (existing == null) {
            throw commandError("VERSION_CONFLICT", "Concurrent task plan creation did not become visible", null);
        }
        String idempotencyKey = requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128);
        boolean ownedExecution = isExecutionOwner(existing, messageId, sourceRuntime, sourceRunId);
        if (ownedExecution && Objects.equals(existing.getLastCommandId(), idempotencyKey)) {
            return new TaskPlanWriteResult(snapshot(existing), false);
        }
        throw commandError("PLAN_ALREADY_EXISTS", "An active task plan already exists for this session",
            ownedExecution ? snapshot(existing) : null);
    }

    /** 查询一轮执行上的计划；Runtime 默认只取 ACTIVE，历史查询可包含终态。 */
    public TaskPlanSnapshot findActive(TaskPlanLookupRequest request) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        String messageId = requiredText(request.getMessageId(), "messageId", 128);
        String sourceRuntime = normalizeRuntime(request.getSourceRuntime());
        String sourceRunId = requiredText(request.getSourceRunId(), "sourceRunId", 128);
        requireOwnedSession(sessionId, userId);
        ByaiAgentTaskPlan plan = Boolean.TRUE.equals(request.getIncludeTerminal())
            ? findLatestForExecution(userId, sessionId, messageId, sourceRuntime, sourceRunId)
            : findActiveForExecution(userId, sessionId, messageId, sourceRuntime, sourceRunId, false);
        return plan == null ? null : snapshot(plan);
    }

    /** 前端按回答消息恢复最新计划；这是只读展示查询，不具备 Runtime 更新授权语义。 */
    public TaskPlanSnapshot findLatestForMessage(TaskPlanLookupRequest request) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        String messageId = requiredText(request.getMessageId(), "messageId", 128);
        requireOwnedSession(sessionId, userId);
        ByaiAgentTaskPlan plan = planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .eq(ByaiAgentTaskPlan::getMessageId, messageId)
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId)
            .last("LIMIT 1"));
        return plan == null ? null : snapshot(plan);
    }

    /** 为历史消息页批量查询每条回答的最新计划，包含终态计划。 */
    public Map<Long, TaskPlanSnapshot> findLatestByMessageIds(Long sessionId, List<Long> messageIds) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || sessionId == null || messageIds == null || messageIds.isEmpty()) {
            return Map.of();
        }
        Map<String, Long> historyMessageIds = new LinkedHashMap<>();
        messageIds.stream().filter(Objects::nonNull)
            .forEach(messageId -> historyMessageIds.putIfAbsent(String.valueOf(messageId), messageId));
        if (historyMessageIds.isEmpty()) {
            return Map.of();
        }
        List<ByaiAgentTaskPlan> plans = planMapper.selectList(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .in(ByaiAgentTaskPlan::getMessageId, historyMessageIds.keySet())
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId));
        if (plans == null || plans.isEmpty()) {
            return Map.of();
        }
        Map<Long, TaskPlanSnapshot> snapshots = new LinkedHashMap<>();
        plans.stream().filter(plan -> plan.getMessageId() != null)
            .forEach(plan -> {
                Long historyMessageId = historyMessageIds.get(plan.getMessageId());
                if (historyMessageId != null) {
                    snapshots.putIfAbsent(historyMessageId, snapshot(plan));
                }
            });
        return snapshots;
    }

    @Transactional
    public void deleteByMessageId(Long messageId) {
        if (messageId != null) {
            planMapper.delete(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
                .eq(ByaiAgentTaskPlan::getMessageId, String.valueOf(messageId)));
        }
    }

    @Transactional
    public void deleteBySessionId(Long sessionId) {
        if (sessionId != null) {
            planMapper.delete(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
                .eq(ByaiAgentTaskPlan::getSessionId, sessionId));
        }
    }

    @Transactional
    public List<TaskPlanSnapshot> requestCancellation(StopChatDto stopChatDto, String reasonCode,
        String reasonMessage) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return List.of();
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return findActiveForSession(userId, stopChatDto.getSessionId(), true).stream()
            .map(plan -> requestCancellation(plan, userId, reasonCode, reasonMessage))
            .toList();
    }

    @Transactional
    public TaskPlanSnapshot requestCancellation(TaskPlanLookupRequest request, String reasonCode,
        String reasonMessage) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        String messageId = requiredText(request.getMessageId(), "messageId", 128);
        String sourceRuntime = normalizeRuntime(request.getSourceRuntime());
        String sourceRunId = requiredText(request.getSourceRunId(), "sourceRunId", 128);
        requireOwnedSession(sessionId, userId);
        ByaiAgentTaskPlan plan = findActiveForExecution(userId, sessionId, messageId, sourceRuntime, sourceRunId,
            true);
        return plan == null ? null : requestCancellation(plan, userId, reasonCode, reasonMessage);
    }

    private TaskPlanSnapshot requestCancellation(ByaiAgentTaskPlan plan, Long userId, String reasonCode,
        String reasonMessage) {
        if ("CANCELLED".equals(plan.getStatus()) || "CANCELLING".equals(plan.getStatus())) {
            return snapshot(plan);
        }
        Date now = new Date();
        int nextVersion = plan.getVersion() + 1;
        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, plan.getPlanId())
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, plan.getSessionId())
            .eq(ByaiAgentTaskPlan::getMessageId, plan.getMessageId())
            .eq(ByaiAgentTaskPlan::getSourceRuntime, plan.getSourceRuntime())
            .eq(ByaiAgentTaskPlan::getSourceRunId, plan.getSourceRunId())
            .eq(ByaiAgentTaskPlan::getVersion, plan.getVersion())
            .eq(ByaiAgentTaskPlan::getStatus, "ACTIVE")
            .set(ByaiAgentTaskPlan::getStatus, "CANCELLING")
            .set(ByaiAgentTaskPlan::getStatusReasonCode, reasonCode)
            .set(ByaiAgentTaskPlan::getStatusReasonMessage, reasonMessage)
            .set(ByaiAgentTaskPlan::getVersion, nextVersion)
            .set(ByaiAgentTaskPlan::getUpdatedAt, now));
        if (changed == 0) {
            throw conflict("Task plan changed while cancellation was requested");
        }
        plan.setStatus("CANCELLING");
        plan.setStatusReasonCode(reasonCode);
        plan.setStatusReasonMessage(reasonMessage);
        plan.setVersion(nextVersion);
        plan.setUpdatedAt(now);
        return snapshot(plan);
    }

    @Transactional
    public List<TaskPlanSnapshot> confirmCancellation(StopChatDto stopChatDto, String reasonCode,
        String reasonMessage) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return List.of();
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return findActiveForSession(userId, stopChatDto.getSessionId(), true).stream()
            .map(plan -> confirmCancellation(plan, userId, reasonCode, reasonMessage))
            .toList();
    }

    @Transactional
    public TaskPlanSnapshot confirmCancellation(TaskPlanLookupRequest request, String reasonCode,
        String reasonMessage) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        String messageId = requiredText(request.getMessageId(), "messageId", 128);
        String sourceRuntime = normalizeRuntime(request.getSourceRuntime());
        String sourceRunId = requiredText(request.getSourceRunId(), "sourceRunId", 128);
        requireOwnedSession(sessionId, userId);
        ByaiAgentTaskPlan plan = findActiveForExecution(userId, sessionId, messageId, sourceRuntime, sourceRunId,
            true);
        return plan == null ? null : confirmCancellation(plan, userId, reasonCode, reasonMessage);
    }

    private TaskPlanSnapshot confirmCancellation(ByaiAgentTaskPlan plan, Long userId, String reasonCode,
        String reasonMessage) {
        if ("CANCELLED".equals(plan.getStatus())) {
            return snapshot(plan);
        }
        Date now = new Date();
        List<TaskPlanSnapshot.TaskSnapshot> tasks = tasks(plan);
        tasks.stream().filter(task -> !TERMINAL_TASK_STATUSES.contains(task.getStatus())).forEach(task -> {
            task.setStatus("CANCELLED");
            task.setStatusReason(new TaskPlanSnapshot.StatusReason("PLAN_CANCELLED", reasonMessage));
            task.setUpdatedAt(now);
            task.setCompletedAt(now);
        });
        int nextVersion = plan.getVersion() + 1;
        String tasksPayload = JSON.toJSONString(tasks);
        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, plan.getPlanId())
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, plan.getSessionId())
            .eq(ByaiAgentTaskPlan::getMessageId, plan.getMessageId())
            .eq(ByaiAgentTaskPlan::getSourceRuntime, plan.getSourceRuntime())
            .eq(ByaiAgentTaskPlan::getSourceRunId, plan.getSourceRunId())
            .eq(ByaiAgentTaskPlan::getVersion, plan.getVersion())
            .in(ByaiAgentTaskPlan::getStatus, ACTIVE_PLAN_STATUSES)
            .set(ByaiAgentTaskPlan::getTasksPayload, tasksPayload)
            .set(ByaiAgentTaskPlan::getStatus, "CANCELLED")
            .set(ByaiAgentTaskPlan::getStatusReasonCode, reasonCode)
            .set(ByaiAgentTaskPlan::getStatusReasonMessage, reasonMessage)
            .set(ByaiAgentTaskPlan::getVersion, nextVersion)
            .set(ByaiAgentTaskPlan::getUpdatedAt, now)
            .set(ByaiAgentTaskPlan::getCompletedAt, now));
        if (changed == 0) {
            throw conflict("Task plan changed while cancellation was confirmed");
        }
        plan.setTasksPayload(tasksPayload);
        plan.setStatus("CANCELLED");
        plan.setStatusReasonCode(reasonCode);
        plan.setStatusReasonMessage(reasonMessage);
        plan.setVersion(nextVersion);
        plan.setUpdatedAt(now);
        plan.setCompletedAt(now);
        return snapshot(plan, tasks);
    }

    private TaskPlanWriteResult create(TaskPlanUpdateRequest request, Long userId, Long sessionId, String messageId,
        String sourceRuntime, String sourceRunId) {
        String idempotencyKey = requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128);
        ByaiAgentTaskPlan existing = findLatestActiveForSession(userId, sessionId, true);
        if (existing != null) {
            boolean ownedExecution = isExecutionOwner(existing, messageId, sourceRuntime, sourceRunId);
            if (ownedExecution && Objects.equals(existing.getLastCommandId(), idempotencyKey)) {
                return new TaskPlanWriteResult(snapshot(existing), false);
            }
            throw commandError("PLAN_ALREADY_EXISTS", "An active task plan already exists for this session",
                ownedExecution ? snapshot(existing) : null);
        }

        Date now = new Date();
        List<TaskPlanSnapshot.TaskSnapshot> tasks = createTasks(request.getTasks(), now);
        validateSequentialExecution(tasks, null);
        ByaiAgentTaskPlan plan = new ByaiAgentTaskPlan();
        plan.setUserId(userId);
        plan.setSessionId(sessionId);
        plan.setMessageId(messageId);
        plan.setTurnId(trimToNullCommand(request.getTurnId(), 128));
        plan.setLaneId(trimToNullCommand(request.getLaneId(), 128));
        plan.setTraceId(trimToNullCommand(request.getTraceId(), 128));
        plan.setSourceRuntime(sourceRuntime);
        plan.setSourceRunId(sourceRunId);
        plan.setTitle(requiredTextCommand(request.getTitle(), "title", 500));
        plan.setLastExplanation(trimToNullCommand(request.getExplanation(), 2000));
        plan.setStatus("ACTIVE");
        plan.setVersion(1);
        plan.setTasksPayload(JSON.toJSONString(tasks));
        plan.setLastCommandId(idempotencyKey);
        plan.setCreatedAt(now);
        plan.setUpdatedAt(now);
        if (planMapper.insert(plan) != 1 || plan.getPlanId() == null) {
            throw new IllegalStateException("Task plan insert did not return an auto-generated plan_id");
        }
        return new TaskPlanWriteResult(snapshot(plan, tasks), true);
    }

    private TaskPlanWriteResult advanceCurrent(TaskPlanUpdateRequest request, Long userId, Long sessionId,
        String messageId, String sourceRuntime, String sourceRunId, String action) {
        String idempotencyKey = requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128);
        ByaiAgentTaskPlan plan = findActiveForExecution(userId, sessionId, messageId, sourceRuntime, sourceRunId,
            false);
        if (plan == null) {
            ByaiAgentTaskPlan latest = findLatestForExecution(userId, sessionId, messageId, sourceRuntime,
                sourceRunId);
            if (latest != null && Objects.equals(latest.getLastCommandId(), idempotencyKey)) {
                return new TaskPlanWriteResult(snapshot(latest), false);
            }
            throw commandError("PLAN_NOT_FOUND", "No active task plan exists for this execution",
                latest == null ? null : snapshot(latest));
        }
        if (Objects.equals(plan.getLastCommandId(), idempotencyKey)) {
            return new TaskPlanWriteResult(snapshot(plan), false);
        }

        TaskPlanSnapshot current = snapshot(plan);
        Date now = new Date();
        List<TaskPlanSnapshot.TaskSnapshot> tasks = tasks(plan);
        TaskPlanSnapshot.TaskSnapshot running = tasks.stream()
            .filter(task -> "IN_PROGRESS".equals(task.getStatus()))
            .findFirst()
            .orElseThrow(() -> commandError("INVALID_EXECUTION_ORDER",
                "Active task plan has no current IN_PROGRESS task", current));
        String nextTaskStatus = switch (action) {
            case "COMPLETE_CURRENT" -> "COMPLETED";
            case "FAIL_CURRENT" -> "FAILED";
            case "SKIP_CURRENT" -> "SKIPPED";
            default -> throw commandError("INVALID_REQUEST", "unsupported action: " + action, current);
        };
        applyTaskStatus(running, nextTaskStatus, request.getStatusReason(), now);
        if ("COMPLETED".equals(nextTaskStatus) || "SKIPPED".equals(nextTaskStatus)) {
            tasks.stream()
                .filter(task -> "PENDING".equals(task.getStatus()))
                .findFirst()
                .ifPresent(task -> applyTaskStatus(task, "IN_PROGRESS", null, now));
        }
        validateSequentialExecution(tasks, current);
        applyFailFast(tasks, now);

        String nextStatus = derivePlanStatus(tasks);
        PlanStatusReason reason = derivePlanStatusReason(tasks);
        int nextVersion = plan.getVersion() + 1;
        plan.setStatus(nextStatus);
        plan.setStatusReasonCode(reason == null ? null : reason.code());
        plan.setStatusReasonMessage(reason == null ? null : reason.message());
        plan.setVersion(nextVersion);
        plan.setTasksPayload(JSON.toJSONString(tasks));
        plan.setLastCommandId(idempotencyKey);
        plan.setUpdatedAt(now);
        plan.setCompletedAt("ACTIVE".equals(nextStatus) ? null : now);
        TaskPlanSnapshot nextSnapshot = snapshot(plan, tasks);

        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, plan.getPlanId())
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .eq(ByaiAgentTaskPlan::getMessageId, messageId)
            .eq(ByaiAgentTaskPlan::getSourceRuntime, sourceRuntime)
            .eq(ByaiAgentTaskPlan::getSourceRunId, sourceRunId)
            .eq(ByaiAgentTaskPlan::getVersion, current.getVersion())
            .eq(ByaiAgentTaskPlan::getStatus, "ACTIVE")
            .set(ByaiAgentTaskPlan::getTasksPayload, plan.getTasksPayload())
            .set(ByaiAgentTaskPlan::getLastCommandId, idempotencyKey)
            .set(ByaiAgentTaskPlan::getStatus, nextStatus)
            .set(ByaiAgentTaskPlan::getStatusReasonCode, plan.getStatusReasonCode())
            .set(ByaiAgentTaskPlan::getStatusReasonMessage, plan.getStatusReasonMessage())
            .set(ByaiAgentTaskPlan::getVersion, nextVersion)
            .set(ByaiAgentTaskPlan::getUpdatedAt, now)
            .set(ByaiAgentTaskPlan::getCompletedAt, plan.getCompletedAt()));
        if (changed == 0) {
            ByaiAgentTaskPlan latest = findLatestForExecution(userId, sessionId, messageId, sourceRuntime,
                sourceRunId);
            if (latest != null && Objects.equals(latest.getLastCommandId(), idempotencyKey)) {
                return new TaskPlanWriteResult(snapshot(latest), false);
            }
            throw commandError("VERSION_CONFLICT", "Task plan changed while it was being updated",
                latest == null ? null : snapshot(latest));
        }
        return new TaskPlanWriteResult(nextSnapshot, true);
    }

    private List<TaskPlanSnapshot.TaskSnapshot> createTasks(List<TaskPlanUpdateRequest.TaskInput> input, Date now) {
        if (input == null || input.isEmpty()) {
            throw commandError("INVALID_REQUEST", "tasks must contain at least one task", null);
        }
        if (input.size() > MAX_TASKS) {
            throw commandError("INVALID_REQUEST", "tasks must not contain more than " + MAX_TASKS + " tasks", null);
        }
        List<TaskPlanSnapshot.TaskSnapshot> tasks = new ArrayList<>(input.size());
        for (int index = 0; index < input.size(); index++) {
            TaskPlanUpdateRequest.TaskInput source = input.get(index);
            if (source == null) {
                throw commandError("INVALID_REQUEST", "tasks[" + index + "] must not be null", null);
            }
            TaskPlanSnapshot.TaskSnapshot task = new TaskPlanSnapshot.TaskSnapshot();
            task.setTaskId(String.valueOf(index + 1));
            task.setPosition(index + 1);
            task.setTitle(requiredTextCommand(source.getStep(), "tasks[" + index + "].step", 1000));
            task.setDescription(trimToNullCommand(source.getDescription(), 4000));
            task.setStatus(index == 0 ? "IN_PROGRESS" : "PENDING");
            task.setUpdatedAt(now);
            if (index == 0) {
                task.setStartedAt(now);
            }
            tasks.add(task);
        }
        return tasks;
    }

    private void applyTaskStatus(TaskPlanSnapshot.TaskSnapshot task, String nextStatus,
        TaskPlanUpdateRequest.StatusReasonInput reasonInput, Date now) {
        String previousStatus = task.getStatus();
        task.setStatus(nextStatus);
        if (reasonInput != null) {
            task.setStatusReason(statusReason(reasonInput, "statusReason"));
        }
        else if (!Objects.equals(previousStatus, nextStatus)) {
            task.setStatusReason(null);
        }
        task.setUpdatedAt(now);
        if (task.getStartedAt() == null && Set.of("IN_PROGRESS", "COMPLETED", "FAILED").contains(nextStatus)) {
            task.setStartedAt(now);
        }
        if (task.getCompletedAt() == null && TERMINAL_TASK_STATUSES.contains(nextStatus)) {
            task.setCompletedAt(now);
        }
    }

    private void validateSequentialExecution(List<TaskPlanSnapshot.TaskSnapshot> tasks, TaskPlanSnapshot current) {
        boolean pendingTailOnly = false;
        String haltStatus = null;
        for (TaskPlanSnapshot.TaskSnapshot task : tasks) {
            String status = task.getStatus();
            if (haltStatus != null) {
                boolean allowed = "PENDING".equals(status)
                    || ("FAILED".equals(haltStatus) && "SKIPPED".equals(status))
                    || ("CANCELLED".equals(haltStatus) && "CANCELLED".equals(status));
                if (!allowed) {
                    throw commandError("INVALID_EXECUTION_ORDER",
                        "Task at position " + task.getPosition() + " cannot execute after " + haltStatus, current);
                }
                continue;
            }
            if ("PENDING".equals(status)) {
                pendingTailOnly = true;
                continue;
            }
            if (pendingTailOnly) {
                throw commandError("INVALID_EXECUTION_ORDER",
                    "Task at position " + task.getPosition() + " cannot start before previous tasks are terminal",
                    current);
            }
            if ("IN_PROGRESS".equals(status)) {
                pendingTailOnly = true;
            }
            else if ("FAILED".equals(status) || "CANCELLED".equals(status)) {
                haltStatus = status;
            }
        }
    }

    private void applyFailFast(List<TaskPlanSnapshot.TaskSnapshot> tasks, Date now) {
        String haltStatus = null;
        for (TaskPlanSnapshot.TaskSnapshot task : tasks) {
            if (haltStatus == null) {
                if ("FAILED".equals(task.getStatus()) || "CANCELLED".equals(task.getStatus())) {
                    haltStatus = task.getStatus();
                }
                continue;
            }
            if (TERMINAL_TASK_STATUSES.contains(task.getStatus())) {
                continue;
            }
            boolean failed = "FAILED".equals(haltStatus);
            task.setStatus(failed ? "SKIPPED" : "CANCELLED");
            task.setStatusReason(new TaskPlanSnapshot.StatusReason(
                failed ? "BLOCKED_BY_PREVIOUS_FAILURE" : "PLAN_CANCELLED",
                failed ? "前序任务失败，后续任务已跳过" : "前序任务取消，后续任务已取消"));
            task.setUpdatedAt(now);
            task.setCompletedAt(now);
        }
    }

    private String derivePlanStatus(List<TaskPlanSnapshot.TaskSnapshot> tasks) {
        if (tasks.stream().anyMatch(task -> "FAILED".equals(task.getStatus()))) {
            return "FAILED";
        }
        if (tasks.stream().anyMatch(task -> "CANCELLED".equals(task.getStatus()))) {
            return "CANCELLED";
        }
        if (tasks.stream().anyMatch(task -> !TERMINAL_TASK_STATUSES.contains(task.getStatus()))) {
            return "ACTIVE";
        }
        return "COMPLETED";
    }

    private PlanStatusReason derivePlanStatusReason(List<TaskPlanSnapshot.TaskSnapshot> tasks) {
        TaskPlanSnapshot.TaskSnapshot failed = tasks.stream()
            .filter(task -> "FAILED".equals(task.getStatus())).findFirst().orElse(null);
        if (failed != null) {
            String code = failed.getStatusReason() == null ? "TASK_FAILED" : failed.getStatusReason().getCode();
            String message = failed.getStatusReason() == null ? "任务执行失败"
                : failed.getStatusReason().getMessage();
            return new PlanStatusReason(StringUtils.defaultIfBlank(code, "TASK_FAILED"),
                StringUtils.defaultIfBlank(message, "任务执行失败"));
        }
        TaskPlanSnapshot.TaskSnapshot cancelled = tasks.stream()
            .filter(task -> "CANCELLED".equals(task.getStatus())).findFirst().orElse(null);
        if (cancelled != null) {
            String code = cancelled.getStatusReason() == null ? "TASK_CANCELLED"
                : cancelled.getStatusReason().getCode();
            String message = cancelled.getStatusReason() == null ? "任务执行已取消"
                : cancelled.getStatusReason().getMessage();
            return new PlanStatusReason(StringUtils.defaultIfBlank(code, "TASK_CANCELLED"),
                StringUtils.defaultIfBlank(message, "任务执行已取消"));
        }
        return null;
    }

    private ByaiAgentTaskPlan findActiveForExecution(Long userId, Long sessionId, String messageId,
        String sourceRuntime, String sourceRunId, boolean includeCancelling) {
        return planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .eq(ByaiAgentTaskPlan::getMessageId, messageId)
            .eq(ByaiAgentTaskPlan::getSourceRuntime, sourceRuntime)
            .eq(ByaiAgentTaskPlan::getSourceRunId, sourceRunId)
            .in(ByaiAgentTaskPlan::getStatus, includeCancelling ? ACTIVE_PLAN_STATUSES : Set.of("ACTIVE"))
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId)
            .last("LIMIT 1"));
    }

    private ByaiAgentTaskPlan findLatestForExecution(Long userId, Long sessionId, String messageId,
        String sourceRuntime, String sourceRunId) {
        return planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .eq(ByaiAgentTaskPlan::getMessageId, messageId)
            .eq(ByaiAgentTaskPlan::getSourceRuntime, sourceRuntime)
            .eq(ByaiAgentTaskPlan::getSourceRunId, sourceRunId)
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId)
            .last("LIMIT 1"));
    }

    private ByaiAgentTaskPlan findLatestActiveForSession(Long userId, Long sessionId, boolean includeCancelling) {
        return planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .in(ByaiAgentTaskPlan::getStatus, includeCancelling ? ACTIVE_PLAN_STATUSES : Set.of("ACTIVE"))
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId)
            .last("LIMIT 1"));
    }

    private boolean isExecutionOwner(ByaiAgentTaskPlan plan, String messageId, String sourceRuntime,
        String sourceRunId) {
        return Objects.equals(plan.getMessageId(), messageId)
            && Objects.equals(plan.getSourceRuntime(), sourceRuntime)
            && Objects.equals(plan.getSourceRunId(), sourceRunId);
    }

    private List<ByaiAgentTaskPlan> findActiveForSession(Long userId, Long sessionId, boolean includeCancelling) {
        List<ByaiAgentTaskPlan> plans = planMapper.selectList(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .in(ByaiAgentTaskPlan::getStatus, includeCancelling ? ACTIVE_PLAN_STATUSES : Set.of("ACTIVE"))
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId));
        return plans == null ? List.of() : plans;
    }

    private List<TaskPlanSnapshot.TaskSnapshot> tasks(ByaiAgentTaskPlan plan) {
        if (StringUtils.isBlank(plan.getTasksPayload())) {
            return new ArrayList<>();
        }
        try {
            return new ArrayList<>(JSON.parseArray(plan.getTasksPayload(), TaskPlanSnapshot.TaskSnapshot.class));
        }
        catch (RuntimeException e) {
            throw new IllegalStateException("Stored task plan payload is invalid: " + plan.getPlanId(), e);
        }
    }

    private TaskPlanSnapshot snapshot(ByaiAgentTaskPlan plan) {
        return snapshot(plan, tasks(plan));
    }

    private TaskPlanSnapshot snapshot(ByaiAgentTaskPlan plan, List<TaskPlanSnapshot.TaskSnapshot> tasks) {
        TaskPlanSnapshot snapshot = new TaskPlanSnapshot();
        snapshot.setPlanId(String.valueOf(plan.getPlanId()));
        snapshot.setVersion(plan.getVersion());
        snapshot.setTitle(plan.getTitle());
        snapshot.setStatus(plan.getStatus());
        snapshot.setStatusReason(statusReason(plan.getStatusReasonCode(), plan.getStatusReasonMessage()));
        snapshot.setSessionId(String.valueOf(plan.getSessionId()));
        snapshot.setMessageId(plan.getMessageId());
        snapshot.setTurnId(plan.getTurnId());
        snapshot.setLaneId(plan.getLaneId());
        snapshot.setTraceId(plan.getTraceId());
        snapshot.setSourceRuntime(plan.getSourceRuntime());
        snapshot.setSourceRunId(plan.getSourceRunId());
        snapshot.setExplanation(plan.getLastExplanation());
        snapshot.setCreatedAt(plan.getCreatedAt());
        snapshot.setUpdatedAt(plan.getUpdatedAt());
        snapshot.setTasks(tasks);
        return snapshot;
    }

    private void requireCommandRequest(TaskPlanUpdateRequest request) {
        if (request == null) {
            throw commandError("INVALID_REQUEST", "request must not be null", null);
        }
        requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128);
        requiredTextCommand(request.getSourceRunId(), "sourceRunId", 128);
    }

    private void requireOwnedSessionCommand(Long sessionId, Long userId) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null || !Objects.equals(session.getCreatorId(), userId)) {
            throw commandError("PLAN_NOT_FOUND", "Session not found", null);
        }
    }

    private void requireOwnedSession(Long sessionId, Long userId) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null || !Objects.equals(session.getCreatorId(), userId)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Task plan not found");
        }
    }

    private String normalizeRuntimeCommand(String value) {
        String runtime = requiredTextCommand(value, "sourceRuntime", 32).toUpperCase(Locale.ROOT).replace('-', '_');
        if (!Set.of("BYCLAW_SUPER", "OPENCLAW").contains(runtime)) {
            throw commandError("INVALID_REQUEST", "unsupported sourceRuntime: " + value, null);
        }
        return runtime;
    }

    private String normalizeRuntime(String value) {
        String runtime = requiredText(value, "sourceRuntime", 32).toUpperCase(Locale.ROOT).replace('-', '_');
        if (!Set.of("BYCLAW_SUPER", "OPENCLAW").contains(runtime)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unsupported sourceRuntime: " + value);
        }
        return runtime;
    }

    private String requiredText(String value, String field, int maxLength) {
        String result = StringUtils.trimToNull(value);
        if (result == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " is required");
        }
        if (result.length() > maxLength) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                field + " exceeds " + maxLength + " characters");
        }
        return result;
    }

    private TaskPlanSnapshot.StatusReason statusReason(TaskPlanUpdateRequest.StatusReasonInput source, String field) {
        if (source == null) {
            return null;
        }
        return new TaskPlanSnapshot.StatusReason(requiredTextCommand(source.getCode(), field + ".code", 64),
            trimToNullCommand(source.getMessage(), 500));
    }

    private TaskPlanSnapshot.StatusReason statusReason(String code, String message) {
        return StringUtils.isBlank(code) ? null : new TaskPlanSnapshot.StatusReason(code, message);
    }

    private String requiredTextCommand(String value, String field, int maxLength) {
        String result = StringUtils.trimToNull(value);
        if (result == null) {
            throw commandError("INVALID_REQUEST", field + " is required", null);
        }
        if (result.length() > maxLength) {
            throw commandError("INVALID_REQUEST", field + " exceeds " + maxLength + " characters", null);
        }
        return result;
    }

    private String trimToNullCommand(String value, int maxLength) {
        String result = StringUtils.trimToNull(value);
        if (result != null && result.length() > maxLength) {
            throw commandError("INVALID_REQUEST", "text exceeds " + maxLength + " characters", null);
        }
        return result;
    }

    private Long parseRequiredLongCommand(String value, String field) {
        Long parsed = parseOptionalLong(value);
        if (parsed == null) {
            throw commandError("INVALID_REQUEST", field + " must be a positive integer string", null);
        }
        return parsed;
    }

    private Long parseRequiredLong(String value, String field) {
        Long parsed = parseOptionalLong(value);
        if (parsed == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, field + " must be a positive integer string");
        }
        return parsed;
    }

    private Long parseOptionalLong(String value) {
        if (StringUtils.isBlank(value)) {
            return null;
        }
        try {
            long parsed = Long.parseLong(value.trim());
            return parsed > 0 ? parsed : null;
        }
        catch (NumberFormatException ignored) {
            return null;
        }
    }

    private TaskPlanCommandException commandError(String code, String message, TaskPlanSnapshot currentPlan) {
        return new TaskPlanCommandException(code, message, currentPlan);
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private record PlanStatusReason(String code, String message) {
    }

    public record TaskPlanWriteResult(TaskPlanSnapshot snapshot, boolean changed) {
    }

}
