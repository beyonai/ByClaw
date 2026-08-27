package com.iwhalecloud.byai.state.domain.taskplan.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

/** updateTaskPlan 内部写入协议。运行归属字段由运行时适配器注入，不由模型填写。 */
@Data
public class TaskPlanUpdateRequest {

    /** CREATE 首次定义计划；其余动作只推进当前任务。 */
    private String action;

    private String idempotencyKey;

    private String sessionId;

    private String messageId;

    private String turnId;

    private String laneId;

    private String traceId;

    private String sourceRuntime;

    private String sourceRunId;

    private String title;

    private String explanation;

    private List<TaskInput> tasks = new ArrayList<>();

    /** FAIL_CURRENT/SKIP_CURRENT 可携带原因；由 Super 从扁平 Tool 参数组装。 */
    private StatusReasonInput statusReason;

    @Data
    public static class TaskInput {

        private String step;

        private String description;

    }

    @Data
    public static class StatusReasonInput {

        private String code;

        private String message;
    }
}
