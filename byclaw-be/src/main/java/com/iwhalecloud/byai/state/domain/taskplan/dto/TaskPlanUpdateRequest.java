package com.iwhalecloud.byai.state.domain.taskplan.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

/** updateTaskPlan 内部写入协议。运行归属字段由运行时适配器注入，不由模型填写。 */
@Data
public class TaskPlanUpdateRequest {

    /** CREATE 首次定义计划；UPDATE 后续只按 taskId 更新状态。 */
    private String action;

    private String idempotencyKey;

    private String sessionId;

    private String messageId;

    private String turnId;

    private String laneId;

    private String traceId;

    private String sourceRuntime;

    private String sourceRunId;

    /** UPDATE 时由后端首次 CREATE 返回。 */
    private String planId;

    /** UPDATE 的乐观锁版本。 */
    private Integer expectedVersion;

    private String title;

    private String explanation;

    private List<TaskInput> tasks = new ArrayList<>();

    private List<TaskStatusUpdate> updates = new ArrayList<>();

    @Data
    public static class TaskInput {

        private String step;

        private String description;

        private String status;

        private StatusReasonInput statusReason;
    }

    @Data
    public static class TaskStatusUpdate {

        private String taskId;

        private String status;

        private StatusReasonInput statusReason;
    }

    @Data
    public static class StatusReasonInput {

        private String code;

        private String message;
    }
}
