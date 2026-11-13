package com.iwhalecloud.byai.common.constants.groupchat;

/** 群响应视图阶段，不改变底层执行状态；创建者 Codex，2026-11-13。 */
public final class GroupResponsePhase {
    public static final String QUEUED = "QUEUED";
    public static final String RUNNING = "RUNNING";
    public static final String TASK = "TASK";
    public static final String CHAT_COMPLETED = "CHAT_COMPLETED";
    public static final String FAILED = "FAILED";
    public static final String CANCELLED = "CANCELLED";

    private GroupResponsePhase() {
    }
}
