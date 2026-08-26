package com.iwhalecloud.byai.state.application.service.taskplan;

import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
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

import cn.hutool.core.util.IdUtil;

/** Agent 任务计划的单表权威写入、查询和取消服务。 */
@Service
public class TaskPlanApplicationService {

    private static final Set<String> TASK_STATUSES = Set.of(
        "PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "SKIPPED", "CANCELLED");

    private static final Set<String> CREATE_TASK_STATUSES = Set.of("PENDING", "IN_PROGRESS");

    private static final Set<String> TERMINAL_TASK_STATUSES = Set.of(
        "COMPLETED", "FAILED", "SKIPPED", "CANCELLED");

    private static final Set<String> ACTIVE_PLAN_STATUSES = Set.of("ACTIVE", "CANCELLING");

    private static final Map<String, Set<String>> ALLOWED_TRANSITIONS = Map.of(
        "PENDING", Set.of("PENDING", "IN_PROGRESS", "SKIPPED", "CANCELLED"),
        "IN_PROGRESS", Set.of("IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED"),
        "COMPLETED", Set.of("COMPLETED"),
        "FAILED", Set.of("FAILED"),
        "SKIPPED", Set.of("SKIPPED"),
        "CANCELLED", Set.of("CANCELLED"));

    private static final int MAX_TASKS = 100;

    private final ByaiAgentTaskPlanMapper planMapper;

    private final SessionService sessionService;

    public TaskPlanApplicationService(ByaiAgentTaskPlanMapper planMapper, SessionService sessionService) {
        this.planMapper = planMapper;
        this.sessionService = sessionService;
    }

    /** CREATE 首次定义任务；UPDATE 仅按 taskId 更新状态。 */
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
        Long messageId = parseRequiredLongCommand(request.getMessageId(), "messageId");
        String sourceRuntime = normalizeRuntimeCommand(request.getSourceRuntime());
        requireOwnedSessionCommand(sessionId, userId);
        String action = requiredTextCommand(request.getAction(), "action", 16).toUpperCase(Locale.ROOT);
        return switch (action) {
            case "CREATE" -> create(request, userId, sessionId, messageId, sourceRuntime);
            case "UPDATE" -> updateStatuses(request, userId, sessionId, messageId, sourceRuntime);
            default -> throw commandError("INVALID_REQUEST", "unsupported action: " + request.getAction(), null);
        };
    }

