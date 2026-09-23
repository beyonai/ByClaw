package com.iwhalecloud.byai.state.domain.groupchat.application;

/** A group turn must enter its owner's active task through the private task entry. */
public class GroupChatActiveTaskException extends IllegalArgumentException {
    public static final String CODE = "ACTIVE_TASK_REQUIRES_TASK_ENTRY";
    private final Long taskId;
    private final Long agentId;

    public GroupChatActiveTaskException(Long taskId, Long agentId) {
        super("当前话题下已有未完成任务，请进入任务继续。");
        this.taskId = taskId;
        this.agentId = agentId;
    }

    public Long getTaskId() {
        return taskId;
    }

    public Long getAgentId() {
        return agentId;
    }
}
