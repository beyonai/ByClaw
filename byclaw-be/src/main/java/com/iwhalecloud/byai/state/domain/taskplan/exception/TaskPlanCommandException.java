package com.iwhalecloud.byai.state.domain.taskplan.exception;

import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;

/** 由内部任务计划接口转换为机器可读 Tool Result 的协议异常。 */
public class TaskPlanCommandException extends RuntimeException {

    private final String code;

    private final TaskPlanSnapshot currentPlan;

    public TaskPlanCommandException(String code, String message, TaskPlanSnapshot currentPlan) {
        super(message);
        this.code = code;
        this.currentPlan = currentPlan;
    }

    public String getCode() {
        return code;
    }

    public TaskPlanSnapshot getCurrentPlan() {
        return currentPlan;
    }
}
