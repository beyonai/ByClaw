package com.iwhalecloud.byai.state.application.service.taskplan;

import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
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
import cn.hutool.core.util.IdUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskEvent;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskItem;
import com.iwhalecloud.byai.manager.entity.taskplan.ByaiAgentTaskPlan;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskEventMapper;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskItemMapper;
import com.iwhalecloud.byai.manager.mapper.taskplan.ByaiAgentTaskPlanMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.StopChatDto;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;

/** Agent 任务计划的权威写入、查询和取消服务。 */
@Service
public class TaskPlanApplicationService {

    private static final Set<String> TASK_STATUSES = Set.of(
        "PENDING", "IN_PROGRESS", "COMPLETED", "FAILED", "SKIPPED", "CANCELLED");

    private static final Set<String> TERMINAL_TASK_STATUSES = Set.of(
        "COMPLETED", "FAILED", "SKIPPED", "CANCELLED");

    private static final Set<String> ACTIVE_PLAN_STATUSES = Set.of("ACTIVE", "CANCELLING");

    private static final int MAX_TASKS = 100;

    private final ByaiAgentTaskPlanMapper planMapper;

    private final ByaiAgentTaskItemMapper itemMapper;

    private final ByaiAgentTaskEventMapper eventMapper;

    private final SessionService sessionService;

    public TaskPlanApplicationService(ByaiAgentTaskPlanMapper planMapper, ByaiAgentTaskItemMapper itemMapper,
        ByaiAgentTaskEventMapper eventMapper, SessionService sessionService) {
        this.planMapper = planMapper;
        this.itemMapper = itemMapper;
        this.eventMapper = eventMapper;
        this.sessionService = sessionService;
    }

    /** 按可信执行归属查找计划，不存在则创建，存在则替换完整任务快照。 */
    @Transactional
    public TaskPlanSnapshot update(TaskPlanUpdateRequest request) {
        requireRequest(request);
        Long userId = CurrentUserHolder.getCurrentUserId();
        Long sessionId = parseRequiredLong(request.getSessionId(), "sessionId");
        Long messageId = parseRequiredLong(request.getMessageId(), "messageId");
        String sourceRuntime = normalizeRuntime(request.getSourceRuntime());
        requireOwnedSession(sessionId, userId);
        ByaiAgentTaskPlan plan = findByExecution(userId, sessionId, messageId, request.getTraceId(),
            sourceRuntime, null, true, true);
        return plan == null ? create(request, userId, sessionId, messageId) : replace(request, userId, plan);
    }

    /** 查询当前用户在指定执行上的最新计划；没有计划时返回 null。 */
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

