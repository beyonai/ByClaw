package com.iwhalecloud.byai.state.interfaces.controller.taskplan;

import org.apache.commons.lang3.StringUtils;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.application.service.taskplan.TaskPlanApplicationService;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanLookupRequest;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanUpdateRequest;
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
    public ResponseUtil<TaskPlanSnapshot> update(@RequestBody TaskPlanUpdateRequest request) {
        TaskPlanSnapshot snapshot = taskPlanService.update(request);
        publisher.broadcast(CurrentUserHolder.getCurrentUserId(), snapshot, null);
        return ResponseUtil.successResponse(snapshot);
    }

    @PostMapping("/active")
    public ResponseUtil<TaskPlanSnapshot> active(@RequestBody TaskPlanLookupRequest request) {
        return ResponseUtil.successResponse(taskPlanService.findActive(request));
    }

    /** byclaw-super 的直接取消入口；生产 STOP_CHAT 仍由聊天应用服务统一编排。 */
    @PostMapping("/cancel")
    public ResponseUtil<TaskPlanSnapshot> cancel(@RequestBody TaskPlanLookupRequest request) {
        String message = StringUtils.defaultIfBlank(request == null ? null : request.getReason(), "用户已停止执行");
        TaskPlanSnapshot cancelling = taskPlanService.requestCancellation(request, "USER_STOPPED", message);
        publisher.broadcast(CurrentUserHolder.getCurrentUserId(), cancelling, null);
        TaskPlanSnapshot cancelled = taskPlanService.confirmCancellation(request, "USER_STOPPED", message);
        publisher.broadcast(CurrentUserHolder.getCurrentUserId(), cancelled, null);
        return ResponseUtil.successResponse(cancelled == null ? cancelling : cancelled);
    }
}