    /** CREATE 唯一键并发冲突后，在新事务中恢复首次结果或返回已有计划。 */
    public TaskPlanWriteResult recoverCreateConflict(TaskPlanUpdateRequest request) {
        requireCommandRequest(request);
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLongCommand(request.getSessionId(), "sessionId");
        Long messageId = parseRequiredLongCommand(request.getMessageId(), "messageId");
        String sourceRuntime = normalizeRuntimeCommand(request.getSourceRuntime());
        String sourceRunId = requiredTextCommand(request.getSourceRunId(), "sourceRunId", 128);
        ByaiAgentTaskPlan existing = findByExecution(userId, sessionId, messageId, request.getTraceId(), sourceRuntime,
            sourceRunId, true, true);
        if (existing == null) {
            throw commandError("VERSION_CONFLICT", "Concurrent task plan creation did not become visible", null);
        }
        TaskPlanSnapshot replay = findReplay(existing,
            requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128));
        if (replay != null) {
            return new TaskPlanWriteResult(replay, false);
        }
        throw commandError("PLAN_ALREADY_EXISTS", "An active or historical plan already exists for this Run",
            snapshot(existing));
    }

    /** 查询一轮执行上的计划；Runtime 默认只取 ACTIVE，历史查询可包含终态。 */
    public TaskPlanSnapshot findActive(TaskPlanLookupRequest request) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        requireOwnedSession(sessionId, userId);
        ByaiAgentTaskPlan plan = findByExecution(userId, sessionId, parseOptionalLong(request.getMessageId()),
            request.getTraceId(), request.getSourceRuntime(), request.getSourceRunId(), false,
            Boolean.TRUE.equals(request.getIncludeTerminal()));
        return plan == null ? null : snapshot(plan);
    }

    /** 为历史消息页批量查询每条回答的最新计划，包含终态计划。 */
    public Map<Long, TaskPlanSnapshot> findLatestByMessageIds(Long sessionId, List<Long> messageIds) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null || sessionId == null || messageIds == null || messageIds.isEmpty()) {
            return Map.of();
        }
        List<Long> distinctMessageIds = messageIds.stream().filter(Objects::nonNull).distinct().toList();
        if (distinctMessageIds.isEmpty()) {
            return Map.of();
        }
        List<ByaiAgentTaskPlan> plans = planMapper.selectList(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId)
            .in(ByaiAgentTaskPlan::getMessageId, distinctMessageIds)
            .orderByDesc(ByaiAgentTaskPlan::getUpdatedAt)
            .orderByDesc(ByaiAgentTaskPlan::getPlanId));
        if (plans == null || plans.isEmpty()) {
            return Map.of();
        }
        Map<Long, TaskPlanSnapshot> snapshots = new LinkedHashMap<>();
        plans.stream().filter(plan -> plan.getMessageId() != null)
            .forEach(plan -> snapshots.putIfAbsent(plan.getMessageId(), snapshot(plan)));
        return snapshots;
    }

    @Transactional
    public void deleteByMessageId(Long messageId) {
        if (messageId != null) {
            planMapper.delete(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
                .eq(ByaiAgentTaskPlan::getMessageId, messageId));
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
    public TaskPlanSnapshot requestCancellation(StopChatDto stopChatDto, String reasonCode, String reasonMessage) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return requestCancellation(userId, stopChatDto.getSessionId(), stopChatDto.getMessageId(),
            stopChatDto.getTraceId(), null, null, reasonCode, reasonMessage);
    }

    @Transactional
    public TaskPlanSnapshot requestCancellation(TaskPlanLookupRequest request, String reasonCode,
        String reasonMessage) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        requireOwnedSession(sessionId, userId);
        return requestCancellation(userId, sessionId, parseOptionalLong(request.getMessageId()),
            request.getTraceId(), request.getSourceRuntime(), request.getSourceRunId(), reasonCode, reasonMessage);
    }

    private TaskPlanSnapshot requestCancellation(Long userId, Long sessionId, Long messageId, String traceId,
        String sourceRuntime, String sourceRunId, String reasonCode, String reasonMessage) {
        ByaiAgentTaskPlan plan = findByExecution(userId, sessionId, messageId, traceId, sourceRuntime, sourceRunId,
            true, false);
        if (plan == null) {
            return null;
        }
        if ("CANCELLED".equals(plan.getStatus()) || "CANCELLING".equals(plan.getStatus())) {
            return snapshot(plan);
        }
        Date now = new Date();
        int nextVersion = plan.getVersion() + 1;
        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, plan.getPlanId())
            .eq(ByaiAgentTaskPlan::getUserId, userId)
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
    public TaskPlanSnapshot confirmCancellation(StopChatDto stopChatDto, String reasonCode, String reasonMessage) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return confirmCancellation(userId, stopChatDto.getSessionId(), stopChatDto.getMessageId(),
            stopChatDto.getTraceId(), null, null, reasonCode, reasonMessage);
    }

    @Transactional
    public TaskPlanSnapshot confirmCancellation(TaskPlanLookupRequest request, String reasonCode,
        String reasonMessage) {
        if (request == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        requireOwnedSession(sessionId, userId);
        return confirmCancellation(userId, sessionId, parseOptionalLong(request.getMessageId()),
            request.getTraceId(), request.getSourceRuntime(), request.getSourceRunId(), reasonCode, reasonMessage);
    }

    private TaskPlanSnapshot confirmCancellation(Long userId, Long sessionId, Long messageId, String traceId,
        String sourceRuntime, String sourceRunId, String reasonCode, String reasonMessage) {
        ByaiAgentTaskPlan plan = findByExecution(userId, sessionId, messageId, traceId, sourceRuntime, sourceRunId,
            true, false);
        if (plan == null) {
            return null;
        }
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

    private TaskPlanWriteResult create(TaskPlanUpdateRequest request, Long userId, Long sessionId, Long messageId,
        String sourceRuntime) {
        String idempotencyKey = requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128);
        String sourceRunId = requiredTextCommand(request.getSourceRunId(), "sourceRunId", 128);
        ByaiAgentTaskPlan existing = findByExecution(userId, sessionId, messageId, request.getTraceId(), sourceRuntime,
            sourceRunId, true, true);
        if (existing != null) {
            TaskPlanSnapshot replay = findReplay(existing, idempotencyKey);
            if (replay != null) {
                return new TaskPlanWriteResult(replay, false);
            }
            throw commandError("PLAN_ALREADY_EXISTS", "An active or historical plan already exists for this Run",
                snapshot(existing));
        }

        Date now = new Date();
        List<TaskPlanSnapshot.TaskSnapshot> tasks = createTasks(request.getTasks(), now);
        validateSequentialExecution(tasks, null);
        ByaiAgentTaskPlan plan = new ByaiAgentTaskPlan();
        plan.setPlanId(IdUtil.getSnowflakeNextId());
        plan.setUserId(userId);
        plan.setUserCode(CurrentUserHolder.getCurrentUserCode());
        plan.setSessionId(sessionId);
        plan.setMessageId(messageId);
        plan.setTurnId(trimToNullCommand(request.getTurnId(), 128));
        plan.setLaneId(trimToNullCommand(request.getLaneId(), 128));
        plan.setTraceId(trimToNullCommand(request.getTraceId(), 128));
        plan.setSourceRuntime(sourceRuntime);
        plan.setSourceRunId(sourceRunId);
        plan.setCreateRequestId(idempotencyKey);
        plan.setTitle(requiredTextCommand(request.getTitle(), "title", 500));
        plan.setLastExplanation(trimToNullCommand(request.getExplanation(), 2000));
        plan.setStatus("ACTIVE");
        plan.setVersion(1);
        plan.setTasksPayload(JSON.toJSONString(tasks));
        plan.setCreatedAt(now);
        plan.setUpdatedAt(now);

        TaskPlanSnapshot snapshot = snapshot(plan, tasks);
        plan.setIdempotencyPayload(withIdempotencyRecord(List.of(), idempotencyKey, snapshot));
        planMapper.insert(plan);
        return new TaskPlanWriteResult(snapshot, true);
    }

    private TaskPlanWriteResult updateStatuses(TaskPlanUpdateRequest request, Long userId, Long sessionId,
        Long messageId, String sourceRuntime) {
        String idempotencyKey = requiredTextCommand(request.getIdempotencyKey(), "idempotencyKey", 128);
        Long planId = parseRequiredLongCommand(request.getPlanId(), "planId");
        ByaiAgentTaskPlan plan = planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getPlanId, planId)
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .last("LIMIT 1"));
        if (plan == null || !matchesExecution(plan, sessionId, messageId, sourceRuntime, request.getSourceRunId())) {
            throw commandError("PLAN_NOT_FOUND", "Task plan does not belong to the current Run", null);
        }
        TaskPlanSnapshot replay = findReplay(plan, idempotencyKey);
        if (replay != null) {
            return new TaskPlanWriteResult(replay, false);
        }
        TaskPlanSnapshot current = snapshot(plan);
        if (!"ACTIVE".equals(plan.getStatus())) {
            throw commandError("PLAN_NOT_ACTIVE", "Task plan is not active: " + plan.getStatus(), current);
        }
        if (request.getExpectedVersion() == null || request.getExpectedVersion() < 1) {
            throw commandError("INVALID_REQUEST", "expectedVersion must be a positive integer", current);
        }
        if (!Objects.equals(request.getExpectedVersion(), plan.getVersion())) {
            throw commandError("VERSION_CONFLICT", "Task plan version has changed", current);
        }
        if (request.getUpdates() == null || request.getUpdates().isEmpty()) {
            throw commandError("INVALID_REQUEST", "updates must contain at least one task update", current);
        }
        if (request.getUpdates().size() > MAX_TASKS) {
            throw commandError("INVALID_REQUEST", "updates must not contain more than " + MAX_TASKS + " entries",
                current);
        }

        Date now = new Date();
        List<TaskPlanSnapshot.TaskSnapshot> tasks = tasks(plan);
        Map<String, TaskPlanSnapshot.TaskSnapshot> byId = new LinkedHashMap<>();
        tasks.forEach(task -> byId.put(task.getTaskId(), task));
        Set<String> updatedTaskIds = new LinkedHashSet<>();
        for (int index = 0; index < request.getUpdates().size(); index++) {
            TaskPlanUpdateRequest.TaskStatusUpdate update = request.getUpdates().get(index);
            if (update == null) {
                throw commandError("INVALID_REQUEST", "updates[" + index + "] must not be null", current);
            }
            String taskId = requiredTextCommand(update.getTaskId(), "updates[" + index + "].taskId", 32);
            if (!updatedTaskIds.add(taskId)) {
                throw commandError("INVALID_REQUEST", "taskId appears more than once: " + taskId, current);
            }
            TaskPlanSnapshot.TaskSnapshot task = byId.get(taskId);
            if (task == null) {
                throw commandError("TASK_NOT_FOUND", "Task does not belong to the current plan: " + taskId,
                    current);
            }
            String nextStatus = normalizeTaskStatusCommand(update.getStatus());
            validateTransition(task, nextStatus, current);
            applyTaskStatus(task, nextStatus, update.getStatusReason(), now);
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
        plan.setUpdatedAt(now);
        plan.setCompletedAt("ACTIVE".equals(nextStatus) ? null : now);
        TaskPlanSnapshot nextSnapshot = snapshot(plan, tasks);
        String idempotencyPayload = withIdempotencyRecord(idempotencyRecords(plan), idempotencyKey, nextSnapshot);

        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, planId)
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getVersion, request.getExpectedVersion())
            .eq(ByaiAgentTaskPlan::getStatus, "ACTIVE")
            .set(ByaiAgentTaskPlan::getTasksPayload, plan.getTasksPayload())
            .set(ByaiAgentTaskPlan::getIdempotencyPayload, idempotencyPayload)
            .set(ByaiAgentTaskPlan::getStatus, nextStatus)
            .set(ByaiAgentTaskPlan::getStatusReasonCode, plan.getStatusReasonCode())
            .set(ByaiAgentTaskPlan::getStatusReasonMessage, plan.getStatusReasonMessage())
            .set(ByaiAgentTaskPlan::getVersion, nextVersion)
            .set(ByaiAgentTaskPlan::getUpdatedAt, now)
            .set(ByaiAgentTaskPlan::getCompletedAt, plan.getCompletedAt()));
        if (changed == 0) {
            ByaiAgentTaskPlan latest = requireOwnedPlan(planId, userId);
            TaskPlanSnapshot concurrentReplay = findReplay(latest, idempotencyKey);
            if (concurrentReplay != null) {
                return new TaskPlanWriteResult(concurrentReplay, false);
            }
            throw commandError("VERSION_CONFLICT", "Task plan changed while it was being updated", snapshot(latest));
        }
        plan.setIdempotencyPayload(idempotencyPayload);
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
            String status = normalizeTaskStatusCommand(source.getStatus());
            if (!CREATE_TASK_STATUSES.contains(status)) {
                throw commandError("INVALID_REQUEST", "CREATE only accepts PENDING or IN_PROGRESS tasks", null);
            }
            TaskPlanSnapshot.TaskSnapshot task = new TaskPlanSnapshot.TaskSnapshot();
            task.setTaskId(String.valueOf(IdUtil.getSnowflakeNextId()));
            task.setPosition(index + 1);
            task.setTitle(requiredTextCommand(source.getStep(), "tasks[" + index + "].step", 1000));
            task.setDescription(trimToNullCommand(source.getDescription(), 4000));
            task.setStatus(status);
            task.setStatusReason(statusReason(source.getStatusReason(), "tasks[" + index + "].statusReason"));
            task.setUpdatedAt(now);
            if ("IN_PROGRESS".equals(status)) {
                task.setStartedAt(now);
            }
            tasks.add(task);
        }
        return tasks;
    }

    private void validateTransition(TaskPlanSnapshot.TaskSnapshot task, String nextStatus, TaskPlanSnapshot current) {
        Set<String> allowed = ALLOWED_TRANSITIONS.getOrDefault(task.getStatus(), Set.of());
        if (!allowed.contains(nextStatus)) {
            throw commandError("ILLEGAL_TASK_TRANSITION",
                task.getTaskId() + " cannot change from " + task.getStatus() + " to " + nextStatus, current);
        }
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

    private ByaiAgentTaskPlan findByExecution(Long userId, Long sessionId, Long messageId, String traceId,
        String sourceRuntime, String sourceRunId, boolean includeCancelling, boolean includeTerminal) {
        var query = Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getSessionId, sessionId);
        if (messageId != null) {
            query.eq(ByaiAgentTaskPlan::getMessageId, messageId);
        }
        else if (StringUtils.isNotBlank(traceId)) {
            query.eq(ByaiAgentTaskPlan::getTraceId, traceId.trim());
        }
        else if (StringUtils.isNotBlank(sourceRunId)) {
            query.eq(ByaiAgentTaskPlan::getSourceRunId, sourceRunId.trim());
        }
        else {
            return null;
        }
        if (StringUtils.isNotBlank(sourceRuntime)) {
            query.eq(ByaiAgentTaskPlan::getSourceRuntime, normalizeRuntime(sourceRuntime));
        }
        if (StringUtils.isNotBlank(sourceRunId)) {
            query.eq(ByaiAgentTaskPlan::getSourceRunId, sourceRunId.trim());
        }
        if (!includeTerminal) {
            query.in(ByaiAgentTaskPlan::getStatus, includeCancelling ? ACTIVE_PLAN_STATUSES : Set.of("ACTIVE"));
        }
        query.orderByDesc(ByaiAgentTaskPlan::getUpdatedAt).last("LIMIT 1");
        return planMapper.selectOne(query);
    }

    private boolean matchesExecution(ByaiAgentTaskPlan plan, Long sessionId, Long messageId, String sourceRuntime,
        String sourceRunId) {
        return Objects.equals(plan.getSessionId(), sessionId)
            && Objects.equals(plan.getMessageId(), messageId)
            && Objects.equals(plan.getSourceRuntime(), sourceRuntime)
            && Objects.equals(plan.getSourceRunId(), StringUtils.trimToNull(sourceRunId));
    }

    private ByaiAgentTaskPlan requireOwnedPlan(Long planId, Long userId) {
        ByaiAgentTaskPlan plan = planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getPlanId, planId)
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .last("LIMIT 1"));
        if (plan == null) {
            throw commandError("PLAN_NOT_FOUND", "Task plan not found", null);
        }
        return plan;
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
        snapshot.setMessageId(String.valueOf(plan.getMessageId()));
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

    private TaskPlanSnapshot findReplay(ByaiAgentTaskPlan plan, String idempotencyKey) {
        return idempotencyRecords(plan).stream()
            .filter(record -> Objects.equals(record.getIdempotencyKey(), idempotencyKey))
            .map(IdempotencyRecord::getSnapshot)
            .findFirst()
            .orElse(null);
    }

    private List<IdempotencyRecord> idempotencyRecords(ByaiAgentTaskPlan plan) {
        if (StringUtils.isBlank(plan.getIdempotencyPayload())) {
            return new ArrayList<>();
        }
        try {
            return new ArrayList<>(JSON.parseArray(plan.getIdempotencyPayload(), IdempotencyRecord.class));
        }
        catch (RuntimeException e) {
            throw new IllegalStateException("Stored task plan idempotency payload is invalid: " + plan.getPlanId(), e);
        }
    }

    private String withIdempotencyRecord(List<IdempotencyRecord> existing, String key, TaskPlanSnapshot snapshot) {
        List<IdempotencyRecord> records = new ArrayList<>(existing);
        records.add(new IdempotencyRecord(key, snapshot));
        return JSON.toJSONString(records);
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
        String runtime = StringUtils.trimToEmpty(value).toUpperCase(Locale.ROOT).replace('-', '_');
        if (!Set.of("BYCLAW_SUPER", "OPENCLAW").contains(runtime)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unsupported sourceRuntime: " + value);
        }
        return runtime;
    }

    private String normalizeTaskStatusCommand(String value) {
        String status = requiredTextCommand(value, "task status", 32).toUpperCase(Locale.ROOT).replace('-', '_');
        if (!TASK_STATUSES.contains(status)) {
            throw commandError("INVALID_REQUEST", "unsupported task status: " + value, null);
        }
        return status;
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

    /** 单表内嵌的幂等重放记录。 */
    public static class IdempotencyRecord {

        private String idempotencyKey;

        private TaskPlanSnapshot snapshot;

        public IdempotencyRecord() {
        }

        public IdempotencyRecord(String idempotencyKey, TaskPlanSnapshot snapshot) {
            this.idempotencyKey = idempotencyKey;
            this.snapshot = snapshot;
        }

        public String getIdempotencyKey() {
            return idempotencyKey;
        }

        public void setIdempotencyKey(String idempotencyKey) {
            this.idempotencyKey = idempotencyKey;
        }

        public TaskPlanSnapshot getSnapshot() {
            return snapshot;
        }

        public void setSnapshot(TaskPlanSnapshot snapshot) {
            this.snapshot = snapshot;
        }
    }
}
