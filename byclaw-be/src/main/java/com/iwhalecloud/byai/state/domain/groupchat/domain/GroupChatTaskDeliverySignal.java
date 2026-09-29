package com.iwhalecloud.byai.state.domain.groupchat.domain;

/** 子会话级交付信号契约，提示词和读取端共用固定版本与路径。 */
public final class GroupChatTaskDeliverySignal {
    public static final String SCHEMA_VERSION = "1";

    private GroupChatTaskDeliverySignal() {
    }

    public static String storagePath(Long taskId) {
        if (taskId == null || taskId <= 0) {
            throw new IllegalArgumentException("Invalid task session ID");
        }
        return "/.sessions/" + taskId + "/.byclaw/task-delivery.json";
    }
}
