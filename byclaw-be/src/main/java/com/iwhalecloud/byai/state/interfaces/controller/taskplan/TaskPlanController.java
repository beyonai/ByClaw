package com.iwhalecloud.byai.state.interfaces.controller.taskplan;

import org.apache.commons.lang3.StringUtils;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService.TaskPlanWriteResult;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanCommandResult;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;
import com.iwhalecloud.byai.state.domain.taskplan.exception.TaskPlanCommandException;
import com.iwhalecloud.byai.state.domain.ws.service.TaskPlanWebSocketPublisher;

/** byclaw-super/OpenClaw 共用的任务计划内部 API。 */
@RestController
@RequestMapping("/internal/api/v1/task-plan")
public class TaskPlanController {

    private final TaskPlanApplicationService taskPlanService;

    private final TaskPlanWebSocketPublisher publisher;

    public TaskPlanController(TaskPlanApplicationService taskPlanService, TaskPlanWebSocketPublisher publisher) {
        this.taskPlanService = taskPlanService;
        this.publisher = publisher;
    }

    @PostMapping("/update")
    public ResponseUtil<TaskPlanCommandResult> update(@RequestBody TaskPlanUpdateRequest request) {
        try {
            return commandResponse(taskPlanService.executeCommand(request));
        }
        catch (DuplicateKeyException e) {
            try {
                return commandResponse(taskPlanService.recoverCreateConflict(request));
            }
            catch (TaskPlanCommandException conflict) {
                return commandFailure(conflict);
            }
        }
        catch (TaskPlanCommandException e) {
            return commandFailure(e);
        }
    }

    private ResponseUtil<TaskPlanCommandResult> commandResponse(TaskPlanWriteResult result) {
        if (result.changed()) {
            publisher.broadcast(CurrentUserHolder.getCurrentUserId(), result.snapshot(), null);
        }
        return ResponseUtil.successResponse(TaskPlanCommandResult.success(result.snapshot()));
    }

    private ResponseUtil<TaskPlanCommandResult> commandFailure(TaskPlanCommandException error) {
        return ResponseUtil.successResponse(
            TaskPlanCommandResult.failure(error.getCode(), error.getMessage(), error.getCurrentPlan()));
    }

    @PostMapping("/active")
    public ResponseUtil<TaskPlanSnapshot> active(@RequestBody TaskPlanLookupRequest request) {
        return ResponseUtil.successResponse(taskPlanService.findActive(request));
    }

    /** 直接将指定执行的活动计划取消；计划状态统一由 BE 维护。 */
    @PostMapping("/cancel")
    public ResponseUtil<TaskPlanSnapshot> cancel(@RequestBody TaskPlanLookupRequest request) {
        String message = StringUtils.defaultIfBlank(request == null ? null : request.getReason(), "用户已停止执行");
        TaskPlanSnapshot cancelled = taskPlanService.cancel(request, "USER_STOPPED", message);
        publisher.broadcast(CurrentUserHolder.getCurrentUserId(), cancelled, null);
        return ResponseUtil.successResponse(cancelled);
    }
}
