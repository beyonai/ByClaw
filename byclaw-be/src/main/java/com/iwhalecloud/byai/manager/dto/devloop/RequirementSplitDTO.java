package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

/**
 * 需求拆分为多仓库子任务的入参:一个需求 → 多个子任务,子任务间可声明依赖(DAG)。
 * MVP 阶段依赖仅落库用于展示,不控制启动顺序,拆分即全部子任务立即各起会话。
 */
@Data
public class RequirementSplitDTO {

    /** 研发项目ID。 */
    private Long projectId;

    /** 被拆分的来源需求ID ScanRequireItem.itemId。 */
    private Long sourceItemId;

    /** 拆分出的子任务列表,顺序即前端展示顺序。 */
    private List<SplitTask> tasks;

    /** 一个子任务 = 依赖图里的一个节点。 */
    @Data
    public static class SplitTask {
        /** 前端临时行ID,用于 dependsOn 引用;后端据此翻译成真实 taskId。 */
        private String rowId;

        /** 子任务标题。 */
        private String title;

        /** 目标仓库ID ProjectRepo.repoId。 */
        private Long repoId;

        /** 分支名,前端可自定义;空则后端按会话ID生成。 */
        private String branch;

        /** 承接成员ID(项目成员 userId),据此解析执行数字员工 agentId。 */
        private Long assigneeId;

        /** 依赖的上游子任务 rowId 列表,构成需求内 DAG;空=无上游。 */
        private List<String> dependsOn;
    }
}
