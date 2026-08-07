package com.iwhalecloud.byai.manager.dto.devloop;

import lombok.Data;

import java.util.List;

/**
 * AI 预拆结果:草稿任务列表 + 是否真的出自模型。
 * aiSuggested 必须反映真实来源,前端据此显示「AI 预拆」标记;模型失败降级时为 false。
 */
@Data
public class RequirementPresplitResultDto {

    /** true=模型产出;false=模型不可用/输出不可解析,已降级为每仓库一行且不猜依赖。 */
    private boolean aiSuggested;

    /** 降级原因,仅用于前端提示与排查,成功时为空。 */
    private String degradeReason;

    /** 预拆出的草稿任务,顺序即建议执行顺序。 */
    private List<PresplitTask> tasks;

    /** 一条草稿任务,字段与前端 SplitTaskDraft 对齐,可直接喂给 /task/split。 */
    @Data
    public static class PresplitTask {
        /** 前端行ID,同时是 dependsOn 的引用目标。 */
        private String rowId;

        /** 子任务标题。 */
        private String title;

        /** 目标仓库ID。 */
        private Long repoId;

        /** 建议分支名。 */
        private String branch;

        /** 依赖的上游 rowId 列表,空=可最先开工。 */
        private List<String> dependsOn;

        /** 拆分理由,给用户看「为什么这么拆」,不落库。 */
        private String reason;
    }
}