    /** STOP_CHAT 第一步：立即封住模型的迟到更新，并对外展示“正在停止”。 */
    @Transactional
    public TaskPlanSnapshot requestCancellation(StopChatDto stopChatDto, String reasonCode, String reasonMessage) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return requestCancellation(userId, stopChatDto.getSessionId(), stopChatDto.getMessageId(),
            stopChatDto.getTraceId(), null, null, reasonCode, reasonMessage);
    }

    /** 运行时直接取消时使用同一回答的执行归属定位计划。 */
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
        if ("CANCELLED".equals(plan.getStatus())) {
            return snapshot(plan);
        }
        if (!"CANCELLING".equals(plan.getStatus())) {
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
                .set(ByaiAgentTaskPlan::getUpdatedAt, new Date()));
            if (changed == 0) {
                throw conflict("Task plan changed while cancellation was requested");
            }
            plan = requireOwnedPlan(plan.getPlanId(), userId);
            appendEvent(plan, "PLAN_CANCELLING", "USER", CurrentUserHolder.getCurrentUserCode(),
                "cancel-request:" + nextVersion, snapshot(plan));
        }
        return snapshot(plan);
    }

    /** STOP_CHAT 第二步：运行时确认停止后，把全部未完成步骤收敛为 CANCELLED。 */
    @Transactional
    public TaskPlanSnapshot confirmCancellation(StopChatDto stopChatDto, String reasonCode, String reasonMessage) {
        if (stopChatDto == null || stopChatDto.getSessionId() == null) {
            return null;
        }
        Long userId = CurrentUserHolder.getCurrentUserId();
        return confirmCancellation(userId, stopChatDto.getSessionId(), stopChatDto.getMessageId(),
            stopChatDto.getTraceId(), null, null, reasonCode, reasonMessage);
    }

    /** 运行时直接取消的确认阶段。 */
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
        List<ByaiAgentTaskItem> items = items(plan.getPlanId());
        for (ByaiAgentTaskItem item : items) {
            if (TERMINAL_TASK_STATUSES.contains(item.getStatus())) {
                continue;
            }
            item.setStatus("CANCELLED");
            item.setStatusReasonCode("PLAN_CANCELLED");
            item.setStatusReasonMessage(reasonMessage);
            item.setUpdatedAt(now);
            item.setCompletedAt(now);
            itemMapper.updateById(item);
        }

        int nextVersion = plan.getVersion() + 1;
        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, plan.getPlanId())
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getVersion, plan.getVersion())
            .in(ByaiAgentTaskPlan::getStatus, ACTIVE_PLAN_STATUSES)
            .set(ByaiAgentTaskPlan::getStatus, "CANCELLED")
            .set(ByaiAgentTaskPlan::getStatusReasonCode, reasonCode)
            .set(ByaiAgentTaskPlan::getStatusReasonMessage, reasonMessage)
            .set(ByaiAgentTaskPlan::getVersion, nextVersion)
            .set(ByaiAgentTaskPlan::getUpdatedAt, now)
            .set(ByaiAgentTaskPlan::getCompletedAt, now));
        if (changed == 0) {
            throw conflict("Task plan changed while cancellation was confirmed");
        }
        plan = requireOwnedPlan(plan.getPlanId(), userId);
        TaskPlanSnapshot snapshot = snapshot(plan);
        appendEvent(plan, "PLAN_CANCELLED", "USER", CurrentUserHolder.getCurrentUserCode(),
            "cancel-confirm:" + nextVersion, snapshot);
        return snapshot;
    }

    private TaskPlanSnapshot create(TaskPlanUpdateRequest request, Long userId, Long sessionId, Long messageId) {
        Date now = new Date();
        ByaiAgentTaskPlan plan = new ByaiAgentTaskPlan();
        plan.setPlanId(IdUtil.getSnowflakeNextId());
        plan.setUserId(userId);
        plan.setUserCode(CurrentUserHolder.getCurrentUserCode());
        plan.setSessionId(sessionId);
        plan.setMessageId(messageId);
        plan.setTurnId(trimToNull(request.getTurnId(), 128));
        plan.setLaneId(trimToNull(request.getLaneId(), 128));
        plan.setTraceId(trimToNull(request.getTraceId(), 128));
        plan.setSourceRuntime(normalizeRuntime(request.getSourceRuntime()));
        plan.setSourceRunId(requiredText(request.getSourceRunId(), "sourceRunId", 128));
        plan.setCreateRequestId(requiredText(request.getIdempotencyKey(), "idempotencyKey", 128));
        plan.setTitle(requiredText(request.getTitle(), "title", 500));
        plan.setLastExplanation(trimToNull(request.getExplanation(), 2000));
        plan.setVersion(1);
        plan.setCreatedAt(now);
        plan.setUpdatedAt(now);

        List<ByaiAgentTaskItem> taskItems = reconcileTasks(plan.getPlanId(), request.getTasks(), List.of(), now);
        plan.setStatus(derivePlanStatus(taskItems));
        if (!"ACTIVE".equals(plan.getStatus())) {
            plan.setCompletedAt(now);
        }
        planMapper.insert(plan);
        taskItems.forEach(itemMapper::insert);

        TaskPlanSnapshot snapshot = snapshot(plan);
        appendEvent(plan, "PLAN_CREATED", "AGENT_TOOL", CurrentUserHolder.getCurrentUserCode(),
            request.getIdempotencyKey(), snapshot);
        return snapshot;
    }

    private TaskPlanSnapshot replace(TaskPlanUpdateRequest request, Long userId, ByaiAgentTaskPlan plan) {
        Long planId = plan.getPlanId();
        ByaiAgentTaskEvent retried = eventMapper.selectOne(Wrappers.<ByaiAgentTaskEvent>lambdaQuery()
            .eq(ByaiAgentTaskEvent::getPlanId, planId)
            .eq(ByaiAgentTaskEvent::getIdempotencyKey,
                requiredText(request.getIdempotencyKey(), "idempotencyKey", 128))
            .last("LIMIT 1"));
        if (retried != null) {
            return snapshot(plan);
        }
        if (!"ACTIVE".equals(plan.getStatus())) {
            throw conflict("Task plan is not active: " + plan.getStatus());
        }

        Date now = new Date();
        List<ByaiAgentTaskItem> replacement = reconcileTasks(planId, request.getTasks(), items(planId), now);
        String nextStatus = derivePlanStatus(replacement);
        int nextVersion = plan.getVersion() + 1;
        int changed = planMapper.update(null, Wrappers.<ByaiAgentTaskPlan>lambdaUpdate()
            .eq(ByaiAgentTaskPlan::getPlanId, planId)
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .eq(ByaiAgentTaskPlan::getVersion, plan.getVersion())
            .eq(ByaiAgentTaskPlan::getStatus, "ACTIVE")
            .set(ByaiAgentTaskPlan::getTitle, requiredText(request.getTitle(), "title", 500))
            .set(ByaiAgentTaskPlan::getLastExplanation, trimToNull(request.getExplanation(), 2000))
            .set(ByaiAgentTaskPlan::getStatus, nextStatus)
            .set(ByaiAgentTaskPlan::getVersion, nextVersion)
            .set(ByaiAgentTaskPlan::getUpdatedAt, now)
            .set(ByaiAgentTaskPlan::getCompletedAt, "ACTIVE".equals(nextStatus) ? null : now));
        if (changed == 0) {
            throw conflict("Task plan changed while it was being updated");
        }

        itemMapper.delete(Wrappers.<ByaiAgentTaskItem>lambdaQuery()
            .eq(ByaiAgentTaskItem::getPlanId, planId));
        replacement.forEach(itemMapper::insert);
        plan = requireOwnedPlan(planId, userId);
        TaskPlanSnapshot snapshot = snapshot(plan);
        appendEvent(plan, "PLAN_UPDATED", "AGENT_TOOL", CurrentUserHolder.getCurrentUserCode(),
            request.getIdempotencyKey(), snapshot);
        return snapshot;
    }

    private List<ByaiAgentTaskItem> reconcileTasks(Long planId, List<TaskPlanUpdateRequest.TaskInput> input,
        List<ByaiAgentTaskItem> existing, Date now) {
        if (input == null || input.isEmpty()) {
            throw badRequest("tasks must contain at least one task");
        }
        if (input.size() > MAX_TASKS) {
            throw badRequest("tasks must not contain more than " + MAX_TASKS + " tasks");
        }

        Map<Integer, ByaiAgentTaskItem> byPosition = new HashMap<>();
        existing.forEach(item -> byPosition.put(item.getPosition(), item));
        List<ByaiAgentTaskItem> result = new ArrayList<>(input.size());

        for (int index = 0; index < input.size(); index++) {
            TaskPlanUpdateRequest.TaskInput source = input.get(index);
            if (source == null) {
                throw badRequest("tasks[" + index + "] must not be null");
            }
            int position = index + 1;
            String title = requiredText(source.getStep(), "tasks[" + index + "].step", 1000);
            String status = normalizeTaskStatus(source.getStatus());
            ByaiAgentTaskItem samePosition = byPosition.get(position);
            ByaiAgentTaskItem previous = samePosition != null && title.equals(samePosition.getTitle())
                ? samePosition : null;

            Long taskId = previous == null ? IdUtil.getSnowflakeNextId() : previous.getTaskId();
            ByaiAgentTaskItem item = new ByaiAgentTaskItem();
            item.setTaskId(taskId);
            item.setPlanId(planId);
            item.setPosition(position);
            item.setTitle(title);
            item.setDescription(trimToNull(source.getDescription(), 4000));
            item.setStatus(status);
            TaskPlanUpdateRequest.StatusReasonInput statusReason = source.getStatusReason();
            item.setStatusReasonCode(statusReason == null ? null
                : requiredText(statusReason.getCode(), "tasks[" + index + "].statusReason.code", 64));
            item.setStatusReasonMessage(statusReason == null ? null
                : trimToNull(statusReason.getMessage(), 500));
            item.setCreatedAt(previous == null ? now : previous.getCreatedAt());
            item.setUpdatedAt(now);
            item.setStartedAt(resolveStartedAt(previous, status, now));
            item.setCompletedAt(TERMINAL_TASK_STATUSES.contains(status) ? now : null);
            result.add(item);
        }
        return result;
    }

    private Date resolveStartedAt(ByaiAgentTaskItem previous, String status, Date now) {
        if (previous != null && previous.getStartedAt() != null) {
            return previous.getStartedAt();
        }
        return "PENDING".equals(status) ? null : now;
    }

    private String derivePlanStatus(List<ByaiAgentTaskItem> tasks) {
        if (tasks.stream().anyMatch(task -> !TERMINAL_TASK_STATUSES.contains(task.getStatus()))) {
            return "ACTIVE";
        }
        if (tasks.stream().anyMatch(task -> "FAILED".equals(task.getStatus()))) {
            return "FAILED";
        }
        if (tasks.stream().anyMatch(task -> "CANCELLED".equals(task.getStatus()))) {
            return "CANCELLED";
        }
        return "COMPLETED";
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
        if (!includeTerminal) {
            query.in(ByaiAgentTaskPlan::getStatus, includeCancelling ? ACTIVE_PLAN_STATUSES : Set.of("ACTIVE"));
        }
        query.orderByDesc(ByaiAgentTaskPlan::getUpdatedAt).last("LIMIT 1");
        return planMapper.selectOne(query);
    }

    private ByaiAgentTaskPlan requireOwnedPlan(Long planId, Long userId) {
        ByaiAgentTaskPlan plan = planMapper.selectOne(Wrappers.<ByaiAgentTaskPlan>lambdaQuery()
            .eq(ByaiAgentTaskPlan::getPlanId, planId)
            .eq(ByaiAgentTaskPlan::getUserId, userId)
            .last("LIMIT 1"));
        if (plan == null) {
            throw notFound();
        }
        return plan;
    }

    private List<ByaiAgentTaskItem> items(Long planId) {
        return itemMapper.selectList(Wrappers.<ByaiAgentTaskItem>lambdaQuery()
            .eq(ByaiAgentTaskItem::getPlanId, planId)
            .orderByAsc(ByaiAgentTaskItem::getPosition));
    }

    private TaskPlanSnapshot snapshot(ByaiAgentTaskPlan plan) {
        TaskPlanSnapshot snapshot = new TaskPlanSnapshot();
        snapshot.setPlanId(String.valueOf(plan.getPlanId()));
        snapshot.setVersion(plan.getVersion());
        snapshot.setTitle(plan.getTitle());
        snapshot.setStatus(plan.getStatus());
        snapshot.setStatusReason(reason(plan.getStatusReasonCode(), plan.getStatusReasonMessage()));
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

        List<TaskPlanSnapshot.TaskSnapshot> taskSnapshots = items(plan.getPlanId()).stream().map(item -> {
            TaskPlanSnapshot.TaskSnapshot task = new TaskPlanSnapshot.TaskSnapshot();
            task.setTaskId(String.valueOf(item.getTaskId()));
            task.setPosition(item.getPosition());
            task.setTitle(item.getTitle());
            task.setDescription(item.getDescription());
            task.setStatus(item.getStatus());
            task.setStatusReason(reason(item.getStatusReasonCode(), item.getStatusReasonMessage()));
            task.setStartedAt(item.getStartedAt());
            task.setCompletedAt(item.getCompletedAt());
            return task;
        }).toList();
        snapshot.setTasks(taskSnapshots);
        return snapshot;
    }

    private TaskPlanSnapshot.StatusReason reason(String code, String message) {
        return StringUtils.isBlank(code) ? null : new TaskPlanSnapshot.StatusReason(code, message);
    }

    private void appendEvent(ByaiAgentTaskPlan plan, String eventType, String actorType, String actorId,
        String idempotencyKey, TaskPlanSnapshot snapshot) {
        ByaiAgentTaskEvent event = new ByaiAgentTaskEvent();
        event.setEventId(IdUtil.getSnowflakeNextId());
        event.setPlanId(plan.getPlanId());
        event.setPlanVersion(plan.getVersion());
        event.setEventType(eventType);
        event.setActorType(actorType);
        event.setActorId(actorId);
        event.setIdempotencyKey(idempotencyKey);
        event.setPayload(JSON.toJSONString(snapshot));
        event.setCreatedAt(new Date());
        eventMapper.insert(event);
    }

    private void requireRequest(TaskPlanUpdateRequest request) {
        if (request == null) {
            throw badRequest("request must not be null");
        }
        requiredText(request.getIdempotencyKey(), "idempotencyKey", 128);
        requiredText(request.getSourceRunId(), "sourceRunId", 128);
    }

    private void requireOwnedSession(Long sessionId, Long userId) {
        ByaiSession session = sessionService.findById(sessionId);
        if (session == null || !Objects.equals(session.getCreatorId(), userId)) {
            throw notFound();
        }
    }

    private String normalizeRuntime(String value) {
        String runtime = requiredText(value, "sourceRuntime", 32).toUpperCase(Locale.ROOT).replace('-', '_');
        if (!Set.of("BYCLAW_SUPER", "OPENCLAW").contains(runtime)) {
            throw badRequest("unsupported sourceRuntime: " + value);
        }
        return runtime;
    }

    private String normalizeTaskStatus(String value) {
        String status = requiredText(value, "task status", 32).toUpperCase(Locale.ROOT).replace('-', '_');
        if (!TASK_STATUSES.contains(status)) {
            throw badRequest("unsupported task status: " + value);
        }
        return status;
    }

    private String requiredText(String value, String field, int maxLength) {
        String result = StringUtils.trimToNull(value);
        if (result == null) {
            throw badRequest(field + " is required");
        }
        if (result.length() > maxLength) {
            throw badRequest(field + " exceeds " + maxLength + " characters");
        }
        return result;
    }

    private String trimToNull(String value, int maxLength) {
        String result = StringUtils.trimToNull(value);
        if (result != null && result.length() > maxLength) {
            throw badRequest("text exceeds " + maxLength + " characters");
        }
        return result;
    }

    private Long parseRequiredLong(String value, String field) {
        Long parsed = parseOptionalLong(value);
        if (parsed == null) {
            throw badRequest(field + " must be a positive integer string");
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

    private ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }

    private ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }

    private ResponseStatusException notFound() {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, "Task plan not found");
    }
}
