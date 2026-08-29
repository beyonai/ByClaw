package com.iwhalecloud.byai.state.domain.taskplan.dto;

import lombok.Data;

/** updateTaskPlan 的机器可读结果；HTTP 外壳保持现有 ResponseUtil 不变。 */
@Data
public class TaskPlanCommandResult {

    private boolean ok;

    private TaskPlanSnapshot plan;

    private ErrorDetail error;

    private TaskPlanSnapshot currentPlan;

    public static TaskPlanCommandResult success(TaskPlanSnapshot plan) {
        TaskPlanCommandResult result = new TaskPlanCommandResult();
        result.setOk(true);
        result.setPlan(plan);
        return result;
    }

    public static TaskPlanCommandResult failure(String code, String message, TaskPlanSnapshot currentPlan) {
        TaskPlanCommandResult result = new TaskPlanCommandResult();
        result.setOk(false);
        result.setError(new ErrorDetail(code, message));
        result.setCurrentPlan(currentPlan);
        return result;
    }

    @Data
    public static class ErrorDetail {

        private String code;

        private String message;

        public ErrorDetail() {
        }

        public ErrorDetail(String code, String message) {
            this.code = code;
            this.message = message;
        }
    }
}
