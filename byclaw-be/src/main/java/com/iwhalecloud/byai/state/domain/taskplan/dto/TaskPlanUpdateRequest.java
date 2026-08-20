package com.iwhalecloud.byai.state.domain.taskplan.dto;

import java.util.ArrayList;
import java.util.List;

import lombok.Data;

/** update_task_plan 工具写入协议。运行归属字段由运行时适配器注入，不由模型填写。 */
@Data
public class TaskPlanUpdateRequest {

    private String planId;

    private Integer expectedVersion;

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

    @Data
    public static class TaskInput {

        private String taskId;

        private String step;

        private String description;

        private String status;

        private StatusReasonInput statusReason;
    }

    @Data
    public static class StatusReasonInput {

        private String code;

        private String message;
    }
}
