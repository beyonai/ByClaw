package com.iwhalecloud.byai.common.constants.devloop;

/**
 * 研发任务类型，与 byai_default_agent 的架构/需求/研发/测试四角色一一对照。
 * 会话表本身没有类型列，类型由各创建链路留下的关联行反查（见 DevloopApplicationService 的任务类型索引）。
 */
public final class DevloopTaskType {

    private DevloopTaskType() {
    }

    /** 架构任务：工作区初始化会话，byai_project.init_session_id 指向它。 */
    public static final String ARCHITECT = "architect";

    /** 需求任务：需求澄清会话，需求项回写了 session_id 但没拆出仓库子任务。 */
    public static final String REQUIREMENT = "requirement";

    /** 研发任务：需求拆解出的仓库子任务会话，byai_scan_item_task 有对应行。 */
    public static final String CODER = "coder";

    /** 测试任务：集成测试下发的会话，byai_integration_run.session_id 指向它。 */
    public static final String TESTER = "tester";

    /** 普通会话：项目内直接开聊产生的会话，不属于四角色任务。 */
    public static final String CHAT = "chat";
}
