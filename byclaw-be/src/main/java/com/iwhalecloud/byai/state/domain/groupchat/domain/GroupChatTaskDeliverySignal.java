package com.iwhalecloud.byai.state.domain.groupchat.domain;

import com.iwhalecloud.byai.common.i18n.I18nUtil;

/** 子会话级交付信号契约，提示词和读取端共用固定版本与路径。 */
public final class GroupChatTaskDeliverySignal {
    public static final String SCHEMA_VERSION = "1";

    private GroupChatTaskDeliverySignal() {
    }

    public static String storagePath(Long taskId) {
        if (taskId == null || taskId <= 0) {
            throw new IllegalArgumentException(I18nUtil.get("groupchat.task.sessionInvalid"));
        }
        return "/.sessions/" + taskId + "/.byclaw/task-delivery.json";
    }
}
